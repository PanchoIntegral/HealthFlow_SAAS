import { IsIn, IsString, MaxLength } from 'class-validator';
import { MIME_TYPES_LOGO_CLINICA, type MimeTypeLogoClinica } from '@healthflow/shared-types';

export class RequestLogoUploadUrlDto {
  @IsIn(MIME_TYPES_LOGO_CLINICA)
  mimeType!: MimeTypeLogoClinica;
}

export class ConfirmLogoDto {
  @IsString()
  @MaxLength(500)
  storageKey!: string;

  @IsIn(MIME_TYPES_LOGO_CLINICA)
  mimeType!: MimeTypeLogoClinica;
}
