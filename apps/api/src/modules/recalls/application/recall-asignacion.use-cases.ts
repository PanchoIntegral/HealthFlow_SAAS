import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RecallSource } from '@healthflow/shared-types';
import { AuditService } from '../../../common/audit/audit.service';
import { CapacidadService } from '../../../common/capacidad/capacidad.service';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import type { Tx } from '../../../db/drizzle';
import { PatientRecall, type EstadoRecall } from '../domain/recall.entity';
import {
  RECALL_REPOSITORY,
  type RecallRepository,
} from '../domain/recall.repository';
import {
  ReactivacionNoConfiguradaError,
  TipoRecallInactivoError,
  TipoRecallNoEncontradoError,
} from '../domain/recall.errors';
import { auditar, type ActorRecall } from './actor';
import { fechaLocal, sumarDias } from '../domain/fecha-local';

const MODULO = 'dental_recalls' as const;

/**
 * Resultado de crear un control. `yaExistia` no es un error: dos eventos
 * distintos pueden pedir el mismo control (dos limpiezas terminadas el mismo
 * día) y la respuesta correcta es "ya está", no un fallo que el worker
 * reintentaría ocho veces.
 */
export interface ResultadoAsignacion {
  recall: EstadoRecall | null;
  yaExistia: boolean;
}

/** Alta manual desde el expediente. */
@Injectable()
export class AssignPatientRecallUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly capacidad: CapacidadService,
    private readonly audit: AuditService,
    @Inject(RECALL_REPOSITORY) private readonly repo: RecallRepository,
  ) {}

  async ejecutar(input: {
    patientId: string;
    recallTypeId: string;
    assignedDoctorId?: string | null;
    /** Desde cuándo cuenta el intervalo. Por omisión, hoy en la clínica. */
    desde?: string;
    ahora?: Date;
  }): Promise<ResultadoAsignacion> {
    return this.tenantDb.run((tx) =>
      crearControl(this.repo, this.audit, tx, {
        actor: { tipo: 'usuario' },
        capacidad: this.capacidad,
        patientId: input.patientId,
        recallTypeId: input.recallTypeId,
        assignedDoctorId: input.assignedDoctorId ?? null,
        source: 'manual',
        sourceEntityId: null,
        desde: input.desde,
        ahora: input.ahora ?? new Date(),
      }),
    );
  }
}

/**
 * Un tratamiento terminado abre el siguiente ciclo.
 *
 * SÓLO si la partida declara un `recall_type_id`. Nunca se infiere del texto
 * de la descripción: es campo libre que el odontólogo escribe a mano, y
 * adivinar ahí produce controles fantasma que recepción tiene que limpiar.
 */
@Injectable()
export class GenerateRecallFromCompletedTreatmentUseCase {
  private readonly logger = new Logger(GenerateRecallFromCompletedTreatmentUseCase.name);

  constructor(
    private readonly capacidad: CapacidadService,
    private readonly audit: AuditService,
    @Inject(RECALL_REPOSITORY) private readonly repo: RecallRepository,
  ) {}

  /** Recibe la transacción: lo invoca un consumidor de eventos. */
  async ejecutar(
    tx: Tx,
    input: {
      tenantId: string;
      patientId: string;
      partidaId: string;
      doctorId?: string | null;
      /** Cuándo se terminó el tratamiento, no cuándo se procesa el evento. */
      ocurrioEn: Date;
    },
  ): Promise<ResultadoAsignacion> {
    const recallTypeId =
      (await this.repo.tipoDePartida(tx, input.partidaId)) ?? null;
    if (!recallTypeId) {
      // No es un fallo: la inmensa mayoría de las partidas no genera control.
      return { recall: null, yaExistia: false };
    }
    const zona = await this.repo.zonaHoraria(tx);
    return crearControl(this.repo, this.audit, tx, {
      actor: { tipo: 'sistema', tenantId: input.tenantId, origen: 'worker' },
      capacidad: this.capacidad,
      patientId: input.patientId,
      recallTypeId,
      assignedDoctorId: input.doctorId ?? null,
      source: 'procedimiento',
      sourceEntityId: input.partidaId,
      // La fecha del HECHO, no la de hoy: un evento reconciliado tres días
      // tarde no debe correr el vencimiento tres días.
      desde: fechaLocal(input.ocurrioEn, zona),
      ahora: input.ocurrioEn,
      zona,
    });
  }
}

/**
 * Una inasistencia abre un seguimiento de reactivación.
 *
 * Sólo si la clínica lo configuró. El vencimiento son DÍAS desde la falta, no
 * el `interval_months` del tipo: reutilizar el intervalo del control periódico
 * daría un seguimiento dentro de seis meses para alguien que faltó ayer.
 */
