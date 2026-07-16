import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentRepository,
} from '../../appointments/domain/appointment.repository';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '../../notifications/domain/notification.repository';
import {
  NOTIFICATIONS_NOTIFIER,
  type NotificationsNotifier,
} from '../../notifications/application/notifications-notifier.port';
import { ConceptoCfdi, type TratamientoIva } from '../domain/concepto-cfdi.entity';
import { Factura } from '../domain/factura.entity';
import {
  EmisorNoConfiguradoError,
  FacturaYaEmitidaError,
  PacTimbradoError,
} from '../domain/factura.errors';
import { FACTURA_REPOSITORY, type FacturaRepository } from '../domain/factura.repository';
import {
  FACTURACION_PAC,
  type FacturacionPacPort,
  type TimbradoResult,
} from '../domain/facturacion-pac.port';
import { ReceptorFiscal } from '../domain/receptor-fiscal.entity';
import { toFacturaView, type FacturaView } from './factura.views';

export interface TimbrarFacturaInput {
  appointmentId: string;
  receptor: {
    rfc: string;
    razonSocial: string;
    regimenFiscal: string;
    codigoPostal: string;
    usoCfdi: string;
  };
  conceptos: {
    claveProdServ: string;
    claveUnidad: string;
    descripcion: string;
    cantidad: number;
    /** Precio unitario en PESOS (input HTTP); se convierte a centavos aquí. */
    valorUnitario: number;
    tratamientoIva?: TratamientoIva;
  }[];
}

/**
 * Timbrado de una factura sobre una cita.
 *
 * Diseño clave:
 * - El tenant NUNCA viene del input: fluye por AsyncLocalStorage (JWT) hacia
 *   TenantDbService/el repo. La cita se busca dentro de la transacción con
 *   tenant fijado — si es de otro tenant, RLS la oculta y respondemos 404 (IDOR).
 * - Los totales se derivan de los conceptos en la entidad; el cliente no puede
 *   mandar subtotal/total.
 * - Idempotencia en dos capas: pre-check de factura viva (409 amistoso) +
 *   índice único parcial en DB (cierra la carrera del doble submit).
 * - La llamada al PAC ocurre FUERA de la transacción (puede tardar segundos) y
 *   su resultado —éxito o error— SIEMPRE se persiste en una segunda
 *   transacción, para que la factura nunca quede en estado ambiguo.
 */
@Injectable()
export class TimbrarFacturaUseCase {
  private readonly logger = new Logger(TimbrarFacturaUseCase.name);

  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    @Inject(APPOINTMENT_REPOSITORY) private readonly appointments: AppointmentRepository,
    @Inject(FACTURA_REPOSITORY) private readonly facturas: FacturaRepository,
    @Inject(FACTURACION_PAC) private readonly pac: FacturacionPacPort,
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepository,
    @Inject(NOTIFICATIONS_NOTIFIER) private readonly notificationsNotifier: NotificationsNotifier,
  ) {}

  async execute(input: TimbrarFacturaInput): Promise<FacturaView> {
    const conceptos = input.conceptos.map(
      (c) =>
        new ConceptoCfdi({
          claveProdServ: c.claveProdServ,
          claveUnidad: c.claveUnidad,
          descripcion: c.descripcion,
          cantidad: c.cantidad,
          valorUnitarioCentavos: Math.round(c.valorUnitario * 100),
          tratamientoIva: c.tratamientoIva ?? 'EXENTO',
        }),
    );

    // Fase 1: validar y persistir la factura PENDIENTE (atómico).
    const { factura, emisor, receptor, doctorId } = await this.tenantDb.run(async (tx) => {
      const appointment = await this.appointments.findById(tx, input.appointmentId);
      if (!appointment) throw new NotFoundException('Cita no encontrada');

      const emisor = await this.facturas.findEmisorByTenant(tx);
      if (!emisor) throw new EmisorNoConfiguradoError();

      const existente = await this.facturas.findActivaByAppointment(tx, input.appointmentId);
      if (existente) throw new FacturaYaEmitidaError();

      const receptor = ReceptorFiscal.crear({
        patientId: null, // el vínculo cita→paciente ya existe; el receptor fiscal puede diferir
        ...input.receptor,
      });
      const receptorId = await this.facturas.saveReceptor(tx, receptor);

      const factura = Factura.crear({
        appointmentId: input.appointmentId,
        emisorId: emisor.id,
        receptorId,
        conceptos,
      });
      await this.facturas.insertPendiente(tx, factura, conceptos);

      await this.audit.record(tx, {
        entidad: 'factura',
        entidadId: factura.id,
        accion: 'crear_pendiente',
        detalle: { appointmentId: input.appointmentId },
      });

      return { factura, emisor, receptor, doctorId: appointment.doctorId };
    });

    // Fase 2: timbrar con el PAC, sin transacción abierta. El try/catch es
    // intencional: un fallo del PAC no debe dejar la factura en estado ambiguo.
    let resultado: TimbradoResult | null = null;
    let pacError: unknown = null;
    try {
      resultado = await this.pac.timbrar({
        facturaId: factura.id,
        emisor: {
          rfc: emisor.rfc.value,
          razonSocial: emisor.razonSocial,
          regimenFiscal: emisor.regimenFiscal,
          codigoPostal: emisor.codigoPostal,
        },
        receptor: {
          rfc: receptor.rfc.value,
          razonSocial: receptor.razonSocial,
          regimenFiscal: receptor.regimenFiscal,
          codigoPostal: receptor.codigoPostal,
          usoCfdi: receptor.usoCfdi,
        },
        conceptos: conceptos.map((c) => ({
          claveProdServ: c.claveProdServ,
          claveUnidad: c.claveUnidad,
          descripcion: c.descripcion,
          cantidad: c.cantidad,
          valorUnitarioCentavos: c.valorUnitarioCentavos,
          importeCentavos: c.importeCentavos,
          tratamientoIva: c.tratamientoIva,
        })),
        subtotalCentavos: factura.subtotalCentavos,
        ivaCentavos: factura.ivaCentavos,
        totalCentavos: factura.totalCentavos,
      });
    } catch (err) {
      pacError = err;
      // Detalle solo del lado del servidor; sin PII ni payloads.
      this.logger.error(`Timbrado falló para factura ${factura.id}`);
    }

    // Fase 3: persistir el resultado PASE LO QUE PASE.
    const notification = await this.tenantDb.run(async (tx) => {
      if (resultado) {
        factura.marcarTimbrada(resultado.uuidFiscal, resultado.pacRawId);
      } else {
        factura.marcarError(pacError instanceof PacTimbradoError ? 'PAC_RECHAZO' : 'PAC_ERROR');
      }
      await this.facturas.updateEstado(tx, factura);
      await this.audit.record(tx, {
        entidad: 'factura',
        entidadId: factura.id,
        accion: resultado ? 'timbrar' : 'timbrar_error',
        detalle: { estatus: factura.estatus },
      });

      if (resultado) return null;
      return this.notifications.create(tx, {
        userId: doctorId,
        appointmentId: input.appointmentId,
        tipo: 'factura_error',
        titulo: 'Falló el timbrado de una factura',
        mensaje: 'Reintenta desde la sala de espera',
      });
    });

    // Efecto externo: solo tras confirmar la transacción.
    if (notification) {
      this.notificationsNotifier.notificationCreated(this.ctx.get().tenantId, doctorId, {
        notification,
      });
    }

    if (!resultado) throw pacError instanceof PacTimbradoError ? pacError : new PacTimbradoError();

    return toFacturaView(factura, conceptos);
  }
}
