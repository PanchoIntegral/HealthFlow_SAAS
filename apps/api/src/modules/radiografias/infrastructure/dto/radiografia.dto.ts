import { IsIn, IsString, IsUUID, MaxLength } from 'class-validator';
import { MIME_TYPES_RADIOGRAFIA, type MimeTypeRadiografia } from '@healthflow/shared-types';

export class RequestUploadUrlDto {
  @IsUUID()
  patientId!: string;

  @IsIn(MIME_TYPES_RADIOGRAFIA)
  mimeType!: MimeTypeRadiografia;
}

export class ConfirmRadiografiaDto {
  @IsUUID()
  patientId!: string;

  @IsString()
  @MaxLength(500)
  storageKey!: string;

  @IsIn(MIME_TYPES_RADIOGRAFIA)
  mimeType!: MimeTypeRadiografia;
}
