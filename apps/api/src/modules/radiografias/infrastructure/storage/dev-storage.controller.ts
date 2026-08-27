import { createReadStream, createWriteStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  PayloadTooLargeException,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { asegurarDirectorio, firmaValida, rutaAbsoluta } from './local-disk.adapter';

/** Lo mínimo que usamos de Express (el paquete no expone tipos propios aquí). */
interface RespuestaHttp extends NodeJS.WritableStream {
  setHeader(nombre: string, valor: string): void;
}
type PeticionHttp = NodeJS.ReadableStream & { headers: Record<string, string | undefined> };

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Tipos que este storage acepta y sirve. Cubre a los dos usuarios del puerto:
 * radiografías (jpeg/png/webp) y el logo de la clínica (jpeg/png). La lista
 * real la imponen los DTO de cada módulo; aquí es solo la última red.
 */
const MIME_POR_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * "Storage" de desarrollo: hace de R2 para LocalDiskAlmacenamientoAdapter.
 * Solo se registra con STORAGE_PROVIDER=local (ver radiografias.module.ts).
 *
 * Habla el mismo protocolo que R2 —PUT con el archivo como body crudo— para
 * que subir en dev ejercite el MISMO camino que en producción.
 *
 * Sin JwtAuthGuard a propósito: replica el contrato de una URL prefirmada
 * —el navegador sube y lee SIN cabecera Authorization—, así que la
 * autorización viaja en la firma HMAC de la propia URL, que solo emite el API
 * tras pasar por CASL.
 */
@Controller('dev-storage')
export class DevStorageController {
  @Put('objeto')
  async subir(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('firma') firma: string,
    @Req() req: PeticionHttp,
  ): Promise<{ key: string }> {
    if (!key || !firmaValida('upload', key, Number(exp), firma)) {
      throw new BadRequestException('URL de subida inválida o vencida');
    }
    const mimeEsperado = MIME_POR_EXTENSION[key.split('.').pop() ?? ''];
    if (!mimeEsperado) throw new BadRequestException('Tipo de archivo no permitido');
    // R2 firma el Content-Type y rechaza el PUT si no coincide; aquí igual,
    // para que dev y producción fallen por lo mismo.
    if (req.headers['content-type'] !== mimeEsperado) {
      throw new BadRequestException('El Content-Type no coincide con el de la URL firmada');
    }

    const destino = rutaAbsoluta(key);
    await asegurarDirectorio(destino);

    let bytes = 0;
    try {
      // El body llega crudo: no hay body parser registrado para imágenes, así
      // que se cuenta y se escribe en streaming, sin cargarlo entero a memoria.
      await pipeline(async function* () {
        for await (const trozo of req) {
          bytes += (trozo as Buffer).length;
          if (bytes > MAX_BYTES) throw new PayloadTooLargeException('La imagen supera 10MB');
          yield trozo;
        }
      }, createWriteStream(destino));
    } catch (e) {
      await unlink(destino).catch(() => {});
      throw e;
    }

    return { key };
  }

  @Get('objeto')
  async servir(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('firma') firma: string,
    @Res() res: RespuestaHttp,
  ): Promise<void> {
    if (!key || !firmaValida('get', key, Number(exp), firma)) {
      throw new BadRequestException('URL de lectura inválida o vencida');
    }

    const ruta = rutaAbsoluta(key);
    try {
      await stat(ruta);
    } catch {
      throw new NotFoundException('Objeto no encontrado');
    }

    // Cache-Control privado: la URL es de vida corta y el contenido es un
    // dato clínico; no debe quedarse en caches intermedios.
    res.setHeader(
      'Content-Type',
      MIME_POR_EXTENSION[key.split('.').pop() ?? ''] ?? 'application/octet-stream',
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    createReadStream(ruta).pipe(res);
  }
}
