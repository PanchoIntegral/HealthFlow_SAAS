import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import {
  ALMACENAMIENTO_PORT,
  type AlmacenamientoPort,
  type DiagnosticoStorage,
} from '../domain/almacenamiento.port';

export interface ReporteStorage {
  /** true solo si el ciclo completo (firmar → subir → leer → borrar) funcionó. */
  ok: boolean;
  pasos: { paso: string; ok: boolean; detalle?: string }[];
  proveedor: DiagnosticoStorage;
}

/**
 * Prueba el ciclo COMPLETO de subida contra el storage real, desde el
 * servidor: firma una URL de subida, sube con ella un objeto de prueba, lo
 * lee con otra URL firmada y lo borra.
 *
 * Para qué: cuando un usuario reporta "no se puede subir la radiografía", esto
 * separa en un solo paso las dos familias de causa. Si aquí sale todo OK, el
 * storage y las credenciales están bien y el problema es del navegador —en la
 * práctica, CORS del bucket, que el servidor NO sufre. Si algo falla aquí, es
 * configuración del servidor y el detalle dice cuál.
 *
 * El objeto de prueba se sube bajo `diagnostico/` y se borra al terminar.
 */
@Injectable()
export class DiagnosticarStorageUseCase {
  private readonly logger = new Logger(DiagnosticarStorageUseCase.name);

  constructor(
    private readonly ctx: RequestContextService,
    @Inject(ALMACENAMIENTO_PORT) private readonly storage: AlmacenamientoPort,
  ) {}

  async execute(): Promise<ReporteStorage> {
    const { tenantId } = this.ctx.get();
    const key = `diagnostico/${tenantId}/${randomUUID()}.png`;
    const pasos: ReporteStorage['pasos'] = [];

    // 1x1 PNG transparente: el archivo válido más pequeño que existe.
    const contenido = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );

    let subido = false;
    try {
      const subida = await this.storage.presignedUploadUrl(key, 'image/png');
      pasos.push({ paso: 'firmar-url', ok: true, detalle: origenDe(subida.url) });

      const res = await fetch(subida.url, {
        method: 'PUT',
        headers: subida.headers,
        body: contenido,
      });
      subido = res.ok;
      pasos.push({
        paso: 'subir',
        ok: res.ok,
        detalle: res.ok ? undefined : `${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`,
      });

      if (res.ok) {
        const url = await this.storage.presignedGetUrl(key);
        const lectura = await fetch(url);
        pasos.push({
          paso: 'leer',
          ok: lectura.ok,
          detalle: lectura.ok ? undefined : `${lectura.status}`,
        });
      }
    } catch (e) {
      pasos.push({ paso: 'ciclo', ok: false, detalle: e instanceof Error ? e.message : String(e) });
    } finally {
      if (subido) {
        // No dejar basura en el bucket aunque la lectura haya fallado.
        await this.storage.eliminar(key).catch((e: unknown) => {
          pasos.push({ paso: 'borrar', ok: false, detalle: String(e) });
        });
      }
    }

    const proveedor = (await this.storage.diagnostico?.()) ?? {
      ok: true,
      detalles: { nota: 'El adaptador en uso no reporta estado (dev).' },
    };

    const reporte = { ok: pasos.every((p) => p.ok), pasos, proveedor };
    this.logger.log(`Diagnóstico de storage: ${JSON.stringify(reporte)}`);
    return reporte;
  }
}

function origenDe(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}
