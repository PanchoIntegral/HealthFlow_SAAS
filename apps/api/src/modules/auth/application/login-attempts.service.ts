import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB } from '../../../db/drizzle.module';
import type { Database } from '../../../db/drizzle';
import { decayMsFor, retryAfterSeconds, type LoginScope } from '../domain/login-policy';

interface AttemptRow {
  scope: LoginScope;
  attempts: number;
  last_attempt_at: string | Date;
}

/** Trunca la clave: el índice de Postgres no necesita más y acota el abuso. */
const MAX_KEY_LENGTH = 320;

/** Cada cuánto se barren las filas ya caducadas. */
const PURGE_INTERVAL_MS = 60 * 60_000;

/**
 * Memoria persistente de los intentos fallidos de login (tabla login_attempts,
 * ver 0011_login_security.sql). Sobrevive a los reinicios y la comparten todas
 * las instancias del proceso, a diferencia del throttler en memoria.
 */
@Injectable()
export class LoginAttemptsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LoginAttemptsService.name);
  private purgeTimer?: NodeJS.Timeout;

  constructor(@Inject(DB) private readonly db: Database) {}

  onModuleInit(): void {
    this.purgeTimer = setInterval(() => void this.purgeExpired(), PURGE_INTERVAL_MS);
    // No mantiene vivo el proceso solo por el temporizador.
    this.purgeTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
  }

  /**
   * Segundos que el cliente debe esperar antes de reintentar; 0 si puede
   * intentarlo ya. Se consulta el email y la IP en una sola query y manda el
   * bloqueo más largo de los dos.
   */
  async retryAfter(email: string, ip: string): Promise<number> {
    const rows = await this.select(email, ip);
    const now = new Date();
    let worst = 0;
    for (const row of rows) {
      const wait = retryAfterSeconds(row.scope, row.attempts, new Date(row.last_attempt_at), now);
      if (wait > worst) worst = wait;
    }
    return worst;
  }

  /** Suma un fallo a ambos ámbitos y devuelve la espera resultante. */
  async registerFailure(email: string, ip: string): Promise<number> {
    const [emailRow, ipRow] = await Promise.all([
      this.increment('email', email),
      this.increment('ip', ip),
    ]);
    const now = new Date();
    return Math.max(
      ...[emailRow, ipRow].map((row) =>
        row ? retryAfterSeconds(row.scope, row.attempts, new Date(row.last_attempt_at), now) : 0,
      ),
    );
  }

  /** Login correcto: se borra el historial de ambos ámbitos. */
  async clear(email: string, ip: string): Promise<void> {
    await this.db.execute(sql`
      DELETE FROM login_attempts
       WHERE (scope = 'email' AND key = ${this.normalizeEmail(email)})
          OR (scope = 'ip' AND key = ${this.normalizeKey(ip)})
    `);
  }

  /**
   * Incremento atómico. El propio UPSERT decide si el contador continúa o
   * arranca de cero según el decaimiento del ámbito, de modo que leer y
   * escribir no son dos pasos separados con una carrera en medio.
   */
  private async increment(scope: LoginScope, rawKey: string): Promise<AttemptRow | undefined> {
    const key = scope === 'email' ? this.normalizeEmail(rawKey) : this.normalizeKey(rawKey);
    const decay = sql.raw(`interval '${decayMsFor(scope)} milliseconds'`);
    const result = await this.db.execute(sql`
      INSERT INTO login_attempts (scope, key, attempts, first_attempt_at, last_attempt_at)
           VALUES (${scope}, ${key}, 1, now(), now())
      ON CONFLICT (scope, key) DO UPDATE
              SET attempts = CASE
                    WHEN login_attempts.last_attempt_at < now() - ${decay} THEN 1
                    ELSE login_attempts.attempts + 1
                  END,
                  first_attempt_at = CASE
                    WHEN login_attempts.last_attempt_at < now() - ${decay} THEN now()
                    ELSE login_attempts.first_attempt_at
                  END,
                  last_attempt_at = now()
        RETURNING scope, attempts, last_attempt_at
    `);
    return (result.rows as unknown as AttemptRow[])[0];
  }

  private async select(email: string, ip: string): Promise<AttemptRow[]> {
    const result = await this.db.execute(sql`
      SELECT scope, attempts, last_attempt_at
        FROM login_attempts
       WHERE (scope = 'email' AND key = ${this.normalizeEmail(email)})
          OR (scope = 'ip' AND key = ${this.normalizeKey(ip)})
    `);
    return result.rows as unknown as AttemptRow[];
  }

  /**
   * Borra el rastro que ya no puede bloquear a nadie. Sin esto, un ataque que
   * rocíe millones de emails distintos hace crecer la tabla sin techo.
   */
  private async purgeExpired(): Promise<void> {
    try {
      const maxDecay = Math.max(decayMsFor('email'), decayMsFor('ip'));
      const cutoff = sql.raw(`interval '${maxDecay} milliseconds'`);
      await this.db.execute(
        sql`DELETE FROM login_attempts WHERE last_attempt_at < now() - ${cutoff}`,
      );
    } catch (err) {
      // La limpieza es best-effort: que falle no debe tumbar el proceso.
      this.logger.warn(`No se pudo purgar login_attempts: ${String(err)}`);
    }
  }

  private normalizeEmail(email: string): string {
    return this.normalizeKey(email.trim().toLowerCase());
  }

  private normalizeKey(key: string): string {
    return key.slice(0, MAX_KEY_LENGTH);
  }
}
