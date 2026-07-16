import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PacTimbradoError, PacCancelacionError } from '../../domain/factura.errors';
import type {
  FacturacionPacPort,
  PacEstatus,
  TimbradoRequest,
  TimbradoResult,
} from '../../domain/facturacion-pac.port';

/**
 * PAC falso para desarrollo local y pruebas: timbra sin red ni costo. Se
 * selecciona vía useClass en billing.module.ts (NODE_ENV=test o
 * PAC_PROVIDER=fake) — nunca con un `if` dentro del adaptador real, que es
 * fácil de dejar prendido por error en producción.
 */
@Injectable()
export class FakePacAdapter implements FacturacionPacPort {
  /** Si se enciende, la siguiente llamada a timbrar/cancelar falla (para tests). */
  failNextTimbrado = false;
  failNextCancelacion = false;

  private readonly cancelados = new Set<string>();

  async timbrar(req: TimbradoRequest): Promise<TimbradoResult> {
    if (this.failNextTimbrado) {
      this.failNextTimbrado = false;
      throw new PacTimbradoError();
    }
    return {
      uuidFiscal: randomUUID().toUpperCase(),
      pacRawId: `fake_${req.facturaId}`,
    };
  }

  async cancelar(pacRawId: string): Promise<void> {
    if (this.failNextCancelacion) {
      this.failNextCancelacion = false;
      throw new PacCancelacionError();
    }
    this.cancelados.add(pacRawId);
  }

  async consultarEstatus(pacRawId: string): Promise<PacEstatus> {
    return this.cancelados.has(pacRawId) ? 'cancelada' : 'vigente';
  }
}
