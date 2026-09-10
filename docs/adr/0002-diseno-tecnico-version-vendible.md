# ADR 0002. Diseño técnico de la versión vendible (P0 y P1)

- Estado: propuesto
- Fecha: 2026-09-10
- Contexto de referencia: `README_VERSION_VENDIBLE.md`
- Alcance: decisiones de arquitectura necesarias para ejecutar P0.1 a P0.8 y P1.6 a P1.7 sin cambiar el estilo actual del sistema (NestJS + PostgreSQL con RLS, outbox en PostgreSQL, worker con rol propio).

Este documento evalúa el plan contra el código real y fija cómo se construye cada pieza. Donde el plan y el código discrepan, gana lo que se verificó en el código y se anota la corrección al plan.

---

## 1. Requisitos y restricciones

### Funcionales

- Reserva pública, confirmación, recordatorios (48 h y 24 h), reprogramación y cancelación, con un mensaje por evento y canal autorizado.
- Recepción puede crear citas internas con la misma mensajería.
- Métricas de embudo reconciliables con citas reales.
- Aviso de privacidad legible y versionado.

### No funcionales

| Dimensión | Objetivo para el piloto |
|---|---|
| Escala | 3 a 5 clínicas; estimación de 150 citas/día y menos de 600 mensajes/día en total |
| Latencia | p95 de disponibilidad y reserva por debajo de 500 ms; recordatorios con tolerancia de minutos |
| Disponibilidad | API y worker reiniciables sin pérdida; tolerancia a caída de proveedor externo |
| Corrección | Cero duplicados al paciente; cero fugas entre tenants; cero datos clínicos fuera de PostgreSQL |
| Costo | Sin infraestructura nueva (no colas externas, no Redis) hasta después del piloto |

### Restricciones heredadas del sistema

- Aislamiento por RLS con `current_tenant_id()`; funciones `SECURITY DEFINER` para los cruces entre tenants del worker y de los webhooks.
- Roles `healthflow_app` (API) y `healthflow_worker` (worker). Ambos existen y los `GRANT` ya distinguen funciones de reclamo.
- El token público de gestión es determinista: `HMAC(secret, tenantId.appointmentId)`; en base sólo vive su hash. Esto es relevante para la caducidad (ver 3.C).
- La siguiente migración es `0042`.

---

## 2. Diseño de alto nivel

```text
                          ┌──────────────────────────────────────────────┐
  Paciente (web pública)  │  API NestJS (rol healthflow_app)             │
  ── /r/[slug] ─────────► │  public-booking: availability/create/manage  │
  ── /cita/[token] ─────► │  patients, appointments (recepción)          │
                          │  messaging.controller: webhooks + admin      │
  Recepción / admin ────► │  health: /live /ready                        │
                          └───────────────┬──────────────────────────────┘
                                          │ una transacción por acción:
                                          │ cita + auditoría + outbox + evento
                                          ▼
                          ┌──────────────────────────────────────────────┐
                          │ PostgreSQL (RLS)                             │
                          │  appointments  patients  consent_events      │
                          │  outbound_messages (outbox)                  │
                          │  messaging_events (hechos para métricas)     │
                          │  messaging_webhook_events (dedupe + pending) │
                          │  tenant_feature_flags  worker_heartbeats     │
                          └───────────────┬──────────────────────────────┘
                                          │ claim_outbound_messages() SKIP LOCKED
                                          ▼
                          ┌──────────────────────────────────────────────┐
                          │ Worker (rol healthflow_worker)               │
                          │  clasifica resultado: ok | retryable |       │
                          │  permanent | uncertain                       │
                          └───────────────┬──────────────────────────────┘
                                          │ Twilio (WhatsApp) / Resend (correo)
                                          ▼
                                   Proveedores externos
                                          │ webhooks firmados
                                          ▼
                          process_messaging_status() ── pending si aún no
                                                        existe provider_message_id
```

Ciclo de vida de un mensaje en `outbound_messages` tras este diseño:

