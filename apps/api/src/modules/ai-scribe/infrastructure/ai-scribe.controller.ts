import {
  BadRequestException,
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { MIME_TYPES_AUDIO, type TranscribirConsultaResponse } from '@healthflow/shared-types';
import { UserThrottlerGuard } from '../../../common/security/user-throttler.guard';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import { TranscribirConsultaUseCase } from '../application/transcribir-consulta.use-case';
import { TranscribirIaDto } from './dto/transcribir-ia.dto';

/**
 * Tope del audio: 14 MB, y el número NO es arbitrario.
 *
 * Gemini limita la petición inline a 20 MB en total, y el audio viaja en
 * base64, que infla ~33%. Con un tope de 25 MB una consulta larga habría
 * generado una petición de ~33 MB y Google la habría rechazado justo al
 * final de la consulta, después de esperar la subida completa — el peor
 * momento posible para fallar. 14 MB de audio ⇒ ~19 MB en la petición.
 *
 * En opus a bitrate de voz eso son más de 60 minutos de consulta: de sobra.
 */
const MAX_AUDIO_BYTES = 14 * 1024 * 1024;

/**
 * Transcripción de la consulta con IA.
 *
 * Cuelga de `consultations` porque es parte del flujo de la consulta, no un
 * módulo aparte para quien usa la API.
 *
 * El audio llega como multipart y se queda en MEMORIA (`memoryStorage`): nunca
 * toca el disco del servidor ni un bucket. Es la razón por la que no se reusó
 * el patrón de subida prefirmada de radiografías — ese existe para guardar
 * archivos, y aquí lo que se quiere es exactamente lo contrario.
 *
 * Multipart no pasa por el límite de 256 kb del body JSON (ese parser solo
 * mira `application/json`), así que el tope del audio se declara aquí y es
 * independiente.
 */
@Controller('consultations')
@UseGuards(JwtAuthGuard, PoliciesGuard, UserThrottlerGuard)
export class AiScribeController {
  constructor(private readonly transcribir: TranscribirConsultaUseCase) {}

  @Post(':appointmentId/transcribir-ia')
  // Mismo permiso que escribir la nota: médico y admin, nunca el asistente.
  // Quien no puede redactar el expediente tampoco puede dictarlo.
  @RequirePolicy('write', 'Consultation')
  /**
   * Límite por MÉDICO (ver UserThrottlerGuard), no por IP: un consultorio de
   * cinco doctores detrás del mismo módem no debe compartir cupo. Cada llamada
   * manda minutos de audio a un modelo y cuesta dinero real, y ningún médico
   * transcribe legítimamente más de 3 consultas por minuto.
   */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
    }),
  )
  transcribirConsulta(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @UploadedFile() audio: Express.Multer.File | undefined,
    @Body() dto: TranscribirIaDto,
  ): Promise<TranscribirConsultaResponse> {
    if (!audio?.buffer?.byteLength) throw new BadRequestException('Falta el audio de la consulta');

    // El navegador manda el mime con parámetros ("audio/webm;codecs=opus").
    const contenedor = audio.mimetype.split(';')[0]!.trim().toLowerCase();
    if (!(MIME_TYPES_AUDIO as readonly string[]).includes(contenedor)) {
      throw new BadRequestException(`Formato de audio no soportado: ${contenedor}`);
    }

    return this.transcribir.execute(
      appointmentId,
      audio.buffer,
      contenedor,
      dto.camposYaLlenados ?? {},
    );
  }
}
