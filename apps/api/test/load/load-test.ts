/**
 * Banco de carga: cuántos usuarios concurrentes aguanta la API antes de
 * degradarse, y por dónde revienta primero.
 *
 * Cada usuario virtual manda un `X-Forwarded-For` distinto, así que el rate
 * limiting por IP los trata como personas diferentes — que es lo que pasa en
 * la realidad. Requiere que la instancia bajo prueba corra con
 * TRUST_PROXY_HOPS=1; si no, Express ignora la cabecera, todos los usuarios
 * virtuales caen en el mismo cubo y lo único que mides es tu propio throttler.
 *
 * Uso:
 *   pnpm --filter @healthflow/api load-test -- --escenario lectura --usuarios 50 --segundos 20
 *
 *   --rampa      sube la carga al doble por escalón hasta encontrar el quiebre
 *   --umbral     ms de p95 a partir de los cuales se considera degradado (default: 1000)
 *   --escenario  lectura | login | agenda      (default: lectura)
 *   --usuarios   usuarios concurrentes         (default: 25, ignorado con --rampa)
 *   --pausa      ms de espera entre peticiones de un mismo usuario (default: 1000)
 *   --segundos   duración                      (default: 15)
 *   --url        base de la API                (default: http://localhost:3099)
 *   --email / --password  credenciales de una cuenta real de esa base
 *
 * `--pausa` es lo que separa "usuarios" de "bots": una persona usando la app
 * dispara del orden de una petición por segundo, no mil. Sin pausa cada usuario
 * virtual choca contra su propio rate limit por IP y lo único que mides es el
 * throttler. La carga ofrecida es usuarios / (pausa/1000) peticiones por segundo.
 *
 * NUNCA lo apuntes a producción con tráfico real: además de ensuciar métricas,
 * el escenario `login` consume CPU de verdad y puede degradar a usuarios vivos.
 * Úsalo contra local o contra un staging con datos de prueba.
 */

interface Opciones {
  escenario: 'lectura' | 'login' | 'agenda';
  usuarios: number;
  pausaMs: number;
  segundos: number;
  url: string;
  email: string;
  password: string;
  rampa: boolean;
  umbralMs: number;
}

function parseOpciones(argv: string[]): Opciones {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    // pnpm reenvía un `--` suelto como separador; no es una opción.
    if (arg === '--' || !arg.startsWith('--')) continue;
    if (arg === '--rampa') {
      flags.set('rampa', 'si');
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`El argumento ${arg} necesita un valor`);
    }
    flags.set(arg.slice(2), value);
    i++;
  }

  const escenario = (flags.get('escenario') ?? 'lectura') as Opciones['escenario'];
  if (!['lectura', 'login', 'agenda'].includes(escenario)) {
    throw new Error('--escenario debe ser: lectura, login o agenda');
  }

  return {
    escenario,
    usuarios: Number(flags.get('usuarios') ?? 25),
    pausaMs: Number(flags.get('pausa') ?? 1000),
    segundos: Number(flags.get('segundos') ?? 15),
    url: (flags.get('url') ?? 'http://localhost:3099').replace(/\/$/, ''),
    email: flags.get('email') ?? 'asistente@norte.mx',
    password: flags.get('password') ?? 'password123',
    rampa: flags.has('rampa'),
    umbralMs: Number(flags.get('umbral') ?? 1000),
  };
}

interface Muestra {
  ms: number;
  status: number;
}

/** Percentil sobre latencias YA ordenadas. */
function percentil(ordenadas: number[], p: number): number {
  if (ordenadas.length === 0) return 0;
  const idx = Math.min(ordenadas.length - 1, Math.floor((p / 100) * ordenadas.length));
  return ordenadas[idx]!;
}

