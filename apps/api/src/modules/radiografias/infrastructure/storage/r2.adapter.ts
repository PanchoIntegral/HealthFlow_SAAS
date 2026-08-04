import { Injectable } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../../../config/env';
import type { AlmacenamientoPort, PoliticaSubida } from '../../domain/almacenamiento.port';

/** Tope duro de tamaño, aplicado por R2 mismo vía la condición de la política. */
const MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_URL_TTL_SEGUNDOS = 5 * 60;
const GET_URL_TTL_SEGUNDOS = 10 * 60;

/**
 * Adaptador real sobre R2 (S3-compatible). Credenciales SOLO por variables de
 * entorno (getters lazy en env.ts: el arranque con FakeAlmacenamientoAdapter
 * no las exige). El bucket es privado: toda lectura/escritura pasa por una
 * URL prefirmada de vida corta, nunca por acceso público directo.
 */
@Injectable()
export class R2Adapter implements AlmacenamientoPort {
  private client?: S3Client;

  private getClient(): S3Client {
    if (!this.client) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: env.r2Endpoint,
        credentials: {
          accessKeyId: env.r2AccessKeyId,
          secretAccessKey: env.r2SecretAccessKey,
        },
      });
    }
    return this.client;
  }

  async presignedUploadPolicy(key: string, mimeType: string): Promise<PoliticaSubida> {
    const { url, fields } = await createPresignedPost(this.getClient(), {
      Bucket: env.r2BucketName,
      Key: key,
      Conditions: [
        ['content-length-range', 1, MAX_BYTES],
        ['eq', '$Content-Type', mimeType],
      ],
      Fields: { 'Content-Type': mimeType },
      Expires: UPLOAD_URL_TTL_SEGUNDOS,
    });
    return { url, fields };
  }

  async presignedGetUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: env.r2BucketName, Key: key });
    return getSignedUrl(this.getClient(), command, { expiresIn: GET_URL_TTL_SEGUNDOS });
  }

  async eliminar(key: string): Promise<void> {
    await this.getClient().send(
      new DeleteObjectCommand({ Bucket: env.r2BucketName, Key: key }),
    );
  }
}
