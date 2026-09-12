import { NotFoundException } from '@nestjs/common';
import type { Tx } from '../../../db/drizzle';
import type { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import type { RequestContextService } from '../../../common/tenant-context/request-context';
import type { AuditService, AuditEntry } from '../../../common/audit/audit.service';
import type { AppEventsService } from '../../../common/events/app-events.service';
import type {
  AppointmentView,
  DoctorSummary,
  NotificationView,
  WaitingRoomEntry,
} from '@healthflow/shared-types';
import { Appointment } from '../domain/appointment.entity';
import { InvalidAppointmentTransitionError, DoctorDoubleBookedError } from '../domain/appointment.errors';
import type { AppointmentRepository, NewAppointmentInput } from '../domain/appointment.repository';
import type {
  CreateNotificationInput,
  NotificationRepository,
} from '../../notifications/domain/notification.repository';
import type { WaitingRoomNotifier } from './waiting-room-notifier.port';
import type { NotificationsNotifier } from '../../notifications/application/notifications-notifier.port';
import { ScheduleAppointmentUseCase } from './schedule-appointment.use-case';
import { CheckInUseCase } from './check-in.use-case';
import { CancelAppointmentUseCase } from './cancel-appointment.use-case';
import { ListAppointmentsUseCase } from './list-appointments.use-case';
import { ListWaitingRoomUseCase } from './list-waiting-room.use-case';
import { ListDoctorsUseCase } from './list-doctors.use-case';

/**
 * Repositorio de citas EN MEMORIA, con dos pacientes de "control" (Ana y
 * Beto) precargados a propósito. Buena parte de estas pruebas existe para
 * confirmar algo puntual: que operar sobre la cita de un paciente NUNCA lee
 * ni escribe sobre la cita del otro. Es el reporte que motivó esta suite —
 * notas que "a veces" aparecían cruzadas entre pacientes— llevado al nivel de
 * caso de uso, con un repositorio real (aunque en memoria) en vez de mocks
 * que solo confirmarían que el código llama lo que uno espera que llame.
 */
class FakeAppointmentRepository implements AppointmentRepository {
  citas = new Map<string, Appointment>();
  vistas = new Map<string, AppointmentView>();
  private seq = 0;

  /** Da de alta una cita ya "agendada", lista para transicionar en la prueba. */
  seed(over: Partial<AppointmentView> & { patientId: string; doctorId: string }): string {
    const id = over.id ?? `apt-${++this.seq}`;
    const inicioProgramado = over.inicioProgramado ?? new Date().toISOString();
    const finProgramado = over.finProgramado ?? new Date(Date.now() + 30 * 60_000).toISOString();

    this.citas.set(
      id,
      Appointment.fromState({
        id,
        tenantId: 'tenant-1',
        patientId: over.patientId,
        doctorId: over.doctorId,
        estatus: over.estatus ?? 'agendada',
        finProgramado: new Date(finProgramado),
        checkinAt: null,
        inicioReal: null,
        finReal: null,
      }),
    );
    this.vistas.set(id, {
      id,
      patientId: over.patientId,
      patientNombre: over.patientNombre ?? 'Paciente',
      doctorId: over.doctorId,
      doctorNombre: over.doctorNombre ?? 'Dra. Prueba',
      motivo: over.motivo ?? null,
      inicioProgramado,
      finProgramado,
      estatus: over.estatus ?? 'agendada',
      origen: over.origen ?? 'interno',
      estadoConfirmacion: over.estadoConfirmacion ?? 'pendiente',
      posibleDuplicado: over.posibleDuplicado ?? false,
    });
    return id;
  }

  async findById(_tx: Tx, id: string): Promise<Appointment | null> {
    return this.citas.get(id) ?? null;
  }

  async save(_tx: Tx, appointment: Appointment): Promise<void> {
    this.citas.set(appointment.id, appointment);
    const vista = this.vistas.get(appointment.id);
    if (vista) this.vistas.set(appointment.id, { ...vista, estatus: appointment.estatus });
  }

  async listWaitingRoom(_tx: Tx): Promise<WaitingRoomEntry[]> {
    return [...this.vistas.values()].map(toWaitingRoomEntry);
  }

  async findWaitingRoomEntry(
    _tx: Tx,
    appointmentId: string,
    _opts?: { soloHoy?: boolean },
  ): Promise<WaitingRoomEntry | null> {
    const vista = this.vistas.get(appointmentId);
    return vista ? toWaitingRoomEntry(vista) : null;
  }

  async create(_tx: Tx, input: NewAppointmentInput): Promise<string> {
    return this.seed({
      patientId: input.patientId,
      doctorId: input.doctorId,
      motivo: input.motivo,
      inicioProgramado: input.inicioProgramado.toISOString(),
      finProgramado: input.finProgramado.toISOString(),
      estatus: 'agendada',
    });
  }

  async listByRange(_tx: Tx, _from: Date, _to: Date): Promise<AppointmentView[]> {
    return [...this.vistas.values()];
  }

  async findView(_tx: Tx, appointmentId: string): Promise<AppointmentView | null> {
    return this.vistas.get(appointmentId) ?? null;
  }

  async hasOverlap(
    _tx: Tx,
    doctorId: string,
    inicioProgramado: Date,
    finProgramado: Date,
    excludeAppointmentId?: string,
  ): Promise<boolean> {
    return [...this.vistas.values()].some(
      (v) =>
        v.id !== excludeAppointmentId &&
        v.doctorId === doctorId &&
        v.estatus !== 'cancelada' &&
        v.estatus !== 'no_asistio' &&
        new Date(v.inicioProgramado) < finProgramado &&
        new Date(v.finProgramado) > inicioProgramado,
    );
  }

  async listDoctors(_tx: Tx): Promise<DoctorSummary[]> {
    return [{ id: 'doc-1', nombre: 'Dra. Prueba', especialidad: 'general' }];
  }
}

function toWaitingRoomEntry(v: AppointmentView): WaitingRoomEntry {
  return {
    appointmentId: v.id,
    patientId: v.patientId,
    patientNombre: v.patientNombre,
    patientEdad: 30,
    estatus: v.estatus,
    motivo: v.motivo,
    inicioProgramado: v.inicioProgramado,
    checkinAt: null,
  };
}

class FakeNotificationRepository implements NotificationRepository {
  creadas: (CreateNotificationInput & { id: string })[] = [];
  private seq = 0;

  async listForUser(): Promise<NotificationView[]> {
    return [];
  }

  async create(_tx: Tx, input: CreateNotificationInput): Promise<NotificationView> {
    const id = `notif-${++this.seq}`;
    this.creadas.push({ ...input, id });
    return {
      id,
      tipo: input.tipo,
      titulo: input.titulo,
      mensaje: input.mensaje,
      appointmentId: input.appointmentId,
      leidaAt: null,
      createdAt: new Date().toISOString(),
    };
  }

  async markRead(): Promise<boolean> {
    return true;
  }

  async markAllRead(): Promise<void> {}

}

const fakeTenantDb = { run: <T>(fn: (tx: Tx) => Promise<T>) => fn({} as Tx) } as TenantDbService;

function fakeCtx(overrides: Partial<{ tenantId: string; userId: string }> = {}) {
  return {
    get: () => ({
      tenantId: overrides.tenantId ?? 'tenant-1',
      userId: overrides.userId ?? 'user-1',
      rol: 'medico' as const,
    }),
  } as RequestContextService;
}

function fakeAudit() {
  const llamadas: AuditEntry[] = [];
  return {
    audit: { record: async (_tx: Tx, entry: AuditEntry) => void llamadas.push(entry) } as AuditService,
    llamadas,
  };
}

/** Doble del bus: guarda lo emitido para poder afirmarlo. */
function fakeEventos() {
  const emitidos: { tipo: string; payload?: Record<string, unknown> }[] = [];
  return {
    eventos: {
      emitir: async (_tx: Tx, evento: { tipo: string; payload?: Record<string, unknown> }) => {
        emitidos.push(evento);
        return 'evt-1';
      },
    } as unknown as AppEventsService,
    emitidos,
  };
}

function fakeWaitingRoomNotifier() {
  const eventos: { tenantId: string; entry: WaitingRoomEntry; previousStatus: string | null }[] = [];
  return {
    notifier: {
      appointmentUpdated: (tenantId, event) =>
        void eventos.push({ tenantId, entry: event.entry, previousStatus: event.previousStatus }),
    } as WaitingRoomNotifier,
    eventos,
  };
}

function fakeNotificationsNotifier() {
  const eventos: { tenantId: string; userId: string; notification: NotificationView }[] = [];
  return {
    notifier: {
      notificationCreated: (tenantId, userId, event) =>
        void eventos.push({ tenantId, userId, notification: event.notification }),
    } as NotificationsNotifier,
    eventos,
  };
}

describe('ScheduleAppointmentUseCase', () => {
  it('agenda la cita y la deja en estatus "agendada"', async () => {
    const repo = new FakeAppointmentRepository();
    const { audit } = fakeAudit();
    const { notifier } = fakeWaitingRoomNotifier();
    const useCase = new ScheduleAppointmentUseCase(fakeTenantDb, fakeCtx(), audit, fakeEventos().eventos, repo, notifier);

    const inicio = new Date(Date.now() + 3600_000);
    const view = await useCase.execute({
      patientId: 'pac-ana',
      doctorId: 'doc-1',
      inicioProgramado: inicio.toISOString(),
      finProgramado: new Date(inicio.getTime() + 1800_000).toISOString(),
    });

    expect(view.patientId).toBe('pac-ana');
    expect(view.estatus).toBe('agendada');
  });

  it('rechaza el rango horario inválido ANTES de tocar el repositorio', async () => {
    const repo = new FakeAppointmentRepository();
    const { audit } = fakeAudit();
    const { notifier } = fakeWaitingRoomNotifier();
    const useCase = new ScheduleAppointmentUseCase(fakeTenantDb, fakeCtx(), audit, fakeEventos().eventos, repo, notifier);

    const t = new Date().toISOString();
    await expect(
      useCase.execute({ patientId: 'pac-ana', doctorId: 'doc-1', inicioProgramado: t, finProgramado: t }),
    ).rejects.toThrow('horario');
    expect(repo.citas.size).toBe(0);
  });

  it('rechaza agendar si el médico ya tiene una cita traslapada', async () => {
    const repo = new FakeAppointmentRepository();
    const inicio = new Date(Date.now() + 3600_000);
    repo.seed({
      patientId: 'pac-ana',
      doctorId: 'doc-1',
      inicioProgramado: inicio.toISOString(),
      finProgramado: new Date(inicio.getTime() + 1800_000).toISOString(),
    });
    const { audit } = fakeAudit();
    const { notifier } = fakeWaitingRoomNotifier();
    const useCase = new ScheduleAppointmentUseCase(fakeTenantDb, fakeCtx(), audit, fakeEventos().eventos, repo, notifier);

    await expect(
      useCase.execute({
        patientId: 'pac-beto', // otro paciente, MISMO médico, mismo horario
        doctorId: 'doc-1',
        inicioProgramado: inicio.toISOString(),
        finProgramado: new Date(inicio.getTime() + 1800_000).toISOString(),
      }),
    ).rejects.toThrow(DoctorDoubleBookedError);
    expect(repo.citas.size).toBe(1); // la segunda nunca se creó
  });

  it('permite el mismo horario con OTRO médico (el traslape es por médico, no global)', async () => {
    const repo = new FakeAppointmentRepository();
    const inicio = new Date(Date.now() + 3600_000);
    repo.seed({
      patientId: 'pac-ana',
      doctorId: 'doc-1',
      inicioProgramado: inicio.toISOString(),
      finProgramado: new Date(inicio.getTime() + 1800_000).toISOString(),
    });
    const { audit } = fakeAudit();
    const { notifier } = fakeWaitingRoomNotifier();
    const useCase = new ScheduleAppointmentUseCase(fakeTenantDb, fakeCtx(), audit, fakeEventos().eventos, repo, notifier);

    const view = await useCase.execute({
      patientId: 'pac-beto',
      doctorId: 'doc-2',
      inicioProgramado: inicio.toISOString(),
      finProgramado: new Date(inicio.getTime() + 1800_000).toISOString(),
    });
    expect(view.patientId).toBe('pac-beto');
  });

  it('deja rastro en auditoría con el paciente y médico correctos', async () => {
    const repo = new FakeAppointmentRepository();
    const { audit, llamadas } = fakeAudit();
    const { notifier } = fakeWaitingRoomNotifier();
    const useCase = new ScheduleAppointmentUseCase(fakeTenantDb, fakeCtx(), audit, fakeEventos().eventos, repo, notifier);

    const inicio = new Date(Date.now() + 3600_000);
    await useCase.execute({
      patientId: 'pac-ana',
      doctorId: 'doc-1',
      inicioProgramado: inicio.toISOString(),
      finProgramado: new Date(inicio.getTime() + 1800_000).toISOString(),
    });

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.accion).toBe('schedule');
    expect(llamadas[0]?.detalle).toMatchObject({ patientId: 'pac-ana', doctorId: 'doc-1' });
  });
});

