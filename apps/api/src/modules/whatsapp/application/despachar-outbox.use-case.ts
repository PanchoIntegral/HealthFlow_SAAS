import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { env } from '../../../config/env';
import { runInTenant, type Database } from '../../../db/drizzle';
import { DB } from '../../../db/drizzle.module';
import { debeRestringir } from '../../../common/subscription/debe-restringir';
import type { SubscriptionStatus } from '../../../common/subscription/subscription-status';
import {
  WHATSAPP_CONFIG_REPOSITORY,
  type WhatsappConfigRepository,
} from '../domain/whatsapp-config.repository';
import {
  WHATSAPP_OUTBOX_REPOSITORY,
  type WhatsappOutboxRepository,
} from '../domain/whatsapp-outbox.repository';
import {
  agotoIntentos,
  minutosParaSiguienteIntento,
} from '../domain/ventana-recordatorio';
import { SecretosService } from '../../../common/crypto/secretos.service';
import {
  WHATSAPP_SENDER,
  type CredencialesWhatsapp,
  type WhatsappSender,
} from './whatsapp-sender.port';

/** Cuántas filas se reclaman por tick. Acota el trabajo y el tiempo del lote. */
const LOTE = 50;
/** Tras cuántos minutos se da por perdido un envío que quedó a medias. */
const MINUTOS_HUERFANO = 15;

/**
 * Fase 2 del barrido: manda lo que toca.
 *
 * La estructura importante es la separación en tres tiempos:
 *
 *   1. reclamar  → transacción corta que marca 'enviando' y confirma;
 *   2. enviar    → llamada HTTP a Meta, FUERA de toda transacción;
 *   3. registrar → transacción corta con el resultado.
 *
 * Hacer el paso 2 dentro de una transacción dejaría una conexión del pool
 * ocupada durante segundos por cada mensaje, y con un lote de 50 eso agota el
 * pool y tumba la API entera. El estado 'enviando' existe solo para sostener
 * esa separación.
 */
@Injectable()
export class DespacharOutboxUseCase {
  private readonly logger = new Logger(DespacharOutboxUseCase.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configRepo: WhatsappConfigRepository,
    @Inject(WHATSAPP_OUTBOX_REPOSITORY) private readonly outbox: WhatsappOutboxRepository,
    @Inject(WHATSAPP_SENDER) private readonly sender: WhatsappSender,
    private readonly secretos: SecretosService,
  ) {}

  /** Devuelve cuántos mensajes salieron de verdad. */
  async execute(ahora: Date = new Date()): Promise<number> {
    await this.cerrarHuerfanos();

    const reclamadas = await this.reclamar();
    let enviados = 0;

    for (const { outboxId, tenantId } of reclamadas) {
      try {
        if (await this.despachar(outboxId, tenantId, ahora)) enviados++;
      } catch (error) {
        // Un fallo inesperado (no de Meta) no debe dejar la fila colgada en
        // 'enviando' hasta que la recoja el barredor de huérfanos.
        this.logger.error(`Error despachando ${outboxId}: ${mensaje(error)}`);
        await this.registrarFallo(tenantId, outboxId, mensaje(error), ahora, true).catch(
          (e: unknown) => this.logger.error(`Ni siquiera se pudo registrar el fallo: ${mensaje(e)}`),
        );
      }
    }
    return enviados;
  }

  /**
   * Reclama el lote. La función es SECURITY DEFINER porque la cola se barre sin
   * tenant fijado; devuelve solo pares (id, tenant) y aplica en su propio JOIN
   * los filtros que no pueden depender de un `if` en este archivo:
   * clínica activa, consentimiento del paciente, número enviable y cita viva.
   */
  private async reclamar(): Promise<{ outboxId: string; tenantId: string }[]> {
    const result = await this.db.execute(
      sql`SELECT outbox_id, tenant_id FROM whatsapp_reclamar_pendientes(${LOTE})`,
    );
    return (result.rows as unknown as { outbox_id: string; tenant_id: string }[]).map((f) => ({
      outboxId: f.outbox_id,
      tenantId: f.tenant_id,
    }));
  }

  private async cerrarHuerfanos(): Promise<void> {
    const result = await this.db.execute(
      sql`SELECT whatsapp_cerrar_huerfanos(${MINUTOS_HUERFANO}) AS cerrados`,
    );
    const cerrados = (result.rows[0] as { cerrados: number } | undefined)?.cerrados ?? 0;
    if (cerrados > 0) {
      // Merece un warn: significa que el proceso murió a media entrega y hay
      // pacientes que quizá no recibieron su recordatorio.
      this.logger.warn(
        `${cerrados} mensaje(s) quedaron con resultado indeterminado y NO se reintentan ` +
          '(Cloud API no admite clave de idempotencia: reintentar duplicaría el aviso)',
      );
    }
  }

