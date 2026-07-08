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

## Fuera de alcance (siguientes iteraciones)

Expediente clínico (`clinical_records`/`notes`/`amendments`), editor NOM-004 con TipTap,
validador de cierre, calendario, dashboard, jobs BullMQ (no-show automático). Todo reusa el
patrón hexagonal ya establecido por el módulo `appointments`.
