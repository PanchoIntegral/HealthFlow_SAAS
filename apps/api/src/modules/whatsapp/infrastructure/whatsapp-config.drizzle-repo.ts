import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { HorarioAtencion, WhatsappModo } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import { tenantWhatsappConfig } from '../../../db/schema';
import { WhatsappConfig } from '../domain/whatsapp-config.entity';
import type { WhatsappConfigRepository } from '../domain/whatsapp-config.repository';

/**
 * Adaptador Drizzle del puerto WhatsappConfigRepository.
 *
 * El `tenantId` va explícito en el WHERE aunque RLS ya lo garantice: aquí
 * también lee el scheduler, que abre la transacción con un tenant resuelto por
 * una función SECURITY DEFINER, y dejar el filtro escrito hace evidente en el
 * código qué clínica se está leyendo.
 */
@Injectable()
export class DrizzleWhatsappConfigRepository implements WhatsappConfigRepository {
  async find(tx: Tx, tenantId: string): Promise<WhatsappConfig | null> {
    const [fila] = await tx
      .select()
      .from(tenantWhatsappConfig)
      .where(eq(tenantWhatsappConfig.tenantId, tenantId))
      .limit(1);

    if (!fila) return null;

    return WhatsappConfig.fromState({
      tenantId: fila.tenantId,
      modo: fila.modo as WhatsappModo,
      wabaId: fila.wabaId,
      phoneNumberId: fila.phoneNumberId,
      accessTokenCifrado: fila.accessTokenCifrado,
      nombreRemitente: fila.nombreRemitente,
      activo: fila.activo,
      horasAnticipacion: fila.horasAnticipacion,
      enviarConfirmacion: fila.enviarConfirmacion,
      zonaHoraria: fila.zonaHoraria,
      silencioDesde: fila.silencioDesde,
      silencioHasta: fila.silencioHasta,
      horarioAtencion: fila.horarioAtencion as HorarioAtencion,
    });
  }

  async save(tx: Tx, config: WhatsappConfig): Promise<void> {
    const valores = {
      modo: config.modo,
      wabaId: config.wabaId,
      phoneNumberId: config.phoneNumberId,
      accessTokenCifrado: config.accessTokenCifrado,
      nombreRemitente: config.nombreRemitente,
      activo: config.activo,
      horasAnticipacion: config.horasAnticipacion,
      enviarConfirmacion: config.enviarConfirmacion,
      zonaHoraria: config.zonaHoraria,
      silencioDesde: config.silencioDesde,
      silencioHasta: config.silencioHasta,
      horarioAtencion: config.horarioAtencion,
    };

    // Una fila por tenant: upsert en vez de leer-y-decidir, que dejaría una
    // carrera entre dos pestañas de ajustes abiertas a la vez.
    await tx
      .insert(tenantWhatsappConfig)
      .values({ tenantId: config.tenantId, ...valores })
      .onConflictDoUpdate({
        target: tenantWhatsappConfig.tenantId,
        set: { ...valores, updatedAt: new Date() },
      });
  }
}
