#!/usr/bin/env bash
#
# Levanta el entorno completo de desarrollo:
#   :3001  API      (NestJS, monorepo HEALTHFLOW)
#   :3000  SaaS     (Next.js, apps/web)
#   :3100  Landing  (Next.js, repo LD_HEALTHFLOW)
#   stripe listen → reenvía webhooks de Stripe al API
#
# Uso:   ./dev-all.sh          levanta todo
#        ./dev-all.sh stop     detiene todo
#
# Los logs quedan en /tmp/hf-*.log

set -uo pipefail

HEALTHFLOW_DIR="/Users/jorge/HEALTHFLOW"
LANDING_DIR="/Users/jorge/LD_HEALTHFLOW"

stop_all() {
  echo "Deteniendo servicios..."
  lsof -ti:3000 -ti:3001 -ti:3100 2>/dev/null | xargs -r kill -9 2>/dev/null
  pkill -f "stripe listen" 2>/dev/null
  echo "✓ Detenido"
}

if [ "${1:-}" = "stop" ]; then
  stop_all
  exit 0
fi

# Arranca de cero para evitar puertos ocupados por un proceso zombie.
stop_all
sleep 1

if ! pg_isready -q; then
  echo "✗ Postgres no responde. Arráncalo con: brew services start postgresql@16"
  exit 1
fi

echo "Levantando API (:3001)..."
cd "$HEALTHFLOW_DIR" && nohup pnpm --filter @healthflow/api dev > /tmp/hf-api.log 2>&1 &

echo "Levantando SaaS (:3000)..."
cd "$HEALTHFLOW_DIR" && nohup pnpm --filter @healthflow/web dev > /tmp/hf-web.log 2>&1 &

echo "Levantando landing (:3100)..."
cd "$LANDING_DIR" && nohup npm run dev > /tmp/hf-landing.log 2>&1 &

# El API necesita STRIPE_SECRET_KEY del .env para reenviar webhooks firmados.
STRIPE_KEY=$(grep "^STRIPE_SECRET_KEY=" "$HEALTHFLOW_DIR/.env" | cut -d= -f2)
if [ -n "$STRIPE_KEY" ]; then
  echo "Levantando stripe listen..."
  nohup stripe listen --api-key "$STRIPE_KEY" \
    --forward-to localhost:3001/api/subscriptions/webhook > /tmp/stripe-listen.log 2>&1 &
fi

# Espera a que los tres puertos respondan (máx ~30s).
for _ in $(seq 1 30); do
  if lsof -ti:3000 >/dev/null 2>&1 && lsof -ti:3001 >/dev/null 2>&1 && lsof -ti:3100 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo ""
lsof -ti:3001 >/dev/null 2>&1 && echo "✓ API      http://localhost:3001/api" || echo "✗ API      (ver /tmp/hf-api.log)"
lsof -ti:3000 >/dev/null 2>&1 && echo "✓ SaaS     http://localhost:3000"     || echo "✗ SaaS     (ver /tmp/hf-web.log)"
lsof -ti:3100 >/dev/null 2>&1 && echo "✓ Landing  http://localhost:3100"     || echo "✗ Landing  (ver /tmp/hf-landing.log)"
pgrep -f "stripe listen" >/dev/null && echo "✓ Stripe   webhooks → :3001"     || echo "✗ Stripe   (ver /tmp/stripe-listen.log)"