async function obtenerToken(o: Opciones): Promise<string> {
  const res = await fetch(`${o.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.0.1' },
    body: JSON.stringify({ email: o.email, password: o.password }),
  });
  if (!res.ok) {
    throw new Error(
      `No se pudo obtener token (${res.status}). Revisa --email/--password y que la API esté arriba.`,
    );
  }
  return ((await res.json()) as { accessToken: string }).accessToken;
}

/** Una petición del escenario, ya resuelta a método/ruta/cuerpo. */
function construirPeticion(
  o: Opciones,
  token: string,
  ip: string,
): { url: string; init: RequestInit } {
  const headers: Record<string, string> = { 'X-Forwarded-For': ip };

  if (o.escenario === 'login') {
    // El camino más caro: bcrypt + escritura. Credenciales VÁLIDAS a propósito
    // — con credenciales malas mediríamos el bloqueo progresivo, no la capacidad.
    headers['Content-Type'] = 'application/json';
    return {
      url: `${o.url}/api/auth/login`,
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: o.email, password: o.password }),
      },
    };
  }

  headers['Authorization'] = `Bearer ${token}`;

  if (o.escenario === 'agenda') {
    // Consulta con rango de fechas: la más pesada de las de lectura.
    const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const hasta = new Date(Date.now() + 86_400_000).toISOString();
    return {
      url: `${o.url}/api/appointments?from=${desde}&to=${hasta}`,
      init: { method: 'GET', headers },
    };
  }

  // 'lectura': el dashboard, que es lo primero que abre todo el mundo.
  return { url: `${o.url}/api/dashboard/stats`, init: { method: 'GET', headers } };
}

interface Resultado {
  ofrecida: number;
  servida: number;
  total: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  porStatus: Map<number, number>;
  errores: string[];
  /** Fracción de peticiones que devolvieron 2xx sobre TODO lo intentado. */
  exito: number;
}

async function ejecutarPrueba(o: Opciones, token: string): Promise<Resultado> {
  const muestras: Muestra[] = [];
  const errores: string[] = [];
  const finTiempo = Date.now() + o.segundos * 1000;

  /** Un usuario virtual: pide en bucle hasta que se acaba el tiempo. */
  async function usuarioVirtual(n: number): Promise<void> {
    // IP única y estable por usuario virtual, para que el rate limiting por IP
    // los cuente separados igual que a personas distintas.
    const ip = `10.${Math.floor(n / 65_536) % 256}.${Math.floor(n / 256) % 256}.${n % 256}`;

    // Arranque escalonado: si los N usuarios empiezan en el mismo milisegundo
    // el primer segundo es un pico artificial que no se repite después.
    await esperarHasta((o.pausaMs * n) / o.usuarios, finTiempo);

    while (Date.now() < finTiempo) {
      const inicioCiclo = performance.now();
      const { url, init } = construirPeticion(o, token, ip);
      try {
        const res = await fetch(url, init);
        await res.arrayBuffer(); // drena el cuerpo: sin esto la latencia miente
        muestras.push({ ms: performance.now() - inicioCiclo, status: res.status });
      } catch (err) {
        errores.push(err instanceof Error ? err.message : String(err));
      }
      // Descuenta lo que tardó la petición: así el ritmo ofrecido se mantiene
      // constante aunque el servidor se ponga lento (carga abierta). Si la
      // petición ya tardó más que la pausa, el siguiente ciclo sale de inmediato.
      await esperarHasta(o.pausaMs - (performance.now() - inicioCiclo), finTiempo);
    }
  }

  const t0 = performance.now();
  await Promise.all(Array.from({ length: o.usuarios }, (_, n) => usuarioVirtual(n + 1)));
  const duracionReal = (performance.now() - t0) / 1000;

  // ── Resultados ───────────────────────────────────────────────────
  const porStatus = new Map<number, number>();
  for (const m of muestras) porStatus.set(m.status, (porStatus.get(m.status) ?? 0) + 1);

  const ok = muestras.filter((m) => m.status < 400);
  const latencias = ok.map((m) => m.ms).sort((a, b) => a - b);

  // Los intentos sin respuesta cuentan como fallo: para el usuario, una
  // petición que nunca vuelve es idéntica a un error del servidor.
  const intentos = muestras.length + errores.length;

  return {
    ofrecida: o.usuarios / (o.pausaMs / 1000),
    servida: ok.length / duracionReal,
    total: intentos,
    p50: percentil(latencias, 50),
    p95: percentil(latencias, 95),
    p99: percentil(latencias, 99),
    max: latencias.at(-1) ?? 0,
    porStatus,
    errores,
    exito: intentos === 0 ? 0 : ok.length / intentos,
  };
}

function imprimirResultado(o: Opciones, r: Resultado): void {
  console.log(`  Carga ofrecida  ${r.ofrecida.toFixed(1)} req/s  (${o.usuarios} usuarios cada ${o.pausaMs}ms)`);
  console.log(`  Servida OK      ${r.servida.toFixed(1)} req/s  (${(r.exito * 100).toFixed(1)}% de éxito)`);
  console.log(`  Peticiones      ${r.total}\n`);

  console.log('  Latencia de las exitosas (ms)');
  console.log(`    p50   ${r.p50.toFixed(0)}`);
  console.log(`    p95   ${r.p95.toFixed(0)}`);
  console.log(`    p99   ${r.p99.toFixed(0)}`);
  console.log(`    max   ${r.max.toFixed(0)}\n`);

  console.log('  Respuestas por código');
  for (const [status, n] of [...r.porStatus].sort((a, b) => a[0] - b[0])) {
    const pct = ((n / r.total) * 100).toFixed(1);
    console.log(`    ${status}  ${String(n).padStart(6)}  ${pct.padStart(5)}%  ${etiqueta(status)}`);
  }
  if (r.errores.length) {
    console.log(`\n  ⚠  ${r.errores.length} peticiones sin respuesta: ${r.errores[0]}`);
  }
  console.log();
}

/**
 * Prueba de estrés propiamente dicha: sube la carga al doble en cada escalón
 * hasta que el servidor se degrada, y reporta el último nivel sano. Eso es lo
 * que quieres saber — no "¿aguanta X?", sino "¿dónde se rompe y cómo?".
 *
 * Entre escalones deja un respiro para que se drenen las colas: sin él, el
 * atasco de un escalón contamina la medición del siguiente y el punto de
 * quiebre aparece antes de donde realmente está.
 */
async function ejecutarRampa(o: Opciones, token: string): Promise<void> {
  const inicio = o.escenario === 'login' ? 5 : 50;
  const MAX_ESCALONES = 8;
  const REPOSO_MS = 5_000;

  console.log(`  ${'req/s'.padStart(7)} ${'servido'.padStart(8)} ${'éxito'.padStart(7)} ${'p95 ms'.padStart(8)}   veredicto`);
  console.log(`  ${'─'.repeat(50)}`);

  let ultimoSano = 0;
  for (let i = 0, objetivo = inicio; i < MAX_ESCALONES; i++, objetivo *= 2) {
    const paso: Opciones = { ...o, usuarios: Math.round(objetivo * (o.pausaMs / 1000)) };
    const r = await ejecutarPrueba(paso, token);

    const sano = r.exito >= 0.99 && r.p95 <= o.umbralMs;
    if (sano) ultimoSano = r.servida;
    const veredicto = sano
      ? 'ok'
      : r.exito < 0.99
        ? `✗ ${((1 - r.exito) * 100).toFixed(0)}% de fallos`
        : `✗ p95 sobre ${o.umbralMs}ms`;

    console.log(
      `  ${objetivo.toFixed(0).padStart(7)} ${r.servida.toFixed(1).padStart(8)} ` +
        `${(r.exito * 100).toFixed(1).padStart(6)}% ${r.p95.toFixed(0).padStart(8)}   ${veredicto}`,
    );

    if (!sano) {
      console.log(`\n  ▸ Punto de quiebre entre ${(objetivo / 2).toFixed(0)} y ${objetivo.toFixed(0)} req/s`);
      console.log(`  ▸ Capacidad sostenible: ~${ultimoSano.toFixed(0)} req/s del escenario "${o.escenario}"\n`);
      return;
    }
    await esperar(REPOSO_MS);
  }
  console.log(`\n  ▸ No se encontró el límite hasta ${(inicio * 2 ** (MAX_ESCALONES - 1)).toFixed(0)} req/s.\n`);
}

async function main() {
  const o = parseOpciones(process.argv.slice(2));
  const token = o.escenario === 'login' ? '' : await obtenerToken(o);

  if (o.rampa) {
    console.log(`\n▸ Rampa · escenario ${o.escenario} · ${o.segundos}s por escalón · ${o.url}`);
    console.log(`  Se considera degradado si el éxito baja de 99% o el p95 pasa de ${o.umbralMs}ms\n`);
    await ejecutarRampa(o, token);
    return;
  }

  console.log(`\n▸ Escenario ${o.escenario} · ${o.usuarios} usuarios · ${o.segundos}s · ${o.url}\n`);
  imprimirResultado(o, await ejecutarPrueba(o, token));
}

/**
 * Duerme `ms`, pero nunca más allá del final de la prueba. Sin este tope, un
 * usuario virtual con pausa larga se quedaba dormido pasado el deadline y
 * estiraba la duración medida — lo que hundía artificialmente el req/s servido.
 */
function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function esperarHasta(ms: number, finTiempo: number): Promise<void> {
  const tope = Math.min(ms, finTiempo - Date.now());
  if (tope <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, tope));
}

function etiqueta(status: number): string {
  if (status < 300) return 'ok';
  if (status === 401) return 'token inválido/expirado';
  if (status === 429) return 'rate limit — el throttler está cortando';
  if (status === 503) return 'semáforo de bcrypt saturado';
  if (status >= 500) return '⚠ ERROR DEL SERVIDOR — aquí es donde revienta';
  return '';
}

main().catch((err: unknown) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
