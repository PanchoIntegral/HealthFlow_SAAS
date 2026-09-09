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
  /**
   * Llave de la API de Gemini (asistente de transcripción). Getter lazy: solo
   * se exige cuando corre el adaptador real, así que arrancar con
   * GEMINI_PROVIDER=fake no la necesita.
   */
  get geminiApiKey(): string {
    return required('GEMINI_API_KEY');
  },
  /**
   * Modelo de Gemini para transcribir la consulta. Configurable porque el
   * catálogo de Google cambia varias veces al año: actualizar es cambiar una
   * variable, no desplegar código. Verificable con:
   *   curl -H "x-goog-api-key: $GEMINI_API_KEY" \
   *     https://generativelanguage.googleapis.com/v1beta/models
   */
  get geminiModel(): string {
    // Versión FIJA y no un alias tipo `gemini-flash-latest`: en un producto
    // clínico no conviene que el modelo cambie solo de una noche a otra sin
    // que nadie haya vuelto a probar la calidad de las notas.
    return process.env.GEMINI_MODEL ?? 'gemini-3.6-flash';
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
  get workerDatabaseUrl(): string {
    const explicit=process.env.WORKER_DATABASE_URL;
    if(explicit)return explicit;
    if(this.isProduction)throw new Error('Falta la variable de entorno WORKER_DATABASE_URL');
    const url=new URL(this.databaseUrl);url.username=this.workerDbUser;url.password=this.workerDbPassword;
    return url.toString();
  },
  get workerDbUser(): string { return process.env.WORKER_DB_USER ?? 'healthflow_worker'; },
  get workerDbPassword(): string { return process.env.WORKER_DB_PASSWORD ?? 'healthflow_worker_pwd'; },
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

  /**
   * Proveedor de almacenamiento: 'local' (disco, dev), 'fake' (en memoria,
   * pruebas) o real (R2). Sin valor explícito: R2 en producción, disco fuera.
   */
  get storageProvider(): 'local' | 'fake' | 'r2' {
    const raw = process.env.STORAGE_PROVIDER?.trim().toLowerCase();
    if (raw === 'local' || raw === 'fake') {
      /**
       * Ni 'fake' (memoria) ni 'local' (disco del proceso) sirven en
       * producción: el primero acepta la subida y la tira, el segundo la
       * pierde en el siguiente despliegue — pérdida de dato clínico
       * silenciosa. Se IGNORA la variable y se deja constancia ruidosa.
       *
       * Ignorar y avisar, en vez de reventar el arranque: una variable mal
       * puesta no debe tumbar la agenda, la consulta y el cobro de toda la
       * clínica. Si además faltan las credenciales de R2, quien lo dice es el
       * endpoint de subida con un 503 explícito (ver R2Adapter).
       */
      if (this.isProduction) {
        console.error(
          `[storage] STORAGE_PROVIDER='${raw}' IGNORADO en producción: los archivos no se guardarían. ` +
            'Usando R2 — configura R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_BUCKET_NAME.',
        );
        return 'r2';
      }
      return raw;
    }
    if (raw) return 'r2';
    return this.isProduction ? 'r2' : 'local';
  },
  /** Carpeta donde el adaptador de disco guarda los archivos (dev). */
  get storageLocalDir(): string {
    return process.env.STORAGE_LOCAL_DIR ?? resolve(process.cwd(), '.storage');
  },
  /**
   * URL pública del propio API. El adaptador de disco la usa para armar las
   * URLs de subida/lectura que consume el navegador, así que debe ser la que
   * el navegador puede alcanzar (no 'localhost' si pruebas desde el celular).
   */
  get apiPublicUrl(): string {
    return (process.env.API_PUBLIC_URL ?? `http://localhost:${this.apiPort}`).replace(/\/$/, '');
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
  get messagingProvider(): 'fake' | 'live' {
    return process.env.MESSAGING_PROVIDER === 'live' ? 'live' : 'fake';
  },
  get twilioAccountSid(): string { return required('TWILIO_ACCOUNT_SID'); },
  get twilioAuthToken(): string { return required('TWILIO_AUTH_TOKEN'); },
  get twilioWhatsappFrom(): string { return required('TWILIO_WHATSAPP_FROM').replace(/^whatsapp:/,''); },
  twilioContentSid(kind:'confirmation'|'reminder'|'rescheduled'|'cancelled'):string {
    return required(`TWILIO_CONTENT_SID_${kind.toUpperCase()}`);
  },
  get twilioStatusCallbackUrl(): string {
    return process.env.TWILIO_STATUS_CALLBACK_URL ?? `${this.apiPublicUrl}/api/webhooks/twilio/status`;
  },
  get resendWebhookSecret(): string { return required('RESEND_WEBHOOK_SECRET'); },
  /** Firma enlaces de acción enviados por mensajería; independiente del JWT de usuarios. */
  get publicLinkSecret(): string { return process.env.PUBLIC_LINK_SECRET ?? this.jwtSecret; },
  get workerPollMs(): number { return Math.max(500,Number(process.env.WORKER_POLL_MS ?? 5000)); },
};
