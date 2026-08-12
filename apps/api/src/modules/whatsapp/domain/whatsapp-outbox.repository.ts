import type { WhatsappEstadoOutbox, WhatsappPlantilla } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';

export const WHATSAPP_OUTBOX_REPOSITORY = Symbol('WHATSAPP_OUTBOX_REPOSITORY');

/** Lo que hace falta para armar y mandar un mensaje ya reclamado. */
export interface MensajePendiente {
  id: string;
  tenantId: string;
  patientId: string;
  appointmentId: string | null;
  plantilla: WhatsappPlantilla;
  variables: Record<string, string>;
  intentos: number;
  telefonoE164: string;
  pacienteNombre: string;
}

/** Cita candidata a recordatorio, ya filtrada por consentimiento y estado. */
export interface CitaParaRecordar {
  appointmentId: string;
  patientId: string;
  pacienteNombre: string;
  doctorNombre: string;
  inicioProgramado: Date;
}

export interface WhatsappOutboxRepository {
  /**
   * Citas del tenant activo dentro de la ventana que aún no tienen fila en el
   * outbox para esa plantilla.
   */
  citasSinRecordatorio(
    tx: Tx,
    plantilla: WhatsappPlantilla,
    hasta: Date,
    ahora: Date,
  ): Promise<CitaParaRecordar[]>;

  /**
   * Encola un mensaje. Devuelve `false` si ya había uno para esa cita y
   * plantilla: la unicidad la impone el índice de la base, no una lectura
   * previa, así que dos barridos solapados no pueden duplicar el aviso.
   */
  encolar(
    tx: Tx,
    input: {
      patientId: string;
      appointmentId: string | null;
      plantilla: WhatsappPlantilla;
      variables: Record<string, string>;
      programadoPara: Date;
    },
  ): Promise<boolean>;

  /** Lee una fila ya reclamada, junto con los datos del paciente. */
  findPendiente(tx: Tx, outboxId: string): Promise<MensajePendiente | null>;

  /** Envío aceptado por Meta. */
  marcarEnviado(tx: Tx, outboxId: string, metaMessageId: string): Promise<void>;

  /**
   * Falló. Si es reintentable vuelve a 'pendiente' con `programadoPara`
   * corrido; si no, queda 'fallido' y no se vuelve a tocar.
   */
  marcarFallo(
    tx: Tx,
    outboxId: string,
    error: string,
    reintentarEn: Date | null,
  ): Promise<void>;

  /** Avance de estado reportado por el webhook (nunca hacia atrás). */
  actualizarEstadoPorMessageId(
    tx: Tx,
    metaMessageId: string,
    estado: WhatsappEstadoOutbox,
    error?: string | null,
  ): Promise<void>;
}
