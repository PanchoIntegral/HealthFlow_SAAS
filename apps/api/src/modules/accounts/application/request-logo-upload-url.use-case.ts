import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  RequestLogoUploadUrlRequest,
  RequestLogoUploadUrlResponse,
} from '@healthflow/shared-types';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { ALMACENAMIENTO_PORT, type AlmacenamientoPort } from '../../radiografias/domain/almacenamiento.port';

const EXTENSION_POR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/**
 * Genera la política de subida directa a storage para el logo de la clínica.
 * Mismo patrón que RequestUploadUrlUseCase de radiografías, con un prefijo de
 * clave distinto: `logo/`, no `patients/{id}/`, porque es del TENANT y no de
 * un paciente en particular.
 */
@Injectable()
export class RequestLogoUploadUrlUseCase {
  constructor(
    private readonly ctx: RequestContextService,
    @Inject(ALMACENAMIENTO_PORT) private readonly storage: AlmacenamientoPort,
  ) {}

  async execute(input: RequestLogoUploadUrlRequest): Promise<RequestLogoUploadUrlResponse> {
    const { tenantId } = this.ctx.get();
    const ext = EXTENSION_POR_MIME[input.mimeType] ?? 'bin';
    const storageKey = `tenant/${tenantId}/logo/${randomUUID()}.${ext}`;

    const { url, headers } = await this.storage.presignedUploadUrl(storageKey, input.mimeType);
    return { uploadUrl: url, headers, storageKey };
  }
}