@Injectable()
export class GenerateRecallFromNoShowUseCase {
  constructor(
    private readonly capacidad: CapacidadService,
    private readonly audit: AuditService,
    @Inject(RECALL_REPOSITORY) private readonly repo: RecallRepository,
  ) {}

  async ejecutar(
    tx: Tx,
    input: { tenantId: string; patientId: string; appointmentId: string; ocurrioEn: Date },
  ): Promise<ResultadoAsignacion> {
    await this.capacidad.asegurar(tx, MODULO, 'escritura');
    const config = await this.repo.leerConfiguracion(tx);
    if (!config.noShowRecallTypeId) throw new ReactivacionNoConfiguradaError();

    const tipo = await this.repo.buscarTipo(tx, config.noShowRecallTypeId);
    if (!tipo) throw new TipoRecallNoEncontradoError();
    if (!tipo.activo) throw new TipoRecallInactivoError(tipo.nombre);

    const zona = await this.repo.zonaHoraria(tx);
    const hoy = fechaLocal(input.ocurrioEn, zona);
    const dueDate = sumarDias(hoy, config.noShowDelayDays);

    const existente = await this.repo.buscarVivoPorTipo(tx, input.patientId, tipo.id);
    if (existente) return { recall: existente, yaExistia: true };

    const estado: EstadoRecall = {
      id: randomUUID(),
      patientId: input.patientId,
      recallTypeId: tipo.id,
      source: 'reactivacion',
      sourceEntityId: input.appointmentId,
      dueDate,
      status: dueDate <= hoy ? 'due' : 'pending',
      assignedDoctorId: null,
      appointmentId: null,
      lastContactAt: null,
      nextAttemptAt: null,
      completedAt: null,
      dismissReason: null,
      intentos: 0,
    };
    if (!(await this.repo.insertar(tx, estado))) {
      const vivo = await this.repo.buscarVivoPorTipo(tx, input.patientId, tipo.id);
      return { recall: vivo, yaExistia: true };
    }
    await auditar(this.audit, tx, { tipo: 'sistema', tenantId: input.tenantId, origen: 'worker' }, {
      entidad: 'PatientRecall',
      entidadId: estado.id,
      accion: 'crear',
      detalle: { source: 'reactivacion', dueDate },
    });
    return { recall: estado, yaExistia: false };
  }
}

/**
 * Camino común de alta. Vive aquí y no en cada caso de uso porque la regla
 * "un solo control vivo por paciente y tipo" tiene que resolverse igual venga
 * de recepción o del worker.
 */
async function crearControl(
  repo: RecallRepository,
  audit: AuditService,
  tx: Tx,
  input: {
    actor: ActorRecall;
    capacidad: CapacidadService;
    patientId: string;
    recallTypeId: string;
    assignedDoctorId: string | null;
    source: RecallSource;
    sourceEntityId: string | null;
    desde?: string;
    ahora: Date;
    zona?: string;
  },
): Promise<ResultadoAsignacion> {
  await input.capacidad.asegurar(tx, MODULO, 'escritura');

  const tipo = await repo.buscarTipo(tx, input.recallTypeId);
  if (!tipo) throw new TipoRecallNoEncontradoError();
  if (!tipo.activo) throw new TipoRecallInactivoError(tipo.nombre);

  const zona = input.zona ?? (await repo.zonaHoraria(tx));
  const hoy = fechaLocal(input.ahora, zona);

  const recall = PatientRecall.crear({
    id: randomUUID(),
    patientId: input.patientId,
    recallTypeId: tipo.id,
    source: input.source,
    sourceEntityId: input.sourceEntityId,
    assignedDoctorId: input.assignedDoctorId,
    fechaDelHecho: input.desde ?? hoy,
    hoy,
    reglas: tipo,
  });

  // Deja decidir al índice único parcial, no a un SELECT previo: entre la
  // comprobación y el INSERT cabe otro worker con el mismo evento. Y se
  // resuelve con ON CONFLICT en vez de atrapando la excepción, porque una
  // violación de restricción aborta la transacción entera y ya no se podría
  // ni consultar cuál era el control existente.
  if (!(await repo.insertar(tx, recall.snapshot))) {
    const vivo = await repo.buscarVivoPorTipo(tx, input.patientId, tipo.id);
    return { recall: vivo, yaExistia: true };
  }

  await auditar(audit, tx, input.actor, {
    entidad: 'PatientRecall',
    entidadId: recall.snapshot.id,
    accion: 'crear',
    detalle: { source: input.source, dueDate: recall.snapshot.dueDate },
  });
  return { recall: recall.snapshot, yaExistia: false };
}
