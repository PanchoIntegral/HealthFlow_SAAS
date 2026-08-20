import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  EmitirRecetaRequest,
  EmisorReceta,
  PacienteReceta,
  RecetaView,
} from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import { Receta } from '../domain/receta.entity';
import {
  RECETA_REPOSITORY,
  type ContextoEmision,
  type RecetaRepository,
} from '../domain/receta.repository';

/** Serie única por ahora; la columna existe para poder abrir otras sin migrar. */
const SERIE_RECETA = 'RX';

@Injectable()
export class EmitirRecetaUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    @Inject(RECETA_REPOSITORY) private readonly repo: RecetaRepository,
  ) {}

  async execute(input: EmitirRecetaRequest): Promise<RecetaView> {
    // El médico sale del contexto de la petición, NUNCA del cuerpo: quien
    // prescribe es quien está autenticado, y aceptarlo del cliente permitiría
    // emitir a nombre de otro colega.
    const doctorId = this.ctx.get().userId;

    return this.tenantDb.run(async (tx) => {
      const contexto = await this.repo.cargarContextoEmision(tx, input.patientId, doctorId);
      if (!contexto) throw new NotFoundException('Paciente no encontrado');

      // La fracción NO se cree de lo que mande el cliente: se relee del
      // catálogo. Si se aceptara el valor del cuerpo, mandar `fraccion: 5`
      // junto a la clave del clonazepam bastaría para saltarse el bloqueo del
      // art. 226 — y el bloqueo es justamente la razón de ser del módulo.
      const medicamentos = await this.reconciliarFracciones(tx, input.medicamentos);

      // Se valida ANTES de tocar el contador: una receta rechazada no debe
      // consumir folio, o la numeración de la clínica acumularía huecos cada
      // vez que a alguien le falta un campo.
      const receta = Receta.emitir({
        emisor: emisorDe(contexto),
        paciente: pacienteDe(contexto),
        diagnosticos: input.diagnosticos,
        medicamentos,
        indicacionesGenerales: input.indicacionesGenerales ?? null,
        alergiasSnapshot: contexto.pacienteAlergias,
      });

      const anio = new Date().getFullYear();
      const numero = await this.repo.siguienteFolio(tx, SERIE_RECETA, anio);
      const folio = formatearFolio(SERIE_RECETA, anio, numero);

      const view = await this.repo.crear(
        tx,
        {
          patientId: input.patientId,
          doctorId,
          appointmentId: input.appointmentId ?? null,
          receta,
        },
        folio,
        anio,
        numero,
      );

      await this.audit.record(tx, {
        entidad: 'receta',
        entidadId: view.id,
        accion: 'emitir_receta',
        // Se registran el folio y las CLAVES, no las indicaciones: la bitácora
        // no necesita duplicar el contenido clínico que ya vive en la receta.
        detalle: {
          folio,
          patientId: input.patientId,
          medicamentos: medicamentos.length,
          claves: medicamentos.map((m) => m.clave ?? 'texto-libre'),
        },
      });

      return view;
    });
  }

  /**
   * Sustituye la fracción declarada por el cliente por la del catálogo.
   *
   * Una clave que no existe en el catálogo se trata como texto libre
   * (`clave: null`, `fraccion: null`): inventarse una clave no debe servir
   * para que el ítem herede una fracción emisible ni para fingir un origen
   * catalogado que no tiene.
   */
  private async reconciliarFracciones(
    tx: Tx,
    medicamentos: EmitirRecetaRequest['medicamentos'],
  ): Promise<EmitirRecetaRequest['medicamentos']> {
    const claves = medicamentos.map((m) => m.clave).filter((c): c is string => !!c);
    const fracciones = await this.repo.fraccionesPorClave(tx, claves);

    return medicamentos.map((m) => {
      if (!m.clave) return { ...m, fraccion: null };
      const fraccion = fracciones.get(m.clave);
      return fraccion === undefined
        ? { ...m, clave: null, fraccion: null }
        : { ...m, fraccion };
    });
  }
}

/** 'RX-2026-000123' — legible y dictable por teléfono a la farmacia. */
function formatearFolio(serie: string, anio: number, numero: number): string {
  return `${serie}-${anio}-${String(numero).padStart(6, '0')}`;
}

/**
 * Los campos que la ley exige pero la base permite vacíos se pasan como cadena
 * vacía en vez de omitirse: así el validador los reporta por nombre
 * ('emisor.institucionTitulo') y la UI puede decir exactamente qué capturar en
 * Ajustes, en lugar de fallar con un error genérico.
 */
function emisorDe(c: ContextoEmision): EmisorReceta {
  return {
    medicoNombre: c.medicoNombre,
    cedulaProfesional: c.cedulaProfesional ?? '',
    cedulaEspecialidad: c.cedulaEspecialidad,
    especialidad: c.especialidad,
    institucionTitulo: c.institucionTitulo ?? '',
    nombreClinica: c.nombreClinica,
    domicilioEstablecimiento: c.direccionClinica ?? '',
    telefonoClinica: c.telefonoClinica,
    // Se congela la CLAVE, no una URL firmada: la firmada expira en minutos y
    // este snapshot se conserva para siempre. GetRecetaDetalleUseCase resuelve
    // una URL fresca en cada lectura.
    logoStorageKey: c.logoStorageKey,
    leyendaPie: c.leyendaPie,
  };
}

function pacienteDe(c: ContextoEmision): PacienteReceta {
  return {
    nombre: c.pacienteNombre,
    edad: edadEnAnios(c.pacienteFechaNacimiento),
    // El cast sostiene el mismo trato que el resto: null llega al validador
    // como campo faltante y produce 'paciente.sexo', que es lo que la UI usa
    // para pedirlo antes de emitir.
    sexo: c.pacienteSexo as PacienteReceta['sexo'],
  };
}

function edadEnAnios(fechaNacimiento: string, ahora: Date = new Date()): number {
  const nacimiento = new Date(`${fechaNacimiento.slice(0, 10)}T00:00:00Z`);
  let edad = ahora.getUTCFullYear() - nacimiento.getUTCFullYear();
  const m = ahora.getUTCMonth() - nacimiento.getUTCMonth();
  if (m < 0 || (m === 0 && ahora.getUTCDate() < nacimiento.getUTCDate())) edad--;
  return edad;
}
