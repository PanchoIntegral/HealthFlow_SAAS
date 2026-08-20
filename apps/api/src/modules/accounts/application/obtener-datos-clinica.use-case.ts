import { Inject, Injectable } from '@nestjs/common';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { ALMACENAMIENTO_PORT, type AlmacenamientoPort } from '../../radiografias/domain/almacenamiento.port';
import { DatosClinicaReader, type DatosClinica } from './datos-clinica.reader';

export interface DatosClinicaConLogo extends DatosClinica {
  /** URL firmada de lectura, resuelta en esta misma petición. null = sin logo. */
  logoUrl: string | null;
}

/**
 * Lectura de los datos de la clínica para Ajustes → Receta. Separado de
 * `ActualizarDatosClinicaUseCase` porque ese devuelve la clave de storage sin
 * resolver (no necesita firmar una URL en cada PATCH de dirección/teléfono);
 * este sí, porque es lo que la sección de Ajustes pinta como preview.
 */
@Injectable()
export class ObtenerDatosClinicaUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly datosClinica: DatosClinicaReader,
    @Inject(ALMACENAMIENTO_PORT) private readonly storage: AlmacenamientoPort,
  ) {}

  async execute(): Promise<DatosClinicaConLogo> {
    return this.tenantDb.run(async (tx) => {
      const datos = await this.datosClinica.leer(tx);
      const logoUrl = datos.logoStorageKey
        ? await this.storage.presignedGetUrl(datos.logoStorageKey)
        : null;
      return { ...datos, logoUrl };
    });
  }
}
