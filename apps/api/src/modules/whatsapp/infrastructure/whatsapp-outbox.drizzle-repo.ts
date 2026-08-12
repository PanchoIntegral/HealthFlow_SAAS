import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { WhatsappEstadoOutbox, WhatsappPlantilla } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type {
  CitaParaRecordar,
  MensajePendiente,
  WhatsappOutboxRepository,
} from '../domain/whatsapp-outbox.repository';

interface FilaCita {
  appointment_id: string;
  patient_id: string;
  paciente_nombre: string;
  doctor_nombre: string;
  inicio_programado: Date;
}

interface FilaPendiente {
  id: string;
  tenant_id: string;
  patient_id: string;
  appointment_id: string | null;
  plantilla: WhatsappPlantilla;
  variables: Record<string, string>;
  intentos: number;
  telefono_e164: string;
  paciente_nombre: string;
}

/**
 * Adaptador Drizzle del outbox. Todo corre bajo RLS: estas consultas se
 * ejecutan siempre dentro de un `runInTenant`, así que no llevan `tenant_id`
 * en el WHERE — lo inyecta Postgres.
 */
@Injectable()
export class DrizzleWhatsappOutboxRepository implements WhatsappOutboxRepository {
  async citasSinRecordatorio(
    tx: Tx,
    plantilla: WhatsappPlantilla,
    hasta: Date,
    ahora: Date,
  ): Promise<CitaParaRecordar[]> {
    const result = await tx.execute(sql`
      SELECT a.id            AS appointment_id,
             a.patient_id    AS patient_id,
             p.nombre        AS paciente_nombre,
             u.nombre        AS doctor_nombre,
             a.inicio_programado
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        JOIN users    u ON u.id = a.doctor_id
       WHERE a.estatus = 'agendada'
         AND a.inicio_programado > ${ahora.toISOString()}
         AND a.inicio_programado <= ${hasta.toISOString()}
         -- Consentimiento vigente y número al que mandar. También lo comprueba
         -- whatsapp_reclamar_pendientes() antes de enviar: si el paciente
         -- revoca el permiso después de encolarse, el mensaje no sale.
         AND p.whatsapp_opt_in
         AND p.telefono_e164 IS NOT NULL
         AND NOT EXISTS (
               SELECT 1 FROM whatsapp_outbox o
                WHERE o.appointment_id = a.id AND o.plantilla = ${plantilla}
             )
       ORDER BY a.inicio_programado
    `);
    return (result.rows as unknown as FilaCita[]).map((f) => ({
      appointmentId: f.appointment_id,
      patientId: f.patient_id,
      pacienteNombre: f.paciente_nombre,
      doctorNombre: f.doctor_nombre,
      inicioProgramado: new Date(f.inicio_programado),
    }));
  }

  async encolar(
    tx: Tx,
    input: {
      patientId: string;
      appointmentId: string | null;
      plantilla: WhatsappPlantilla;
      variables: Record<string, string>;
      programadoPara: Date;
    },
  ): Promise<boolean> {
    // El NOT EXISTS de citasSinRecordatorio es solo una optimización: entre esa
    // lectura y este INSERT cabe otro barrido. Quien impide de verdad el
    // duplicado es el índice único (appointment_id, plantilla) junto con este
    // ON CONFLICT, igual que el scan de notificaciones de 0007.
    const result = await tx.execute(sql`
      INSERT INTO whatsapp_outbox (patient_id, appointment_id, plantilla, variables, programado_para)
      VALUES (${input.patientId}, ${input.appointmentId}, ${input.plantilla},
              ${JSON.stringify(input.variables)}::jsonb, ${input.programadoPara.toISOString()})
      ON CONFLICT (appointment_id, plantilla) WHERE appointment_id IS NOT NULL
      DO NOTHING
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  async findPendiente(tx: Tx, outboxId: string): Promise<MensajePendiente | null> {
    const result = await tx.execute(sql`
      SELECT o.id, o.tenant_id, o.patient_id, o.appointment_id, o.plantilla,
             o.variables, o.intentos, p.telefono_e164, p.nombre AS paciente_nombre
        FROM whatsapp_outbox o
        JOIN patients p ON p.id = o.patient_id
       WHERE o.id = ${outboxId}
    `);
    const fila = (result.rows as unknown as FilaPendiente[])[0];
    if (!fila) return null;

    return {
      id: fila.id,
      tenantId: fila.tenant_id,
      patientId: fila.patient_id,
      appointmentId: fila.appointment_id,
      plantilla: fila.plantilla,
      variables: fila.variables ?? {},
      intentos: fila.intentos,
      telefonoE164: fila.telefono_e164,
      pacienteNombre: fila.paciente_nombre,
    };
  }

  async marcarEnviado(tx: Tx, outboxId: string, metaMessageId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE whatsapp_outbox
         SET estado = 'enviado',
             meta_message_id = ${metaMessageId},
             enviado_at = now(),
             ultimo_error = NULL
       WHERE id = ${outboxId}
    `);
  }

  async marcarFallo(
    tx: Tx,
    outboxId: string,
    error: string,
    reintentarEn: Date | null,
  ): Promise<void> {
    // El error se recorta aquí, en el borde: `ultimo_error` lo lee gente en la
    // pantalla de ajustes y un stack de varios KB no aporta nada.
    const recortado = error.slice(0, 500);

    if (reintentarEn === null) {
      await tx.execute(sql`
        UPDATE whatsapp_outbox
           SET estado = 'fallido', ultimo_error = ${recortado}
         WHERE id = ${outboxId}
      `);
      return;
    }

    await tx.execute(sql`
      UPDATE whatsapp_outbox
         SET estado = 'pendiente',
             programado_para = ${reintentarEn.toISOString()},
             reclamado_at = NULL,
             ultimo_error = ${recortado}
       WHERE id = ${outboxId}
    `);
  }

  async actualizarEstadoPorMessageId(
    tx: Tx,
    metaMessageId: string,
    estado: WhatsappEstadoOutbox,
    error?: string | null,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE whatsapp_outbox
         SET estado = ${estado},
             ultimo_error = ${error ? error.slice(0, 500) : null}
       WHERE meta_message_id = ${metaMessageId}
    `);
  }
}
