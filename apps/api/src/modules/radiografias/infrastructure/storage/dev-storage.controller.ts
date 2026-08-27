import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { asegurarDirectorio, firmaValida, rutaAbsoluta } from './local-disk.adapter';

/** Lo mínimo que usamos del Response de Express (el paquete no expone tipos propios aquí). */
interface RespuestaHttp extends NodeJS.WritableStream {
  setHeader(nombre: string, valor: string): void;
}

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
 * Sin JwtAuthGuard a propósito: replica el contrato de una URL prefirmada
 * —el navegador sube y lee SIN cabecera Authorization—, así que la
 * autorización viaja en la firma HMAC de la propia URL/política, que solo
 * emite el API tras pasar por CASL.
 */
@Controller('dev-storage')
export class DevStorageController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async subir(
    @Body() body: Record<string, string>,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ key: string }> {
    const { key, exp, firma } = body ?? {};
    if (!key || !exp || !firma || !firmaValida('upload', key, Number(exp), firma)) {
      throw new BadRequestException('Política de subida inválida o vencida');
    }
    if (!file) throw new BadRequestException('Falta el archivo');
    if (!Object.values(MIME_POR_EXTENSION).includes(file.mimetype)) {
      throw new BadRequestException('Tipo de archivo no permitido');
    }
    // La política de R2 fija el Content-Type con una condición `eq`; aquí se
    // comprueba igual, para que dev y producción rechacen lo mismo.
    if (body['Content-Type'] && body['Content-Type'] !== file.mimetype) {
      throw new BadRequestException('El Content-Type no coincide con la política');
    }

    const destino = rutaAbsoluta(key);
    await asegurarDirectorio(destino);
    await writeFile(destino, file.buffer);
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
    res.setHeader('Content-Type', MIME_POR_EXTENSION[key.split('.').pop() ?? ''] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    createReadStream(ruta).pipe(res);
  }
}