```text
pending ──claim──► processing ──ok──► sent ──webhook──► delivered
   ▲                   │                                   │
   │ backoff           ├─retryable──► failed ──(≤5)────────┘ reintento
   │                   │                 └─(>5)─► dead
   │                   ├─permanent──► dead
   │                   └─uncertain──► uncertain  (sin reintento automático)
   │                                      │ admin: "confirmar enviado" / "reenviar"
   └──────────────────────────────────────┘
 cancelled: por reprogramación, cancelación, retiro de consentimiento o supresión
 bounced / complained: sólo correo; suprime destino
```

---

## 3. Decisiones de diseño

### 3.A. Idempotencia de extremo a extremo (P0.1)

**Hallazgo verificado.** `LiveMessagingProvider.resend()` manda `Idempotency-Key: ${kind}:${manageUrl}`. El `manageUrl` es el mismo para toda la vida de la cita y `kind` es `reminder` para 48 h y 24 h. Resend descartará el segundo recordatorio. WhatsApp no tiene este problema porque Twilio no usa clave de idempotencia, pero tampoco tiene protección alguna.

**Hallazgo adicional no cubierto por el plan.** La clave de outbox incluye `startsAt`. Si un paciente reprograma A→B→A, los trabajos del segundo A chocan con las filas `cancelled` del primer A y `ON CONFLICT DO NOTHING` los descarta en silencio: el paciente se queda sin recordatorios. El plan asume que la clave actual es correcta; no lo es.

**Decisión.**

1. Añadir `appointments.messaging_version int NOT NULL DEFAULT 1`, incrementado en cada reprogramación pública o interna que mueva la cita.
2. La clave de outbox pasa a ser `${appointmentId}:${messaging_version}:${kind}[:${hours}]:${channel}`. Ya no depende de `startsAt`.
3. `claim_outbound_messages()` devuelve `idempotency_key` y `ProviderMessage` gana `idempotencyKey: string`. El adaptador de Resend la usa tal cual. El adaptador de Twilio la guarda como referencia opaca en el trabajo, no en el cuerpo.
4. Ningún adaptador deriva claves. El fake provider expone los metadatos recibidos (`kind`, `channel`, `idempotencyKey`) en memoria para las pruebas, nunca destino ni cuerpo.

**Migración `0042_messaging_claim_idempotency.sql`:** columna `messaging_version`, nueva firma de `claim_outbound_messages()` con `idempotency_key` y `GRANT` a ambos roles. Las claves antiguas siguen siendo únicas; no hace falta migrar datos.

**Trade-off.** Cambiar el formato de clave invalida la deduplicación con filas viejas. Es aceptable: las filas viejas están `sent`, `cancelled` o `dead` y no se vuelven a programar.

### 3.B. Semántica de entrega y carreras de webhooks (P0.2)

**Hallazgos verificados.**

- `process_messaging_status()` (0037) marca el webhook como `processed_at` cuando no encuentra el mensaje y devuelve `true`. El evento se pierde. Además `messaging_webhook_events` sólo guarda `provider` y `external_id`; no hay con qué reprocesar.
- `claim_outbound_messages()` vuelve a reclamar filas `processing` con `locked_at` de más de 10 minutos. Si el worker murió después de que Twilio aceptó y antes de `complete_outbound_message()`, el mensaje se reenvía. Es un duplicado garantizado, no hipotético.
- Cualquier excepción del proveedor cae en `finish(ok=false)` con backoff. Un timeout de `fetch` se trata igual que un 400. Eso convierte una aceptación ambigua en un reintento.
- Un webhook `undelivered` de Twilio vuelve a poner el mensaje en `failed` con `next_attempt_at`, así que el worker lo reenvía. Muchos códigos `undelivered` de WhatsApp son permanentes (número sin WhatsApp, plantilla rechazada, ventana cerrada). Hoy se reintentan hasta 5 veces.

**Decisión: at-most-once hacia el paciente, con revisión humana del residuo.** Preferimos un mensaje perdido y visible a un duplicado invisible. Esto es coherente con los eventos que detienen el piloto.

Cambios concretos:

1. Nuevo estado `uncertain` en `outbound_messages.status`.
2. El proveedor devuelve un resultado tipado, no lanza:

   ```ts
   type SendResult =
     | { outcome: 'accepted'; providerMessageId: string }
     | { outcome: 'retryable'; code: string }    // 429, 5xx, rechazo previo a aceptación
     | { outcome: 'permanent'; code: string }    // destino/plantilla inválidos, 4xx conocidos
     | { outcome: 'uncertain'; code: string };   // timeout, reset, respuesta ilegible
   ```

   La clasificación vive en `providers.ts` con tablas explícitas de códigos de Twilio y Resend, y una prueba por categoría.
