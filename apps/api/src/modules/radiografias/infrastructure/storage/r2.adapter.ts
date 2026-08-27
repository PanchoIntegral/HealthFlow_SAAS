import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetBucketCorsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../../../config/env';
import type {
  AlmacenamientoPort,
  DiagnosticoStorage,
  ObjetoAlmacenado,
  SubidaDirecta,
} from '../../domain/almacenamiento.port';

const UPLOAD_URL_TTL_SEGUNDOS = 5 * 60;
const GET_URL_TTL_SEGUNDOS = 10 * 60;

/**
 * Adaptador real sobre R2 (S3-compatible). Credenciales SOLO por variables de
 * entorno (getters lazy en env.ts: el arranque con otro adaptador no las
 * exige). El bucket es privado: toda lectura/escritura pasa por una URL
 * prefirmada de vida corta, nunca por acceso público directo.
 *
 * La subida es un PUT prefirmado. NO presigned POST: R2 no implementa
 * PostObject, así que un formulario multipart firmado —lo que este adaptador
 * hacía antes— fallaba contra R2 pase lo que pase en el bucket.
 */
@Injectable()
export class R2Adapter implements AlmacenamientoPort {
  private readonly logger = new Logger(R2Adapter.name);
  private client?: S3Client;

  private getClient(): S3Client {
    if (!this.client) {
      try {
        this.client = new S3Client({
          region: 'auto',
          endpoint: env.r2Endpoint,
          credentials: {
            accessKeyId: env.r2AccessKeyId,
            secretAccessKey: env.r2SecretAccessKey,
          },
        });
      } catch (e) {
        /**
         * Falta alguna R2_*. Se traduce a un 503 con mensaje propio en vez de
         * dejar salir el 500 genérico de "Falta la variable de entorno X":
         * quien lo lee es el usuario en la clínica, y el detalle real queda
         * en el log del servidor.
         */
        this.logger.error(`Almacenamiento mal configurado: ${e instanceof Error ? e.message : e}`);
        throw new ServiceUnavailableException(
          'El almacenamiento de imágenes no está configurado. Avisa a soporte.',
        );
      }
    }
    return this.client;
  }

  async presignedUploadUrl(key: string, mimeType: string): Promise<SubidaDirecta> {
    const command = new PutObjectCommand({
      Bucket: env.r2BucketName,
      Key: key,
      ContentType: mimeType,
    });
    const url = await getSignedUrl(this.getClient(), command, {
      expiresIn: UPLOAD_URL_TTL_SEGUNDOS,
    });
    // Content-Type va firmado: si el cliente manda otro, R2 rechaza el PUT.
    // El tope de tamaño ya no puede viajar en la firma (era una condición del
    // presigned POST): lo impone el paso de confirmación, que mide el objeto
    // real con verificarObjeto().
    return { url, headers: { 'Content-Type': mimeType } };
  }

  async presignedGetUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: env.r2BucketName, Key: key });
    return getSignedUrl(this.getClient(), command, { expiresIn: GET_URL_TTL_SEGUNDOS });
  }

  async verificarObjeto(key: string): Promise<ObjetoAlmacenado> {
    try {
      const head = await this.getClient().send(
        new HeadObjectCommand({ Bucket: env.r2BucketName, Key: key }),
      );
      return { existe: true, tamanoBytes: head.ContentLength, mimeType: head.ContentType };
    } catch {
      // 404 (nunca se subió) o 403: en ambos casos no hay objeto utilizable.
      return { existe: false };
    }
  }

  async eliminar(key: string): Promise<void> {
    await this.getClient().send(
      new DeleteObjectCommand({ Bucket: env.r2BucketName, Key: key }),
    );
  }

  /**
   * Estado de R2 visto desde el API. Existe porque los fallos de la subida
   * directa son INVISIBLES desde el servidor: el API firma bien, R2 está
   * sano, y aun así el navegador puede no lograr subir (por CORS, o —como
   * ocurrió— porque el método firmado no existe en R2). Sin esto, la única
   * pista es la consola del navegador del usuario que reportó el problema.
   *
   * No devuelve ningún secreto: solo si cada variable está presente.
   */
  async diagnostico(): Promise<DiagnosticoStorage> {
    const detalles: Record<string, unknown> = {
      variablesPresentes: {
        R2_ENDPOINT: Boolean(process.env.R2_ENDPOINT),
        R2_ACCESS_KEY_ID: Boolean(process.env.R2_ACCESS_KEY_ID),
        R2_SECRET_ACCESS_KEY: Boolean(process.env.R2_SECRET_ACCESS_KEY),
        R2_BUCKET_NAME: Boolean(process.env.R2_BUCKET_NAME),
      },
    };

    try {
      await this.getClient().send(new HeadBucketCommand({ Bucket: env.r2BucketName }));
      detalles.bucket = 'accesible';
    } catch (e) {
      detalles.bucket = `inaccesible: ${mensaje(e)}`;
      return { ok: false, detalles };
    }

    // Necesario para que el navegador pueda hacer el PUT directo.
    try {
      const cors = await this.getClient().send(
        new GetBucketCorsCommand({ Bucket: env.r2BucketName }),
      );
      const reglas = cors.CORSRules ?? [];
      detalles.cors = reglas.length
        ? reglas.map((r) => ({
            origenes: r.AllowedOrigins,
            metodos: r.AllowedMethods,
            cabeceras: r.AllowedHeaders,
          }))
        : 'SIN REGLAS: el navegador no podrá subir (el API sí puede).';
      // El PUT del navegador exige que PUT esté entre los métodos permitidos.
      const permitePut = reglas.some((r) => (r.AllowedMethods ?? []).includes('PUT'));
      if (!permitePut) {
        detalles.avisoCors = 'Ninguna regla permite PUT: la subida desde el navegador fallará.';
      }
      return { ok: reglas.length > 0 && permitePut, detalles };
    } catch (e) {
      // R2 responde NoSuchCORSConfiguration cuando el bucket no tiene reglas.
      detalles.cors = `no configurado o no consultable: ${mensaje(e)}`;
      return { ok: false, detalles };
    }
  }
}

function mensaje(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}
