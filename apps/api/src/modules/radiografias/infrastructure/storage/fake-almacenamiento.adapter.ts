import { Injectable } from '@nestjs/common';
import type {
  AlmacenamientoPort,
  ObjetoAlmacenado,
  SubidaDirecta,
} from '../../domain/almacenamiento.port';

/**
 * Storage falso para desarrollo local y pruebas: no toca red ni R2 real. Se
 * selecciona vía useClass en radiografias.module.ts (NODE_ENV=test o
 * STORAGE_PROVIDER=fake), mismo patrón que FakePacAdapter en billing.
 */
@Injectable()
export class FakeAlmacenamientoAdapter implements AlmacenamientoPort {
  /** Claves "subidas" en esta sesión, para que las pruebas puedan inspeccionar. */
  readonly objetos = new Set<string>();

  async presignedUploadUrl(key: string, mimeType: string): Promise<SubidaDirecta> {
    this.objetos.add(key);
    return {
      url: `https://fake-storage.local/objeto/${key}`,
      headers: { 'Content-Type': mimeType },
    };
  }

  async verificarObjeto(key: string): Promise<ObjetoAlmacenado> {
    return this.objetos.has(key) ? { existe: true, tamanoBytes: 1 } : { existe: false };
  }

  async presignedGetUrl(key: string): Promise<string> {
    return `https://fake-storage.local/view/${key}`;
  }

  async eliminar(key: string): Promise<void> {
    this.objetos.delete(key);
  }
}