describe('CheckInUseCase', () => {
  it('transiciona agendada → en_espera y notifica por WebSocket', async () => {
    const repo = new FakeAppointmentRepository();
    const id = repo.seed({ patientId: 'pac-ana', doctorId: 'doc-1', patientNombre: 'Ana' });
    const { audit } = fakeAudit();
    const { notifier, eventos } = fakeWaitingRoomNotifier();
    const notifications = new FakeNotificationRepository();
    const { notifier: notiNotifier } = fakeNotificationsNotifier();
    const useCase = new CheckInUseCase(fakeTenantDb, fakeCtx(), audit, repo, notifier, notifications, notiNotifier);

    const entry = await useCase.execute(id);

    expect(entry.estatus).toBe('en_espera');
    expect(entry.patientNombre).toBe('Ana');
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.previousStatus).toBe('agendada');
  });

  it('checkear una cita NO toca a ninguna otra cita del repositorio', async () => {
    const repo = new FakeAppointmentRepository();
    const idAna = repo.seed({ patientId: 'pac-ana', doctorId: 'doc-1', patientNombre: 'Ana' });
    const idBeto = repo.seed({ patientId: 'pac-beto', doctorId: 'doc-1', patientNombre: 'Beto' });
    const { audit } = fakeAudit();
    const { notifier } = fakeWaitingRoomNotifier();
    const notifications = new FakeNotificationRepository();
    const { notifier: notiNotifier } = fakeNotificationsNotifier();
    const useCase = new CheckInUseCase(fakeTenantDb, fakeCtx(), audit, repo, notifier, notifications, notiNotifier);

    await useCase.execute(idAna);

    expect(repo.citas.get(idAna)!.estatus).toBe('en_espera');
    expect(repo.citas.get(idBeto)!.estatus).toBe('agendada'); // intacta
  });

  it('notifica al médico ASIGNADO a esa cita, no a otro', async () => {
    const repo = new FakeAppointmentRepository();
    const id = repo.seed({ patientId: 'pac-ana', doctorId: 'doc-dra-lopez', patientNombre: 'Ana' });
    const { audit } = fakeAudit();
    const { notifier } = fakeWaitingRoomNotifier();
    const notifications = new FakeNotificationRepository();
    const { notifier: notiNotifier, eventos } = fakeNotificationsNotifier();
    const useCase = new CheckInUseCase(fakeTenantDb, fakeCtx(), audit, repo, notifier, notifications, notiNotifier);

    await useCase.execute(id);

    expect(notifications.creadas).toHaveLength(1);
    expect(notifications.creadas[0]?.userId).toBe('doc-dra-lopez');
    expect(eventos[0]?.userId).toBe('doc-dra-lopez');
  });

  it('404 si la cita no existe', async () => {
    const repo = new FakeAppointmentRepository();
    const { audit } = fakeAudit();
    const { notifier } = fakeWaitingRoomNotifier();
    const notifications = new FakeNotificationRepository();
    const { notifier: notiNotifier } = fakeNotificationsNotifier();
    const useCase = new CheckInUseCase(fakeTenantDb, fakeCtx(), audit, repo, notifier, notifications, notiNotifier);

    await expect(useCase.execute('no-existe')).rejects.toThrow(NotFoundException);
  });

  it('rechaza el check-in si la cita no está en "agendada" (p.ej. ya en consulta)', async () => {
    const repo = new FakeAppointmentRepository();
    const id = repo.seed({ patientId: 'pac-ana', doctorId: 'doc-1', estatus: 'en_consulta' });
    const { audit } = fakeAudit();
    const { notifier } = fakeWaitingRoomNotifier();
    const notifications = new FakeNotificationRepository();
    const { notifier: notiNotifier } = fakeNotificationsNotifier();
    const useCase = new CheckInUseCase(fakeTenantDb, fakeCtx(), audit, repo, notifier, notifications, notiNotifier);

    await expect(useCase.execute(id)).rejects.toThrow(InvalidAppointmentTransitionError);
    expect(notifications.creadas).toHaveLength(0); // no hay efecto secundario a medias
  });
});

