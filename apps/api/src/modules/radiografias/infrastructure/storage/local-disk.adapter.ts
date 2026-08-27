import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { Injectable } from '@nestjs/common';
import { env } from '../../../../config/env';
import type {
  AlmacenamientoPort,
  ObjetoAlmacenado,
  SubidaDirecta,
} from '../../domain/almacenamiento.port';

const UPLOAD_TTL_SEGUNDOS = 5 * 60;
const GET_TTL_SEGUNDOS = 60 * 60;

/**
 * Almacenamiento en DISCO para desarrollo local: mismo flujo que R2 (política
 * de subida directa + URLs de lectura firmadas de vida corta), pero el
 * "storage" es una carpeta del proyecto y quien firma/sirve es el propio API
 * (ver DevStorageController).
 *
 * Existe porque FakeAlmacenamientoAdapter devuelve URLs a un host inventado
 * (fake-storage.local): sirve para pruebas unitarias, pero en el navegador la
 * subida falla siempre. Este adaptador sí guarda el archivo y sí lo muestra,
 * sin necesitar credenciales de R2.
 *
 * NO es para producción: las firmas usan JWT_SECRET y los archivos viven en el
 * disco del proceso. En producción va R2Adapter.
 */
@Injectable()
export class LocalDiskAlmacenamientoAdapter implements AlmacenamientoPort {
  async presignedUploadUrl(key: string, mimeType: string): Promise<SubidaDirecta> {
    const exp = expiraEn(UPLOAD_TTL_SEGUNDOS);
    const params = new URLSearchParams({
      key,
      exp: String(exp),
      firma: firmar('upload', key, exp),
    });
    // Mismo método y misma forma que R2 (PUT con el archivo como body): si dev
    // y producción no suben igual, dev deja de probar lo que importa — que es
    // exactamente cómo se coló el bug de la subida contra R2.
    return {
      url: `${env.apiPublicUrl}/api/dev-storage/objeto?${params.toString()}`,
      headers: { 'Content-Type': mimeType },
    };
  }

  async presignedGetUrl(key: string): Promise<string> {
    const exp = expiraEn(GET_TTL_SEGUNDOS);
    const params = new URLSearchParams({ key, exp: String(exp), firma: firmar('get', key, exp) });
    return `${env.apiPublicUrl}/api/dev-storage/objeto?${params.toString()}`;
  }

  async verificarObjeto(key: string): Promise<ObjetoAlmacenado> {
    try {
      const info = await stat(rutaAbsoluta(key));
      return { existe: true, tamanoBytes: info.size };
    } catch {
      return { existe: false };
    }
  }

  async eliminar(key: string): Promise<void> {
    try {
      await unlink(rutaAbsoluta(key));
    } catch (e) {
      // Igual que en R2: borrar algo que ya no está no es un error.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}

function expiraEn(segundos: number): number {
  return Math.floor(Date.now() / 1000) + segundos;
}

export function firmar(accion: 'upload' | 'get', key: string, exp: number): string {
  return createHmac('sha256', env.jwtSecret).update(`${accion}|${key}|${exp}`).digest('hex');
}

/** Verifica firma y vigencia. Comparación en tiempo constante, como en auth. */
export function firmaValida(
  accion: 'upload' | 'get',
  key: string,
  exp: number,
  firma: string,
): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const esperada = Buffer.from(firmar(accion, key, exp));
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

/**
 * Traduce la clave del objeto a una ruta dentro del directorio de storage.
 * La clave viene firmada por nosotros, pero igual se normaliza: un `..` que se
 * colara escribiría fuera de la carpeta.
 */
export function rutaAbsoluta(key: string): string {
  const limpia = normalize(key);
  if (limpia.startsWith('..') || limpia.startsWith('/') || limpia.includes('\0')) {
    throw new Error('storageKey inválida');
  }
  return join(env.storageLocalDir, limpia);
}

export async function asegurarDirectorio(rutaArchivo: string): Promise<void> {
  await mkdir(dirname(rutaArchivo), { recursive: true });
}
