/**
 * Replica en la cuenta LIVE de Stripe todo lo que HealthFlow necesita:
 * productos, los 4 precios, el webhook endpoint y el Customer Portal.
 *
 * Es idempotente: usa `lookup_key` en los precios y busca el endpoint por URL,
 * así que correrlo dos veces no duplica nada.
 *
 *   STRIPE_LIVE_KEY=sk_live_xxx API_PUBLIC_URL=https://api.tudominio.com \
 *     node scripts/stripe-setup-live.mjs [--apply]
 *
 * Sin --apply sólo muestra lo que haría.
 */
import Stripe from 'stripe';
import readline from 'node:readline';

/**
 * Pide la clave por teclado sin ecoarla, para que nunca quede en el historial
 * del shell ni en una captura de pantalla.
 */
async function pedirClaveOculta() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const alSilenciar = (s) => { if (s.trim().length) process.stdout.write('*'); };
  rl._writeToOutput = alSilenciar;
  process.stdout.write('Clave secreta live (no se muestra): ');
  const clave = await new Promise((res) => rl.question('', res));
  rl.close();
  process.stdout.write('\n');
  return clave.trim();
}

const API_URL = process.env.API_PUBLIC_URL?.replace(/\/$/, '');
const APPLY = process.argv.includes('--apply');
const ROTAR = process.argv.includes('--rotar-webhook');

// Vía alternativa: STRIPE_LIVE_KEY_FILE=/ruta/al/archivo — evita el pegado
// interactivo, que en algunas terminales ensucia el texto.
const KEY_FILE = process.env.STRIPE_LIVE_KEY_FILE;
const KEY = KEY_FILE
  ? (await import('node:fs')).readFileSync(KEY_FILE, 'utf8').trim()
  : process.env.STRIPE_LIVE_KEY || (process.stdin.isTTY ? await pedirClaveOculta() : '');

if (!KEY.startsWith('sk_live_')) {
  console.error('✗ La clave debe empezar con sk_live_… (y ser la recién rotada).');
  process.exit(1);
}
if (KEY.includes('=') || KEY.includes(' ')) {
  console.error('✗ La clave trae un "=" o un espacio — probablemente se pegó junto con otra variable.');
  process.exit(1);
}
if (!API_URL?.startsWith('https://')) {
  console.error('✗ API_PUBLIC_URL debe ser una URL https pública (no localhost).');
  process.exit(1);
}

const stripe = new Stripe(KEY);
const WEBHOOK_URL = `${API_URL}/api/subscriptions/webhook`;

// Los mismos eventos que maneja handle-stripe-webhook.use-case.ts
const EVENTOS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
];

// Copiados tal cual de los precios que ya existen en la cuenta de test.
const PLANES = [
  { producto: 'HealthFlow Individual',  slug: 'individual',  env: 'STRIPE_PRICE_ID_INDIVIDUAL',        monto:   69000, interval: 'month' },
  { producto: 'HealthFlow Consultorio', slug: 'consultorio', env: 'STRIPE_PRICE_ID_CONSULTORIO',       monto:  149000, interval: 'month' },
  { producto: 'HealthFlow Individual',  slug: 'individual',  env: 'STRIPE_PRICE_ID_INDIVIDUAL_ANUAL',  monto:  662400, interval: 'year'  },
  { producto: 'HealthFlow Consultorio', slug: 'consultorio', env: 'STRIPE_PRICE_ID_CONSULTORIO_ANUAL', monto: 1430400, interval: 'year'  },
];