3. `complete_outbound_message()` recibe el `outcome`. `permanent` va directo a `dead`; `uncertain` va a `uncertain` y libera el lock sin programar reintento.
4. El reclamo de filas `processing` vencidas deja de reenviar: pasa la fila a `uncertain` con `last_error_code='lock_expired'`. Sólo se reenvía por acción administrativa.
5. `messaging_webhook_events` gana `provider_message_id`, `status`, `payload jsonb` (mínimo y sanitizado: sin destino ni cuerpo) y `state in ('pending','processed','ignored')`. Si el mensaje no existe, el evento queda `pending`.
6. `complete_outbound_message()` con `accepted`, tras escribir `provider_message_id`, llama a `reprocess_pending_webhooks(provider, provider_message_id)`. El reprocesamiento es idempotente porque la clave primaria `(provider, external_id)` sigue siendo la deduplicación.
7. Un webhook `undelivered`/`failed` deja de reprogramar reintentos por sí mismo. Aplica la misma clasificación: `permanent` → `dead`, `retryable` → `failed` con backoff.
8. Alerta y panel: `uncertain` y webhooks `pending` de más de 15 minutos aparecen en `/messaging/deliveries` con acciones `marcar como enviado` (cuando el admin verificó en el proveedor) y `reenviar`. Ambas auditan actor y motivo.

**Migración `0043_messaging_uncertain_webhooks.sql`:** `CHECK` de estado ampliado, columnas nuevas en `messaging_webhook_events`, `complete_outbound_message(p_id, p_outcome, p_provider_id, p_error_code)`, `reprocess_pending_webhooks()`, cambio en `claim_outbound_messages()` para el lock vencido.

**Invariante de configuración a probar en CI.** El worker manda `StatusCallback = apiPublicUrl + /api/webhooks/twilio/status` y la firma se valida contra `env.twilioStatusCallbackUrl`. Si difieren, todo webhook de Twilio se rechaza. Deben derivarse de la misma variable o una prueba de arranque debe fallar cuando no coincidan.

**Trade-off.** At-most-once añade trabajo manual cuando el proveedor falla de forma ambigua. Con menos de 600 mensajes por día y proveedores con disponibilidad alta, se esperan pocos casos por semana. Si el volumen de `uncertain` crece, el siguiente paso es consultar el estado en el proveedor por `idempotencyKey` antes de decidir, no reintentar a ciegas.

### 3.C. Máquina de estados de la cita pública (P0.3)

**Hallazgos verificados en `booking.service.ts`.**

- `confirm()` sólo rechaza `cancelada`. Inserta un evento `confirmed` y actualiza en cada llamada.
- `reschedule()` no consulta `estatus`. Una cita cancelada, finalizada o `no_asistio` se puede mover, lo que además programa mensajes `rescheduled`.
- `cancel()` evalúa el límite de cancelación antes de comprobar si ya está cancelada, así que una segunda cancelación dentro del límite devuelve 403 en lugar de ser idempotente.

**Decisión.** Un módulo puro `booking.transitions.ts` sin dependencias de Nest ni de base de datos:

```ts
type PublicAction = 'confirm' | 'cancel' | 'reschedule';
interface AppointmentState { estatus: Estatus; confirmacion: Confirmacion; startsAt: Date; }
interface Policy { now: Date; limitHours: number; }

function decide(state, action, policy):
  | { kind: 'apply'; effects: Effect[] }      // ejecutar y registrar un único evento
  | { kind: 'noop' }                           // idempotente: devolver resumen, sin evento
  | { kind: 'reject'; reason: RejectReason }   // 409 con motivo genérico
```

El servicio sólo traduce `decide()` a SQL y a llamadas al outbox. La matriz del plan se codifica como tabla de pruebas en `booking.domain.spec.ts`. Reglas añadidas:

