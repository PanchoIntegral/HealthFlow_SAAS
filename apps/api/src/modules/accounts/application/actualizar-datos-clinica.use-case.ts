import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ActualizarDatosClinicaRequest } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import { DatosClinicaReader, type DatosClinica } from './datos-clinica.reader';

/**
 * Edita el membrete de los documentos impresos: nombre, dirección y teléfono
 * de la clínica, la leyenda del pie y la apariencia de la receta. Guardado
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
      const leyendaPie = conservar(input.leyendaPie, anterior.leyendaPie);
      // El nombre no admite "borrar": una receta sin nombre de establecimiento
      // queda incompleta frente al art. 64 del RIS, así que vacío = conservar.
      const nombreClinica = input.nombreClinica?.trim() || anterior.nombreClinica;
      // La apariencia se manda completa o no se manda (ver ConfigReceta).
      const configReceta = input.configReceta ?? anterior.configReceta;

      await tx.execute(sql`
        UPDATE tenants
           SET nombre_clinica = ${nombreClinica},
               direccion = ${direccion},
               telefono = ${telefono},
               leyenda_pie = ${leyendaPie},
               config_receta = ${JSON.stringify(configReceta)}::jsonb
      `);

      await this.audit.record(tx, {
        entidad: 'tenant',
        accion: 'update_datos_clinica',
        detalle: {
          direccionCambio: anterior.direccion !== direccion,
          telefonoCambio: anterior.telefono !== telefono,
          leyendaPieCambio: anterior.leyendaPie !== leyendaPie,
          nombreCambio: anterior.nombreClinica !== nombreClinica,
          aparienciaCambio: JSON.stringify(anterior.configReceta) !== JSON.stringify(configReceta),
        },
      });

      return {
        nombreClinica,
        configReceta,
        direccion,
        telefono,
        leyendaPie,
        logoStorageKey: anterior.logoStorageKey,
      };
    });
  }
}