  private async despachar(outboxId: string, tenantId: string, ahora: Date): Promise<boolean> {
    // ── Paso 1: leer lo necesario y soltar la transacción ──────────
    const preparado = await runInTenant(this.db, tenantId, async (tx) => {
      const mensajeSalida = await this.outbox.findPendiente(tx, outboxId);
      if (!mensajeSalida) return null;

      const config = await this.configRepo.find(tx, tenantId);
      if (!config?.activo) return null;

      // La parte de `debeRestringir` que depende del reloj (la gracia de
      // past_due) no se puede expresar en el JOIN de la función definer, así
      // que se comprueba aquí: una clínica suspendida no debe seguir
      // generando mensajes que alguien tiene que pagar.
      if (await this.suspendida(tx, ahora)) {
        this.logger.warn(`Tenant ${tenantId} suspendido: no se envía ${outboxId}`);
        return null;
      }

      const credenciales = this.credenciales(tenantId, config.modo, config.phoneNumberId, config.accessTokenCifrado);
      return { mensajeSalida, credenciales, zonaHoraria: config.zonaHoraria };
    });

    if (!preparado) {
      // No se puede mandar y tampoco es culpa de Meta: se cierra la fila para
      // que no quede atrapada en 'enviando'.
      await this.registrarFallo(
        tenantId,
        outboxId,
        'La clínica desactivó los recordatorios, está suspendida o el mensaje ya no existe',
        ahora,
        false,
      );
      return false;
    }

    // ── Paso 2: la llamada a Meta, sin transacción abierta ─────────
    const resultado = await this.sender.enviarPlantilla(preparado.credenciales, {
      aE164: preparado.mensajeSalida.telefonoE164,
      plantilla: preparado.mensajeSalida.plantilla,
      idioma: 'es_MX',
      variables: variablesEnOrden(preparado.mensajeSalida.variables),
      botones: BOTONES_RECORDATORIO,
    });

    // ── Paso 3: registrar el desenlace ─────────────────────────────
    if (resultado.ok) {
      await runInTenant(this.db, tenantId, (tx) =>
        this.outbox.marcarEnviado(tx, outboxId, resultado.metaMessageId),
      );
      return true;
    }

    await this.registrarFallo(
      tenantId,
      outboxId,
      `${resultado.error.codigo}: ${resultado.error.mensaje}`,
      ahora,
      resultado.error.reintentable,
    );
    return false;
  }

  private async registrarFallo(
    tenantId: string,
    outboxId: string,
    error: string,
    ahora: Date,
    reintentable: boolean,
  ): Promise<void> {
    await runInTenant(this.db, tenantId, async (tx) => {
      const actual = await this.outbox.findPendiente(tx, outboxId);
      const intentos = actual?.intentos ?? Number.MAX_SAFE_INTEGER;

      // `intentos` ya viene incrementado por el claim, así que agotoIntentos
      // mide los que de verdad se hicieron.
      const reintentarEn =
        reintentable && !agotoIntentos(intentos)
          ? new Date(ahora.getTime() + minutosParaSiguienteIntento(intentos) * 60_000)
          : null;

      await this.outbox.marcarFallo(tx, outboxId, error, reintentarEn);
    });
  }

  /** Estado de pago de la clínica, con el tenant ya fijado por la transacción. */
  private async suspendida(tx: Parameters<Parameters<Database['transaction']>[0]>[0], ahora: Date) {
    const result = await tx.execute(
      sql`SELECT subscription_status, grace_until FROM tenants LIMIT 1`,
    );
    const fila = result.rows[0] as
      | { subscription_status: SubscriptionStatus; grace_until: Date | null }
      | undefined;
    if (!fila) return true;

    return debeRestringir(
      {
        status: fila.subscription_status,
        graceUntil: fila.grace_until ? new Date(fila.grace_until) : null,
      },
      ahora,
    );
  }

  /**
   * Modo 'compartido' cae a las credenciales de HealthFlow; modo 'propio'
   * descifra las de la clínica. El AAD del descifrado es el tenantId, así que
   * una fila que no le pertenezca no abre.
   */
  private credenciales(
    tenantId: string,
    modo: string,
    phoneNumberId: string | null,
    accessTokenCifrado: string | null,
  ): CredencialesWhatsapp {
    if (modo === 'propio' && phoneNumberId && accessTokenCifrado) {
      return {
        phoneNumberId,
        accessToken: this.secretos.descifrar(accessTokenCifrado, tenantId),
      };
    }
    return {
      phoneNumberId: env.whatsappSharedPhoneNumberId,
      accessToken: env.whatsappSharedAccessToken,
    };
  }
}

/** Payloads de los tres botones, en el orden en que los declara la plantilla. */
export const BOTONES_RECORDATORIO = ['confirmar', 'cancelar', 'reagendar'] as const;

/** Meta numera las variables del cuerpo: {{1}}, {{2}}… y las quiere en orden. */
export function variablesEnOrden(variables: Record<string, string>): string[] {
  return Object.keys(variables)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => variables[k] ?? '');
}

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
