import { Inject, Injectable } from '@nestjs/common';
import type { RecallAttemptResult, RecallChannel } from '@healthflow/shared-types';
import { AuditService } from '../../../common/audit/audit.service';
import { CapacidadService } from '../../../common/capacidad/capacidad.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import type { Tx } from '../../../db/drizzle';
import { PatientRecall, cierraElSeguimiento } from '../domain/recall.entity';
import { RECALL_REPOSITORY, type RecallRepository } from '../domain/recall.repository';
import {
  IntentoEnCursoError,
  IntentoNoActualizableError,
  IntentoYaRegistradoError,
  RecallNoEncontradoError,
  TipoRecallNoEncontradoError,
} from '../domain/recall.errors';
import { auditar, esViolacionDeUnicidad, type ActorRecall } from './actor';

const MODULO = 'dental_recalls' as const;

export interface ResultadoIntento {
  attemptId: string;
  channel: RecallChannel;
  /** `true` si se encoló un envío; `false` si quedó como tarea de recepción. */
  encolado: boolean;
  status: string;
}

/**
 * Programa el siguiente intento de contacto de un control.
 *
 * Lo invoca recepción («contactar ahora») y el worker (secuencia automática).
 * El canal NO lo elige el llamador: lo decide el dominio a partir del
 * consentimiento y los destinos del paciente, para que la misma regla valga en
 * los dos caminos.
 */
@Injectable()
export class ScheduleRecallAttemptUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly capacidad: CapacidadService,
    private readonly audit: AuditService,
    private readonly ctx: RequestContextService,
    @Inject(RECALL_REPOSITORY) private readonly repo: RecallRepository,
  ) {}

  /** Desde una petición de recepción. */
  async ejecutar(recallId: string, ahora = new Date()): Promise<ResultadoIntento> {
    return this.tenantDb.run((tx) =>
      this.enTransaccion(tx, recallId, { tipo: 'usuario' }, this.ctx.get().userId, ahora),
    );
  }

  /** Desde el worker, con la transacción del tenant del evento. */
  async enTransaccion(
    tx: Tx,
    recallId: string,
    actor: ActorRecall,
    createdBy: string | null,
    ahora: Date,
  ): Promise<ResultadoIntento> {
    await this.capacidad.asegurar(tx, MODULO, 'escritura');

    // `FOR UPDATE` serializa dos contactos simultáneos sobre el mismo control:
    // el segundo espera y vuelve a leer, y entonces sí ve la gestión que dejó
    // el primero.
    const estado = await this.repo.cargarParaActualizar(tx, recallId);
    if (!estado) throw new RecallNoEncontradoError();
    // Un doble clic en "contactar" no debe mandarle dos mensajes idénticos al
    // paciente. La unicidad de (recall, número) protege los datos, pero el
    // segundo intento tomaría el número siguiente y saldría igual.
    if (await this.repo.hayIntentoPendiente(tx, recallId)) throw new IntentoEnCursoError();
    const tipo = await this.repo.buscarTipo(tx, estado.recallTypeId);
    if (!tipo) throw new TipoRecallNoEncontradoError();

    const contacto = await this.repo.contactoDePaciente(tx, estado.patientId);
    if (!contacto) throw new RecallNoEncontradoError();
    // Lanza si el paciente está archivado o pidió no recibir mensajes. Que sea
    // el dominio quien decida evita que recepción y worker apliquen criterios
    // distintos sobre el mismo paciente.
    const channel = PatientRecall.elegirCanal(contacto);

    const recall = PatientRecall.desde(estado);
    const numero = recall.siguienteIntento();
    recall.registrarContacto(tipo, ahora);

    let attemptId: string;
    try {
      attemptId = await this.repo.crearIntento(tx, {
        patientRecallId: recallId,
        channel,
        attemptNumber: numero,
        scheduledAt: ahora,
        createdBy,
      });
    } catch (error) {
      // (recall, attempt_number) es único: dos workers reclamando a la vez no
      // producen dos intentos con el mismo número.
      if (esViolacionDeUnicidad(error)) throw new IntentoYaRegistradoError(numero);
      throw error;
    }

    // 'phone' y 'manual' no generan mensaje: son una tarea que recepción
    // cierra a mano, y es lo que permite operar sin Twilio ni dominio de
    // correo verificado.
    const encolado =
      channel === 'email' || channel === 'whatsapp'
        ? await this.repo.encolarMensajeDeIntento(tx, {
            recallAttemptId: attemptId,
            patientId: estado.patientId,
            channel,
            idempotencyKey: `recall:${recallId}:a${numero}:${channel}`,
            scheduledAt: ahora,
          })
        : false;

    await this.repo.guardar(tx, recall.snapshot);
    await auditar(this.audit, tx, actor, {
      entidad: 'PatientRecall',
      entidadId: recallId,
      accion: 'contactar',
      detalle: { canal: channel, intento: numero, encolado },
    });

    return { attemptId, channel, encolado, status: recall.status };
  }
}

