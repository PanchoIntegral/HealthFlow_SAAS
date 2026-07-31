# HealthFlow

SaaS médico para gestión de citas y expedientes clínicos (NOM-004-SSA3-2012 / LFPDPPP).

Todos los módulos atraviesan la misma arquitectura vertical (dominio hexagonal → Drizzle →
RLS multi-tenant → WebSocket/HTTP → UI). Módulos construidos:

- **Sala de espera en tiempo real** — check-in y ciclo de vida de la cita, con WebSocket.
- **Pacientes** — alta (con validación de CURP) y buscador.
- **Expediente clínico + editor NOM-004** — consulta completa (`en_espera → en_consulta →
  finalizada`), nota de evolución con editor estructurado (TipTap + signos vitales +
  diagnósticos CIE-10), validación de cierre y **notas inmutables** conforme a NOM-004.

Pendientes: historia clínica (primera consulta), calendario, dashboard, jobs (no-show).

## Arquitectura

- **Monolito modular** con **arquitectura hexagonal** por módulo (`domain` / `application` /
  `infrastructure`).
- **Multi-tenant** por `tenant_id` reforzado con **Row-Level Security** de PostgreSQL: la
  base de datos garantiza el aislamiento aunque falle el código de aplicación.
- El API se conecta con un rol **no-superusuario** (`healthflow_app`) para que RLS aplique;
  las migraciones/seeds corren con el rol admin.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 15 + React 19 + TypeScript + Tailwind + TanStack Query |
| Backend | NestJS 10 + TypeScript |
| Base de datos | PostgreSQL + **Drizzle ORM** + Row-Level Security |
| Tiempo real | Socket.io |
| Auth | Passport JWT + CASL (RBAC) |
| Monorepo | Turborepo + pnpm |

> Se eligió **Drizzle** sobre Prisma por su control directo de la sesión Postgres,
> necesario para setear `app.current_tenant` que la política RLS consume.

## Requisitos

- Node ≥ 20, pnpm 11
- PostgreSQL corriendo en `localhost:5432` (local con Homebrew, o `docker compose up postgres`)

## Puesta en marcha

```bash
pnpm install
cp .env.example .env          # ajusta DB_ADMIN_URL a tu usuario de Postgres

pnpm db:setup                 # crea la DB y el rol de aplicación (no-superusuario)
pnpm db:migrate               # aplica esquema + políticas RLS
pnpm db:seed                  # 2 clínicas de demo

pnpm dev                      # levanta api (:3001) + web (:3000)
```

Entra a http://localhost:3000 con una cuenta de demo (contraseña `password123`):

| Rol | Email |
|---|---|
| Asistente · Clínica Norte | `asistente@norte.mx` |
| Médica · Clínica Norte | `dra.cervantes@norte.mx` |
| Médico · Clínica Sur | `dr.lopez@sur.mx` |

**Para ver el tiempo real:** abre la sala de espera en dos pestañas (misma clínica), marca la
llegada de un paciente en una y observa cómo la otra se actualiza sin recargar.

## Tests

```bash
pnpm --filter @healthflow/api test:domain       # máquina de estados, sin DB
pnpm --filter @healthflow/api test:integration  # aislamiento RLS con Postgres real
```

## Estructura

```
apps/
  api/   → NestJS. Módulos hexagonales en src/modules/*, capa DB en src/db/*
  web/   → Next.js (App Router)
packages/
  shared-types/  → contratos TypeScript compartidos front↔back
  config/        → tsconfig base
```

## Seguridad del acceso y anti-abuso

Defensa en capas sobre `/api/auth/login`, de la más barata a la más cara:

| Capa | Dónde | Qué corta |
|---|---|---|
| Cabeceras (helmet) + límite de body 256 kb + timeouts de socket | `main.ts` | Payloads gigantes y slow-loris |
| Rate limit por IP: 60 req/s y 600 req/min | `GlobalThrottlerGuard` (toda la API) | Inundación genérica |
| Rate limit del login: 3 req/s y 10 req/min | `@Throttle` en `auth.controller.ts` | Ráfagas de fuerza bruta, antes de tocar la BD |
| Bloqueo progresivo por email + IP | `login-policy.ts` + tabla `login_attempts` | Fuerza bruta lenta; sobrevive a reinicios |
| Semáforo de bcrypt (4 en vuelo, cola de 50) | `password-hasher.service.ts` | Agotamiento de CPU vía hashing |
| bcrypt de descarte si el email no existe | `auth.service.ts` | Enumeración de cuentas por temporización |

El bloqueo por **email** es corto a propósito (máx. 15 min): un castigo largo
convertiría el propio candado en un ataque de denegación de servicio contra un
médico que no recuerda su contraseña. El bloqueo por **IP** sí escala hasta 2 h.

`TRUST_PROXY_HOPS` debe coincidir con el número real de proxies delante del
proceso (ver `.env.example`); si no, todos los límites por IP ven la IP del
balanceador en vez de la del cliente.

## Fuera de alcance (siguientes iteraciones)

Expediente clínico (`clinical_records`/`notes`/`amendments`), editor NOM-004 con TipTap,
validador de cierre, calendario, dashboard, jobs BullMQ (no-show automático). Todo reusa el
patrón hexagonal ya establecido por el módulo `appointments`.
# HealthFlow_SAAS
