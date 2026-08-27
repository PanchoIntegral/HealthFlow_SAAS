import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { RequestUploadUrlRequest, RequestUploadUrlResponse } from '@healthflow/shared-types';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { ALMACENAMIENTO_PORT, type AlmacenamientoPort } from '../domain/almacenamiento.port';

const EXTENSION_POR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Genera la URL de subida directa a storage. El mimeType ya viene validado
 * por el DTO (`@IsIn(MIME_TYPES_RADIOGRAFIA)`); aquí solo se arma la clave del
 * objeto y se delega la firma al puerto.
 */
@Injectable()
export class RequestUploadUrlUseCase {
  constructor(
    private readonly ctx: RequestContextService,
    @Inject(ALMACENAMIENTO_PORT) private readonly storage: AlmacenamientoPort,
  ) {}

  async execute(input: RequestUploadUrlRequest): Promise<RequestUploadUrlResponse> {
    const { tenantId } = this.ctx.get();
    const ext = EXTENSION_POR_MIME[input.mimeType] ?? 'bin';
    const storageKey = `tenant/${tenantId}/patients/${input.patientId}/${randomUUID()}.${ext}`;

    const { url, headers } = await this.storage.presignedUploadUrl(storageKey, input.mimeType);
    return { uploadUrl: url, headers, storageKey };
  }
}
