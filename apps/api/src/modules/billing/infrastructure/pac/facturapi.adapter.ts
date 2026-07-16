import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../../../config/env';
import { PacCancelacionError, PacTimbradoError } from '../../domain/factura.errors';
import type {
  FacturacionPacPort,
  PacEstatus,
  TimbradoRequest,
  TimbradoResult,
} from '../../domain/facturacion-pac.port';

const BASE_URL = 'https://www.facturapi.io/v2';
const TIMEOUT_MS = 10_000;
/** Backoff exponencial: reintento solo ante red/5xx, NUNCA ante 4xx. */
const RETRY_DELAYS_MS = [500, 1500];

/**
 * Adaptador de Facturapi. La forma exacta del payload debe verificarse contra
 * la documentación vigente (https://docs.facturapi.io) antes de producción —
 * endpoints y campos cambian con el tiempo; todo ese acoplamiento vive SOLO aquí.
 *
 * Seguridad:
 * - FACTURAPI_SECRET_KEY solo por variable de entorno (getter lazy: el arranque
 *   con FakePacAdapter no la exige). Keys SEPARADAS sandbox/producción.
 * - Sin PII en logs: se loguea facturaId + status HTTP, nunca el payload
 *   (contiene RFC y nombre del paciente).
 */
@Injectable()
export class FacturapiAdapter implements FacturacionPacPort {
  private readonly logger = new Logger(FacturapiAdapter.name);

  private get apiKey(): string {
    return env.facturapiSecretKey;
  }

  async timbrar(req: TimbradoRequest): Promise<TimbradoResult> {
    const payload = {
      customer: {
        legal_name: req.receptor.razonSocial,
        tax_id: req.receptor.rfc,
        tax_system: req.receptor.regimenFiscal,
        address: { zip: req.receptor.codigoPostal },
      },
      items: req.conceptos.map((c) => ({
        quantity: c.cantidad,
        product: {
          description: c.descripcion,
          product_key: c.claveProdServ,
          unit_key: c.claveUnidad,
          price: c.valorUnitarioCentavos / 100,
          tax_included: false,
          taxes:
            c.tratamientoIva === 'TASA_16'
              ? [{ type: 'IVA', rate: 0.16 }]
              : c.tratamientoIva === 'TASA_0'
                ? [{ type: 'IVA', rate: 0 }]
                : [], // EXENTO: sin impuestos trasladados
        },
      })),
      use: req.receptor.usoCfdi,
      payment_form: '01', // efectivo (MVP); parametrizar cuando haya formas de pago
    };

    const body = await this.request('POST', '/invoices', payload, req.facturaId).catch(() => {
      throw new PacTimbradoError();
    });

    const uuid = (body as { uuid?: string }).uuid;
    const id = (body as { id?: string }).id;
    if (!uuid || !id) {
      this.logger.error(`Respuesta del PAC sin uuid/id para factura ${req.facturaId}`);
      throw new PacTimbradoError();
    }
    return { uuidFiscal: uuid, pacRawId: id };
  }

  async cancelar(pacRawId: string, motivo: string): Promise<void> {
    await this.request('DELETE', `/invoices/${pacRawId}?motive=${motivo}`, undefined, pacRawId).catch(
      () => {
        throw new PacCancelacionError();
      },
    );
  }

  async consultarEstatus(pacRawId: string): Promise<PacEstatus> {
    const body = await this.request('GET', `/invoices/${pacRawId}`, undefined, pacRawId).catch(() => {
      throw new PacTimbradoError();
    });
    const status = (body as { status?: string }).status;
    if (status === 'valid') return 'vigente';
    if (status === 'canceled') return 'cancelada';
    return 'desconocido';
  }

  /**
   * fetch con timeout explícito y retry con backoff SOLO para errores de
   * red/5xx. Un 4xx es un dato inválido: se corrige, no se reintenta (cada
   * timbrado tiene costo).
   */
  private async request(
    method: string,
    path: string,
    payload: unknown,
    correlacionId: string,
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`${BASE_URL}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: payload === undefined ? undefined : JSON.stringify(payload),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (res.ok) return res.json();

        this.logger.error(`PAC respondió ${res.status} (${method} ${path.split('?')[0]}, ref ${correlacionId})`);
        if (res.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]!);
          continue;
        }
        throw new Error(`PAC HTTP ${res.status}`);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('PAC HTTP')) throw err;
        // Error de red o timeout: reintentable.
        this.logger.error(`Error de red hacia el PAC (ref ${correlacionId}, intento ${attempt + 1})`);
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]!);
          continue;
        }
        throw err;
      }
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
