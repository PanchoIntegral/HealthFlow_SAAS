import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import bcrypt from 'bcryptjs';

/**
 * Hash bcrypt de descarte, con el mismo coste que los reales. Se compara
 * contra él cuando el email no existe, para que el tiempo de respuesta de
 * "usuario inexistente" y "contraseña incorrecta" sea indistinguible. Sin
 * esto, un atacante mide los milisegundos y saca la lista de emails dados de
 * alta — el primer paso de cualquier credential stuffing dirigido.
 */
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

/**
 * Cuántas comparaciones bcrypt pueden estar en vuelo a la vez.
 *
 * bcryptjs es JavaScript puro: cada comparación quema CPU del hilo principal
 * durante ~100 ms. Una ráfaga de peticiones de login sin control es un ataque
 * de agotamiento de CPU muy barato — bastan unas decenas de peticiones por
 * segundo para que la API deje de responder a TODO lo demás. El semáforo
 * convierte ese escenario en una cola corta: se sirve a un ritmo sostenible y
 * el exceso se rechaza rápido, en vez de arrastrar al proceso entero.
 */
const MAX_CONCURRENT_HASHES = 4;

/** Peticiones que pueden esperar turno antes de empezar a rechazar. */
const MAX_QUEUED_HASHES = 50;

@Injectable()
export class PasswordHasherService {
  private inFlight = 0;
  private readonly waiting: Array<() => void> = [];

  /** Compara contraseña y hash respetando el límite de concurrencia. */
  async compare(password: string, hash: string): Promise<boolean> {
    return this.withSlot(() => bcrypt.compare(password, hash));
  }

  /**
   * Genera el hash de una contraseña nueva (cambiar/restablecer contraseña),
   * respetando el mismo límite de concurrencia que `compare`. Mismo costo
   * (10) que ya usan create-account.ts y create-checkout-session.use-case.ts.
   */
  async hash(password: string): Promise<string> {
    return this.withSlot(() => bcrypt.hash(password, 10));
  }

  /**
   * Consume el mismo tiempo de CPU que una comparación real, y devuelve
   * siempre false. Para el camino "el usuario no existe".
   */
  async compareAgainstDummy(password: string): Promise<false> {
    await this.withSlot(() => bcrypt.compare(password, DUMMY_HASH));
    return false;
  }

  private async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.inFlight < MAX_CONCURRENT_HASHES) {
      this.inFlight++;
      return Promise.resolve();
    }
    if (this.waiting.length >= MAX_QUEUED_HASHES) {
      // Fallar rápido y barato es preferible a aceptar trabajo que solo
      // serviría para alargar la cola de todos los demás.
      return Promise.reject(
        new ServiceUnavailableException('Servicio de autenticación saturado, reintenta.'),
      );
    }
    return new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  /**
   * Al liberar, el turno se TRASPASA al siguiente en la cola sin pasar por
   * cero: si `inFlight` bajara y volviera a subir, una petición nueva podría
   * colarse en ese hueco y dejar más hashes en vuelo que el máximo.
   */
  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.inFlight--;
  }
}