- Una cita cuyo `startsAt` ya pasó se trata como terminal para las tres acciones, aunque siga `agendada`, hasta que recepción la cierre.
- `reschedule` sobre `confirmada` vuelve a `pendiente`, incrementa `messaging_version`, cancela pendientes y programa `rescheduled` + recordatorios en la misma transacción.
- `cancel` idempotente: si ya está `cancelada` devuelve el resumen sin evaluar el límite.

**Caducidad del token.** El token es determinista y no se guarda en claro, así que no puede rotar ni revocarse por fila sin cambiar el secreto global. Decisión: la caducidad se calcula por estado, no por token. Las acciones se rechazan cuando la cita es terminal o cuando `now > fin_programado + 7 días`; la consulta `GET` sigue funcionando para mostrar el resumen. Esto cumple el criterio del plan sin introducir una tabla de tokens. Se revisará si el piloto pide "enlace de un solo uso".

### 3.D. Reprogramación con disponibilidad real (P0.4)

**Decisión.** Reutilizar el motor actual de disponibilidad, no duplicarlo.

- `GET /api/public/appointments/:token/availability?from=YYYY-MM-DD&to=YYYY-MM-DD&doctor=keep|any`
- La API resuelve tenant, servicio y duración desde la cita mediante `resolve_public_appointment_tenant(hash)`; nunca recibe `slug` ni `tenantId`.
- Reusa `availabilityForTx()` con `exclude = appointment.id` para que el propio horario aparezca libre.
- Ventana máxima de 7 días por request; el frontend navega semana a semana hasta `horizonte_dias` (misma base que P1.1).
- Respuesta: sólo `start`, `end`, `doctorId`, `doctorName`. Nada del resto de la agenda.
- `POST` de reprogramación exige `start` y `doctorId` o `any`. Ante `409` el cliente vuelve a pedir disponibilidad y muestra el conflicto.

Rate limit por token y por IP en este endpoint, igual que en el resto de rutas públicas.

### 3.E. Contactos y consentimiento como historial (P0.5 y P0.6)

**Hallazgo verificado.** `claim_outbound_messages()` ya lee `patients.email`, `telefono_normalizado`, `canal_preferido`, `whatsapp_opt_in_at` y `email_suppressed_at`, pero la entidad y los casos de uso de `patients/` sólo manejan `telefono`. Recepción no puede capturar ni corregir lo que la mensajería consume.

**Decisión.**

1. Tabla nueva `patient_consent_events(id, tenant_id, patient_id, tipo in ('whatsapp'), accion in ('otorgado','retirado'), version_aviso, origen in ('reserva_publica','recepcion','importacion'), actor_user_id null, created_at)` con RLS. Nunca se actualiza ni se borra.
2. `patients.whatsapp_opt_in_at` se conserva como columna derivada y se mantiene por trigger a partir del último evento. Así el worker y las consultas actuales no cambian.
3. Un formulario público nuevo con `whatsappOptIn=false` no inserta un evento de retiro; sólo inserta `otorgado` cuando es `true`. El retiro es una acción explícita de recepción o del paciente en `/cita/[token]`.
4. Retirar consentimiento cancela en la misma transacción los `outbound_messages` de WhatsApp en `pending`/`failed` del paciente.
5. Normalización única en `packages/shared-types` o en un paquete de dominio compartido: `normalizeEmail`, `normalizeMxPhone` (E.164 con `+52`, tolera `044`/`045` y espacios), `isRealCalendarDate`, `isPlausibleBirthDate` (no futura, máximo 120 años). API y web importan las mismas funciones.
6. Citas internas: al crear o mover una cita futura con paciente que tiene destino y autorización, `appointments` llama al mismo `OutboxService.schedule()`. Editar una cita pasada no programa nada. La UI avisa cuando el canal preferido no tiene destino o consentimiento.

**Migración `0044_patient_consent_events.sql`.**

### 3.F. Métricas del embudo (P0.7)

**Hallazgos verificados en `MessagingAdminController.metrics()`.**

- `public_bookings` cuenta eventos `scheduled`. Una reserva con canal `ninguno` no genera ese evento y no se cuenta.
- `confirmed`, `cancelled` y `rescheduled` cuentan eventos, no citas distintas.
- `no_shows` no tiene rango temporal; el resto usa el mes en curso.