/** Registra el desenlace de una gestión: contestó, reservó, no localizado… */
@Injectable()
export class RecordRecallOutcomeUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly capacidad: CapacidadService,
    private readonly audit: AuditService,
    @Inject(RECALL_REPOSITORY) private readonly repo: RecallRepository,
  ) {}

  async ejecutar(input: {
    recallId: string;
    attemptId: string;
    resultado: RecallAttemptResult;
    nota?: string | null;
  }): Promise<{ status: string }> {
    return this.tenantDb.run(async (tx) => {
      await this.capacidad.asegurar(tx, MODULO, 'escritura');
      const estado = await this.repo.cargarParaActualizar(tx, input.recallId);
      if (!estado) throw new RecallNoEncontradoError();

      // ORDEN: primero se cancela el envío que pudiera quedar en cola para
      // esta gestión, y sólo después se cierra. Al revés no funcionaba: el
      // cierre saca el intento de 'pending' y `cancelarPendientes` ya no lo
      // encontraba, así que el paciente recibía el correo de un control que
      // acababa de rechazar.
      await this.repo.cancelarMensajesDeIntento(tx, input.attemptId);

      const cerrado = await this.repo.cerrarIntento(
        tx,
        input.recallId,
        input.attemptId,
        input.resultado,
        input.nota ?? null,
      );
      // Un UPDATE que no toca ninguna fila no es un éxito: el intento es de
      // otro control, no existe, o alguien lo cerró antes. Devolver 200 aquí
      // dejaría a recepción creyendo que registró algo que no quedó.
      if (!cerrado) throw new IntentoNoActualizableError();

      const recall = PatientRecall.desde(estado);
      // 'declined' cierra el seguimiento: insistirle a quien ya dijo que no es
      // justo lo que hace que un paciente bloquee el canal. 'booked' NO cierra
      // nada aquí — lo cierra el evento de la cita, que es el hecho real.
      if (input.resultado === 'declined') {
        recall.descartar('El paciente declinó el control');
        await this.repo.cancelarPendientes(tx, input.recallId);
        await this.repo.guardar(tx, recall.snapshot);
      }

      await this.audit.record(tx, {
        entidad: 'PatientRecall',
        entidadId: input.recallId,
        accion: 'resultado',
        detalle: { resultado: input.resultado, cierra: cierraElSeguimiento(input.resultado) },
      });
      return { status: recall.status };
    });
  }
}

/** Cierre manual con motivo. */
@Injectable()
export class DismissRecallUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly capacidad: CapacidadService,
    private readonly audit: AuditService,
    @Inject(RECALL_REPOSITORY) private readonly repo: RecallRepository,
  ) {}

  async ejecutar(recallId: string, motivo: string): Promise<{ status: string }> {
    return this.tenantDb.run(async (tx) => {
      await this.capacidad.asegurar(tx, MODULO, 'escritura');
      const estado = await this.repo.cargarParaActualizar(tx, recallId);
      if (!estado) throw new RecallNoEncontradoError();

      const recall = PatientRecall.desde(estado);
      recall.descartar(motivo);
      // Primero los pendientes: descartar un control y dejar un mensaje en
      // camino sería exactamente lo que recepción quiso evitar.
      await this.repo.cancelarPendientes(tx, recallId);
      await this.repo.guardar(tx, recall.snapshot);

      await this.audit.record(tx, {
        entidad: 'PatientRecall',
        entidadId: recallId,
        accion: 'descartar',
        detalle: { motivo: recall.snapshot.dismissReason },
      });
      return { status: recall.status };
    });
  }
}