describe('CancelAppointmentUseCase', () => {
  it('cancela y guarda el motivo en auditoría', async () => {
    const repo = new FakeAppointmentRepository();
    const id = repo.seed({ patientId: 'pac-ana', doctorId: 'doc-1' });
    const { audit, llamadas } = fakeAudit();
    const { notifier } = fakeWaitingRoomNotifier();
    const notifications = new FakeNotificationRepository();
    const { notifier: notiNotifier } = fakeNotificationsNotifier();
    const useCase = new CancelAppointmentUseCase(fakeTenantDb, fakeCtx(), audit, fakeEventos().eventos, repo, notifier, notifications, notiNotifier);

    const view = await useCase.execute(id, 'Paciente reagenda');

    expect(view.estatus).toBe('cancelada');
    expect(llamadas[0]?.detalle).toMatchObject({ motivo: 'Paciente reagenda' });
  });

  it('cancelar la cita de un paciente no cambia el estatus de la de otro', async () => {
    const repo = new FakeAppointmentRepository();
    const idAna = repo.seed({ patientId: 'pac-ana', doctorId: 'doc-1' });
    const idBeto = repo.seed({ patientId: 'pac-beto', doctorId: 'doc-1' });
    const { audit } = fakeAudit();
    const { notifier } = fakeWaitingRoomNotifier();
    const notifications = new FakeNotificationRepository();
    const { notifier: notiNotifier } = fakeNotificationsNotifier();
    const useCase = new CancelAppointmentUseCase(fakeTenantDb, fakeCtx(), audit, fakeEventos().eventos, repo, notifier, notifications, notiNotifier);

    await useCase.execute(idAna);

    expect(repo.citas.get(idAna)!.estatus).toBe('cancelada');
    expect(repo.citas.get(idBeto)!.estatus).toBe('agendada');
  });

  it('404 si la cita no existe', async () => {
    const repo = new FakeAppointmentRepository();
    const { audit } = fakeAudit();
    const { notifier } = fakeWaitingRoomNotifier();
    const notifications = new FakeNotificationRepository();
    const { notifier: notiNotifier } = fakeNotificationsNotifier();
    const useCase = new CancelAppointmentUseCase(fakeTenantDb, fakeCtx(), audit, fakeEventos().eventos, repo, notifier, notifications, notiNotifier);

    await expect(useCase.execute('no-existe')).rejects.toThrow(NotFoundException);
  });

  it('rechaza cancelar una cita ya finalizada (estado terminal)', async () => {
    const repo = new FakeAppointmentRepository();
    const id = repo.seed({ patientId: 'pac-ana', doctorId: 'doc-1', estatus: 'finalizada' });
    const { audit } = fakeAudit();
    const { notifier } = fakeWaitingRoomNotifier();
    const notifications = new FakeNotificationRepository();
    const { notifier: notiNotifier } = fakeNotificationsNotifier();
    const useCase = new CancelAppointmentUseCase(fakeTenantDb, fakeCtx(), audit, fakeEventos().eventos, repo, notifier, notifications, notiNotifier);

    await expect(useCase.execute(id)).rejects.toThrow(InvalidAppointmentTransitionError);
  });
});