const mxn = (c) => (c / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const log = (...a) => console.log(...a);

if (!APPLY) log('◆ MODO SIMULACIÓN — nada se va a crear. Agrega --apply para ejecutar.\n');

/** Busca un producto por metadata.slug o lo crea. */
async function asegurarProducto(nombre, slug) {
  const { data } = await stripe.products.search({ query: `metadata['slug']:'${slug}'`, limit: 1 });
  if (data[0]) { log(`  = producto "${nombre}" ya existe (${data[0].id})`); return data[0]; }
  if (!APPLY) { log(`  + crearía producto "${nombre}"`); return { id: `prod_SIMULADO_${slug}` }; }
  const p = await stripe.products.create({ name: nombre, metadata: { slug } });
  log(`  + producto "${nombre}" creado (${p.id})`);
  return p;
}

/** Busca un precio por lookup_key o lo crea. */
async function asegurarPrecio(productId, plan) {
  const lookupKey = plan.env.toLowerCase();
  const { data } = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  if (data[0]) { log(`  = ${plan.env} ya existe (${data[0].id})`); return data[0].id; }
  if (!APPLY) { log(`  + crearía ${plan.env} — ${mxn(plan.monto)} / ${plan.interval}`); return 'price_SIMULADO'; }
  const p = await stripe.prices.create({
    product: productId,
    unit_amount: plan.monto,
    currency: 'mxn',
    recurring: { interval: plan.interval },
    lookup_key: lookupKey,
  });
  log(`  + ${plan.env} creado (${p.id}) — ${mxn(plan.monto)} / ${plan.interval}`);
  return p.id;
}

async function asegurarWebhook() {
  const { data } = await stripe.webhookEndpoints.list({ limit: 100 });
  const existente = data.find((e) => e.url === WEBHOOK_URL);

  // --rotar-webhook: Stripe no permite leer un whsec_ ya creado ni rotarlo por
  // API, así que se borra el endpoint y se crea de nuevo. La URL no cambia;
  // sólo cambian el id del endpoint y el secreto.
  if (existente && ROTAR) {
    if (!APPLY) { log(`  + rotaría el webhook (borrar ${existente.id} y recrear)`); return null; }
    await stripe.webhookEndpoints.del(existente.id);
    log(`  - webhook anterior borrado (${existente.id})`);
    const nuevo = await stripe.webhookEndpoints.create({ url: WEBHOOK_URL, enabled_events: EVENTOS });
    log(`  + webhook recreado (${nuevo.id}) → ${WEBHOOK_URL}`);
    return nuevo.secret;
  }

  if (existente) {
    const faltan = EVENTOS.filter((e) => !existente.enabled_events.includes(e));
    if (faltan.length && APPLY) {
      await stripe.webhookEndpoints.update(existente.id, { enabled_events: EVENTOS });
      log(`  ~ webhook actualizado, se agregaron: ${faltan.join(', ')}`);
    } else {
      log(`  = webhook ya existe (${existente.id})${faltan.length ? ` — faltan ${faltan.join(', ')}` : ''}`);
    }
    log('  ! el whsec_ de un endpoint existente sólo se ve en el dashboard');
    return null;
  }
  if (!APPLY) { log(`  + crearía webhook → ${WEBHOOK_URL}`); return null; }
  const e = await stripe.webhookEndpoints.create({ url: WEBHOOK_URL, enabled_events: EVENTOS });
  log(`  + webhook creado (${e.id}) → ${WEBHOOK_URL}`);
  return e.secret;
}

async function asegurarPortal(productos, precios) {
  const { data } = await stripe.billingPortal.configurations.list({ limit: 1 });
  if (data[0]?.active) { log(`  = Customer Portal ya configurado (${data[0].id})`); return; }
  if (!APPLY) { log('  + configuraría el Customer Portal'); return; }
  const c = await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'HealthFlow — administra tu suscripción' },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address', 'tax_id'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        proration_behavior: 'create_prorations',
        products: productos.map((p) => ({ product: p.id, prices: precios[p.id] })),
      },
    },
  });
  log(`  + Customer Portal configurado (${c.id})`);
}

let cuenta;
try {
  cuenta = await stripe.accounts.retrieve();
} catch (e) {
  if (e.type === 'StripeAuthenticationError') {
    console.error('\n✗ Stripe rechazó la clave (401).');
    console.error(`  Recibí: sk_live_…${KEY.slice(-4)}  (${KEY.length} caracteres)`);
    const sospechoso = [...KEY].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126);
    if (sospechoso) console.error('  ⚠ La clave trae caracteres raros — el pegado se ensució.');
    if (KEY.length < 100) console.error('  ⚠ Se ve corta: una sk_live_ ronda los 107 caracteres.');
    console.error('  Verifica en el dashboard que esos últimos 4 sean los de la clave vigente.');
  } else {
    console.error(`\n✗ Error de Stripe: ${e.message}`);
  }
  process.exit(1);
}
log(`Cuenta live: ${cuenta.business_profile?.name || cuenta.id}  (país ${cuenta.country})`);
log(`Cargos habilitados: ${cuenta.charges_enabled ? 'sí' : 'NO — Stripe aún no activa tu cuenta'}\n`);

log('▸ Productos y precios');
const productosPorNombre = new Map();
const preciosPorProducto = {};
const salida = {};
for (const plan of PLANES) {
  if (!productosPorNombre.has(plan.producto)) {
    productosPorNombre.set(plan.producto, await asegurarProducto(plan.producto, plan.slug));
  }
  const prod = productosPorNombre.get(plan.producto);
  const priceId = await asegurarPrecio(prod.id, plan);
  salida[plan.env] = priceId;
  (preciosPorProducto[prod.id] ??= []).push(priceId);
}

log('\n▸ Webhook');
const whsec = await asegurarWebhook();

log('\n▸ Customer Portal');
await asegurarPortal([...productosPorNombre.values()], preciosPorProducto);

log('\n─────────────────────────────────────────────');
log('Pega esto en el .env de producción:\n');
log('STRIPE_SECRET_KEY=<tu sk_live_ rotada>');
log(`STRIPE_WEBHOOK_SECRET=${whsec ?? '<cópialo del dashboard → Developers → Webhooks>'}`);
for (const [k, v] of Object.entries(salida)) log(`${k}=${v}`);
log('APP_URL=<https://app.tudominio.com>');
log('MARKETING_URL=<https://tudominio.com>');
log('WEB_ORIGIN=<https://app.tudominio.com>');
