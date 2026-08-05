import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Carga variables de entorno desde el primer .env encontrado subiendo el árbol
 * de directorios (desde cwd y desde este archivo). Parser propio (sin dotenv)
 * que escribe en process.env — funciona también dentro del sandbox de Jest,
 * a diferencia de process.loadEnvFile. Idempotente. No pisa vars ya presentes.
 */
let loaded = false;
export function loadDotEnv(): void {
  if (loaded) return;
  loaded = true;
  const found = findUp('.env', process.cwd()) ?? findUp('.env', __dirname);
  if (!found) return;
  for (const raw of readFileSync(found, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function findUp(filename: string, from: string): string | undefined {
  let dir = from;
  for (;;) {
    const candidate = resolve(dir, filename);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined; // llegó a la raíz del FS
    dir = parent;
  }
}

// Carga el .env al importar este módulo, ANTES de que cualquier consumidor lea
// `env.*` (p.ej. decoradores evaluados en tiempo de import como JwtModule).
loadDotEnv();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export const env = {
  get databaseUrl(): string {
    return required('DATABASE_URL');
  },
  get adminDatabaseUrl(): string {
    return required('DB_ADMIN_URL');
  },
  get jwtSecret(): string {
    return required('JWT_SECRET');
  },
  get jwtExpiresIn(): string {
    return process.env.JWT_EXPIRES_IN ?? '1d';
  },
  get apiPort(): number {
    // Railway/Render inyectan su propio PORT y esperan que el proceso lo use.
    return Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
  },
  /** Orígenes permitidos para CORS. Acepta lista separada por comas
   *  (p.ej. "http://localhost:3000,http://192.168.1.173:3000" para probar
   *  desde otro dispositivo de la red local). */
  get webOrigins(): string[] {
    return (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  },

  // ── Endurecimiento HTTP / anti-abuso ─────────────────────────────
  /**
   * Saltos de proxy de confianza para resolver la IP real del cliente
   * (X-Forwarded-For). El valor DEBE coincidir con la infraestructura:
   *   0 → el proceso está expuesto directo (dev local)
   *   1 → un solo proxy delante (Railway, Render, Fly)
   *   2 → CDN + PaaS (p.ej. Cloudflare → Railway)
   * Pasarse de largo permitiría a un atacante falsificar su IP inyectando
   * X-Forwarded-For y esquivar todos los límites por IP; quedarse corto hace
   * que todos los usuarios compartan la IP del proxy y se bloqueen entre sí.
   */
  get trustProxyHops(): number {
    const raw = process.env.TRUST_PROXY_HOPS;
    if (raw !== undefined && raw.trim() !== '') {
      const parsed = Number(raw);
      if (Number.isInteger(parsed) && parsed >= 0) return parsed;
      throw new Error('TRUST_PROXY_HOPS debe ser un entero >= 0');
    }
    // En producción siempre hay al menos un balanceador delante del proceso.
    return this.isProduction ? 1 : 0;
  },
  /** Tamaño máximo del body JSON. Un límite bajo corta el DoS por payload gigante. */
  get maxBodySize(): string {
    return process.env.MAX_BODY_SIZE ?? '256kb';
  },

  get appDbUser(): string {
    return process.env.APP_DB_USER ?? 'healthflow_app';
  },
  get appDbPassword(): string {
    return process.env.APP_DB_PASSWORD ?? 'healthflow_app_pwd';
  },
  /**
   * Secret key del PAC (Facturapi). Getter LAZY a propósito: solo se exige si
   * el adaptador real llega a usarse (con PAC_PROVIDER=fake el arranque no la
   * necesita). Usar keys SEPARADAS para sandbox y producción.
   */
  get facturapiSecretKey(): string {
    return required('FACTURAPI_SECRET_KEY');
  },

  // ── Suscripciones (Stripe) ───────────────────────────────────────
  get stripeSecretKey(): string {
    return required('STRIPE_SECRET_KEY');
  },
  get stripeWebhookSecret(): string {
    return required('STRIPE_WEBHOOK_SECRET');
  },
  get stripePriceIdIndividual(): string {
    return required('STRIPE_PRICE_ID_INDIVIDUAL');
  },
  get stripePriceIdConsultorio(): string {
    return required('STRIPE_PRICE_ID_CONSULTORIO');
  },
  get stripePriceIdIndividualAnual(): string {
    return required('STRIPE_PRICE_ID_INDIVIDUAL_ANUAL');
  },
  get stripePriceIdConsultorioAnual(): string {
    return required('STRIPE_PRICE_ID_CONSULTORIO_ANUAL');
  },
  /** Origen del SaaS (apps/web) — arma el success_url del Checkout. */
  get appUrl(): string {
    return process.env.APP_URL ?? 'http://localhost:3000';
  },
  /** Origen de la landing — arma el cancel_url del Checkout. */
  get marketingUrl(): string {
    return process.env.MARKETING_URL ?? 'http://localhost:3100';
  },

  // ── Almacenamiento de archivos (R2/S3-compatible) ─────────────────
  /**
   * Getters LAZY a propósito, mismo criterio que `facturapiSecretKey`: solo
   * se exigen si el adaptador real llega a instanciarse. Con
   * STORAGE_PROVIDER=fake el arranque no las necesita.
   */
  get r2Endpoint(): string {
    return required('R2_ENDPOINT');
  },
  get r2AccessKeyId(): string {
    return required('R2_ACCESS_KEY_ID');
  },
  get r2SecretAccessKey(): string {
    return required('R2_SECRET_ACCESS_KEY');
  },
  get r2BucketName(): string {
    return required('R2_BUCKET_NAME');
  },

  // ── Correo transaccional (Resend) ──────────────────────────────────
  /** Lazy: solo se exige si el adaptador real llega a instanciarse (EMAIL_PROVIDER=fake no la necesita). */
  get resendApiKey(): string {
    return required('RESEND_API_KEY');
  },
  /** Remitente. Por defecto el de pruebas de Resend, que funciona sin dominio verificado. */
  get emailFrom(): string {
    return process.env.EMAIL_FROM ?? 'HealthFlow <onboarding@resend.dev>';
  },
};