describe('Lecturas: cada una pide su propia transacción con tenant fijado', () => {
  it('ListAppointmentsUseCase delega en el repositorio con el rango pedido', async () => {
    const repo = new FakeAppointmentRepository();
    repo.seed({ patientId: 'pac-ana', doctorId: 'doc-1' });
    const useCase = new ListAppointmentsUseCase(fakeTenantDb, repo);

    const result = await useCase.execute(new Date(0), new Date());
    expect(result).toHaveLength(1);
  });

  it('ListWaitingRoomUseCase devuelve lo que reporta el repositorio, sin transformarlo', async () => {
    const repo = new FakeAppointmentRepository();
    repo.seed({ patientId: 'pac-ana', doctorId: 'doc-1', patientNombre: 'Ana' });
    repo.seed({ patientId: 'pac-beto', doctorId: 'doc-1', patientNombre: 'Beto' });
    const useCase = new ListWaitingRoomUseCase(fakeTenantDb, repo);

    const result = await useCase.execute();
    expect(result.map((r) => r.patientNombre).sort()).toEqual(['Ana', 'Beto']);
  });

  it('ListDoctorsUseCase delega en el repositorio', async () => {
    const repo = new FakeAppointmentRepository();
    const useCase = new ListDoctorsUseCase(fakeTenantDb, repo);

    const result = await useCase.execute();
    expect(result).toEqual([{ id: 'doc-1', nombre: 'Dra. Prueba', especialidad: 'general' }]);
  });
});