**Decisión.** Dos consultas independientes con el mismo `[from, to)`:

- Citas: `appointments` filtradas por `inicio_programado` en el rango. Reservas públicas por `origen='publico'`; confirmadas, canceladas, reprogramadas, asistidas y no-show como `count(DISTINCT id)` con las columnas de estado, no con `messaging_events`. Reprogramaciones desde `messaging_version > 1`.
- Mensajes: `outbound_messages` filtrados por `scheduled_at` en el rango, agrupados por canal y estado.
- Tasas calculadas en la API con denominador explícito y `null` cuando el denominador es 0.
- `from`/`to` obligatorios, máximo 366 días, por defecto los últimos 30.

`messaging_events` deja de ser fuente de métricas y queda como bitácora.

### 3.G. Feature flags por tenant

**Hallazgo.** Sólo existe `booking_settings.feature_activa`. No hay mecanismo general.

**Decisión.** Tabla `tenant_feature_flags(tenant_id, flag text, enabled boolean, updated_at, updated_by)` con RLS y clave `(tenant_id, flag)`. Lectura cacheada por request en `TenantDbService`. Flags iniciales: `messaging_v2` (P0.1 a P0.2), `internal_appointment_messaging` (P0.6), `google_calendar`, `deposits`. Un flag desconocido se lee como `false`. Migración `0045_tenant_feature_flags.sql`.

### 3.H. Observabilidad y recuperación (P1.6 y P1.7)

**Hallazgo.** No existe ningún endpoint de salud. El worker sólo escribe logs.

**Decisión.**

- `GET /health/live` responde sin tocar la base. `GET /health/ready` ejecuta `SELECT 1` con timeout de 2 s.
- Tabla `worker_heartbeats(worker_name, last_tick_at, last_claimed, host)`; el worker la actualiza en cada `tick()` aunque no haya trabajo. Alerta si `now - last_tick_at > 3 min`.
- Vista `messaging_health` con: pendientes vencidos por antigüedad, conteo de `failed`, `dead`, `uncertain`, webhooks `pending` de más de 15 min, firmas rechazadas en la última hora (contador en memoria expuesto por la API).
- Logs estructurados con `correlationId`, `tenantHash` (HMAC del tenant, no el UUID), `entity`, `entityId` y `errorCode`. Prohibido por lint personalizado: `destination`, `email`, `telefono`, `token`, `body` en llamadas a `Logger`.
- Backups: snapshot diario cifrado con retención de 30 días más WAL para RPO de 15 minutos; RTO objetivo de 4 horas. El simulacro de restauración se documenta en `docs/runbooks/restauracion.md` con fecha, conteos por tabla y verificación de RLS.

### 3.I. Versionado del aviso de privacidad (P0.8)

**Decisión.** Tabla `privacy_notice_versions(id, tenant_id null, version, tipo in ('integral','simplificado'), contenido_md, publicado_at)`; `tenant_id` nulo representa el aviso de HealthFlow, y una clínica puede publicar el suyo. Aceptaciones en `privacy_acceptances(patient_id, notice_version_id, origen, ip_hash, created_at)`. El texto aceptado nunca se edita: se publica una versión nueva. Ruta pública `/aviso-de-privacidad/[version]` renderiza el markdown. Migración `0046_privacy_notice_versions.sql`.

Los textos con marcadores pendientes en `docs/legal/terminos-y-condiciones.md` requieren decisión humana antes de publicar cualquier versión.

---

## 4. Escala y confiabilidad

**Carga estimada del piloto.** Cinco clínicas con 30 citas diarias generan 150 citas y hasta 450 mensajes por día. PostgreSQL con `SKIP LOCKED` y un worker cada 15 segundos sobra por dos órdenes de magnitud. No se introduce cola externa.

**Redundancia.** Dos réplicas del worker son seguras por `FOR UPDATE SKIP LOCKED`; la única regla es que ninguna réplica reenvíe locks vencidos (3.B). La API es stateless y se escala horizontalmente.

**Fallo del proveedor.** Un 5xx sostenido acumula `failed` con backoff exponencial hasta 60 minutos y máximo 5 intentos. La alerta de outbox acumulada dispara antes de que los recordatorios de 24 h pierdan vigencia.

