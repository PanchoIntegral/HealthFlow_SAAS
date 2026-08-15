import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ActualizarDatosClinicaRequest } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import { DatosClinicaReader, type DatosClinica } from './datos-clinica.reader';

/**
 * Edita dirección y teléfono de la clínica — el membrete que llevan los
 * documentos impresos (hoy: la orden de plantillas ortopédicas). Guardado
 * como UPDATE directo y no vía un repositorio de tenants dedicado: es un solo
 * campo por columna sin más regla de negocio que "quién puede tocarlo", y esa
 * regla ya la impone el controlador (`RequirePolicy('manage', 'Cuenta')`).
 */
@Injectable()
export class ActualizarDatosClinicaUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly datosClinica: DatosClinicaReader,
  ) {}

  async execute(input: ActualizarDatosClinicaRequest): Promise<DatosClinica> {
    return this.tenantDb.run(async (tx) => {
      const anterior = await this.datosClinica.leer(tx);

      // Campo ausente ⇒ se conserva; cadena vacía ⇒ se borra. Mismo criterio
      // que `UpdatePerfilUseCase.conservar` para las cédulas.
      const conservar = (enviado: string | undefined, actual: string | null) =>
        enviado === undefined ? actual : enviado.trim() || null;

      const direccion = conservar(input.direccion, anterior.direccion);
      const telefono = conservar(input.telefono, anterior.telefono);

      await tx.execute(sql`
        UPDATE tenants SET direccion = ${direccion}, telefono = ${telefono}
      `);

      await this.audit.record(tx, {
        entidad: 'tenant',
        accion: 'update_datos_clinica',
        detalle: {
          direccionCambio: anterior.direccion !== direccion,
          telefonoCambio: anterior.telefono !== telefono,
        },
      });

      return { direccion, telefono };
    });
  }
}