**Horario de verano.** Las clínicas mexicanas usan varias zonas IANA y la mayoría del país ya no aplica DST, pero la frontera norte sí. Los cálculos de slots deben hacerse en la zona de la clínica y probarse en `America/Tijuana` y `America/Mexico_City` en las fechas de cambio.

---

## 5. Correcciones al plan de trabajo

| Punto del plan | Ajuste tras revisar el código |
|---|---|
| P0.1 sólo menciona Resend | El reclamo de `processing` vencido también duplica WhatsApp. Se resuelve en 3.B y debe probarse en el sprint 1. |
| P0.1 asume clave de outbox correcta | La clave con `startsAt` pierde recordatorios en A→B→A. Se añade `messaging_version`. |
| P0.2 nombra tres categorías | Se añade `lock_expired` como origen de `uncertain` y se elimina el reintento automático disparado por webhook `undelivered`. |
| P0.3 pide invalidar por vencimiento del token | El token no puede vencer por sí mismo; la caducidad se deriva del estado y fecha de la cita. |
| P0.6 pide nueva migración "si se adopta eventos" | Se adopta el modelo de eventos; es la única forma de conservar evidencia de retiro. |
| P0.7 propone seguir en `messaging.controller.ts` | Las métricas de citas se mueven a un servicio propio que consulta `appointments`; `messaging_events` queda como bitácora. |
| Regla "feature flags por tenant" | No existe el mecanismo; se crea en `0045`. |
| Migraciones esperadas | `0042` idempotencia, `0043` entregas inciertas y webhooks, `0044` consentimientos, `0045` flags, `0046` aviso de privacidad. |

---

## 6. Qué revisar cuando el sistema crezca

- **Outbox en PostgreSQL.** Suficiente hasta decenas de miles de mensajes diarios. Antes de migrar a una cola externa, particionar `outbound_messages` por mes y archivar `sent`/`delivered`.
- **Token determinista.** Simple y sin estado, pero no revocable por cita. Si aparece la necesidad de "enlace de un solo uso" o de revocación puntual, pasar a tokens aleatorios con hash por fila y caducidad propia.
- **At-most-once manual.** Si `uncertain` supera unos pocos casos por semana, añadir consulta de estado al proveedor antes de decidir.
- **Métricas en la misma base.** Correcto para 5 clínicas. Con cientos, materializar agregados diarios por tenant.
- **Single-region.** El piloto corre en una región; el runbook de restauración cubre la pérdida total de la base, no failover automático.

---

## 7. Estado de implementación

**Sprint 1 estabilizado (2026-09-10): P0.1, P0.2, P0.3 y P0.5 implementados.** Migraciones `0042` a `0045` verificadas desde una base vacía; el seed es transaccional, repetible y no genera traslapes. Suite: 468 pruebas, lint y build verdes.

Desviaciones respecto a lo diseñado arriba:

- 3.A: la clave de outbox quedó como `${cita}:v${version}:${kind}[:${horas}h]:${canal}`.
- 3.B: la clasificación de códigos de Twilio vive en dos sitios por necesidad: `providers.ts` para respuestas HTTP y `apply_messaging_webhook()` para webhooks. Ambas listas están comentadas y probadas; si se amplía una hay que revisar la otra.
- 3.B: el worker ahora manda `StatusCallback` desde `env.twilioStatusCallbackUrl`, la misma variable con la que se valida la firma. La invariante quedó resuelta por construcción en lugar de por prueba de arranque.
- 3.C: la caducidad del enlace se apoya en `manage_token_expires_at`, que ya existía. Reprogramar la extiende a la nueva fecha más 24 h.
- 3.E: el consentimiento se registra en `patient_consent_events` desde la reserva pública; el trigger mantiene las columnas derivadas y cancela WhatsApp pendientes al retirar. La captura desde recepción (P0.6) sigue pendiente.
- Defecto previo encontrado y corregido: las inserciones de auditoría con `jsonb_build_object` y parámetros sin tipo fallaban con "could not determine data type"; la reserva pública no podía completarse de punta a punta.

P0.4 y las métricas base de P0.7 quedaron implementadas. Pendiente en P0: P0.6, P0.8 y el desglose avanzado de métricas por canal/tasa.
