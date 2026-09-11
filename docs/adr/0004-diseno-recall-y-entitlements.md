# ADR 0004. Diseño de Entrega 0 (entitlements) y Entrega 1 (Recall)

- Estado: **aprobado** (2026-09-11), con seis correcciones incorporadas
- Fecha: 2026-09-11
- Rama base: `Fase2-Odont` (HEAD `22e2f06`, Fase A ya commiteada)
- Contexto de referencia: `README_CONTINUACION_FASE2_ODONT.md`, `README_MODULOS_DENTALES_PRIORITARIOS.md` §6, `docs/adr/0003-fundaciones-modulos-dentales.md`
- Alcance: qué se construye y cómo, antes de escribir código. No implementa nada.

---

## 1. Verificación del estado real

El plan de continuación describe el repositorio. Se comprobó línea por línea antes de diseñar.

| Afirmación del plan | Realidad verificada |
|---|---|
| Rama `Fase2-Odont` con Fase A commiteada | **Correcto.** HEAD `22e2f06 "modulos de laboratorio"`; el nombre del commit no corresponde a su contenido, pero el contenido sí es Fase A. |
| `0046_fundaciones_dentales.sql` existe y no debe tocarse | **Correcto.** Aplicada y commiteada. `0047` está libre. |
| No existen tablas ni pantallas de recall, periodontograma, laboratorio, etc. | **Correcto.** |
| «Entrega y proveedor viven en `outbound_messages`» | **Falso hoy.** `outbound_messages.appointment_id` es `NOT NULL` y `claim_outbound_messages` hace `JOIN appointments` (inner). Un mensaje de recall no tiene cita: **no cabe en la outbox tal como está**. Ver decisión D1. |
| Los eventos internos ya conectan módulos | **Parcial.** El bus existe y está probado, pero **nadie emite todavía**: `AppEventsService` no se usa fuera de `common/events`. Recall necesita construir también los emisores. Ver D5. |
| El worker puede ejecutar consumidores | **No todavía.** `healthflow_worker` tiene 0 privilegios de tabla (`role_table_grants` vacío). Reclama y cierra por funciones `SECURITY DEFINER`, pero el manejador de un consumidor haría `permission denied` en la primera lectura de negocio. Ver D6. |

Tres hallazgos que el plan no contempla y que son trabajo real: **D1, D5 y D6**.

### Lo que sí se puede reutilizar tal cual

`patients` ya trae `email`, `telefono_normalizado`, `canal_preferido`, `whatsapp_opt_in_at`, `email_suppressed_at` y `archivado_en`. El trigger de `0044` **cancela solos** los mensajes de WhatsApp pendientes cuando el paciente revoca consentimiento. `booking_settings.timezone` da la zona IANA por clínica. `appointments.estatus` ya incluye `no_asistio`. `ESTATUS_PARTIDA` ya incluye `terminado`, y `cambiarEstatusPartida` es el punto exacto donde nace un recall.

---

## 2. Requisitos

### Funcionales

1. Una acción clínica (partida terminada) genera **exactamente un** recall siguiente.
2. Recepción trabaja una lista real de pacientes por recuperar, filtrable y accionable.
3. El contacto respeta canal autorizado, consentimiento y supresión.
4. Una reserva compatible cierra el recall sin intervención humana.
5. La clínica mide pacientes y citas recuperados (no mensajes enviados).
6. Ninguna clínica puede usar un módulo que no contrató.

### No funcionales

| Dimensión | Objetivo |
|---|---|
| Escala | 3–5 clínicas piloto. Una clínica con 2 000 pacientes activos e intervalo de 6 meses produce ~330 recalls/mes ≈ **11/día**. El volumen es irrelevante para el diseño. |
| Latencia | Worklist p95 < 500 ms con 5 000 recalls históricos. El envío tolera minutos. |
| Corrección | Cero recalls duplicados, cero mensajes duplicados, cero fugas entre tenants. |
| Privacidad | Ningún mensaje, evento o log con diagnóstico, tratamiento, pieza o importe. |
| Costo | Sin infraestructura nueva. Sin Twilio obligatorio. |

Consecuencia directa del volumen: **nada de vistas materializadas, colas externas ni tablas de hechos.** SQL directo con índices.

### Restricciones heredadas

- RLS deny-by-default con `current_tenant_id()`; `0001_rls` concede `ALL` al rol de la app, así que toda tabla append-only necesita `REVOKE` explícito.
- Dos roles: `healthflow_app` y `healthflow_worker` (este último, hoy sin permisos de tabla).
- Un guard de Nest **no puede** leer el tenant: corre antes de `RequestContextInterceptor`.
- Pasar `NULL` explícito no dispara el `DEFAULT` de una columna `NOT NULL`.

---

## 3. Diseño de alto nivel

```text
                      ┌──────────────── API (healthflow_app) ────────────────┐
  PATCH partida       │                                                       │
  terminada ─────────▶│ PresupuestosUseCases ──emite──▶ app_events            │
                      │                                  (misma transacción)  │
  POST /appointments  │ AppointmentUseCases ───emite──▶ app_events            │
  cancel / no-show    │                                                       │
                      │ RecallsController ──▶ RecallUseCases ──▶ patient_recalls
                      └───────────────────────────────────────────────────────┘
                                            │
                        claim_app_events(consumidor, n)   ← SECURITY DEFINER
                                            ▼
                      ┌──────────── Worker (healthflow_worker) ──────────────┐
                      │ AppEventsDispatcher                                   │
                      │   ├─ recalls.generar      (treatment_item.completed)  │
                      │   ├─ recalls.vincular     (appointment.scheduled)     │
                      │   ├─ recalls.reabrir      (appointment.cancelled)     │
                      │   └─ recalls.reactivar    (appointment.no_show)       │
                      │                                                       │
                      │ RecallSweeper   pending→due  (barrido por fecha)      │
                      │ RecallDispatcher  due→intento→outbound_messages       │
                      │ MessagingWorker   outbound_messages → Resend / fake   │
                      └───────────────────────────────────────────────────────┘
```

Flujo de datos completo, de punta a punta:

```text
1. partida → 'terminado'        ⇒ evento treatment_item.completed  (misma tx)
2. consumidor recalls.generar   ⇒ patient_recalls(status='pending', due_date)
3. barrido diario               ⇒ status='due'  (idempotente por WHERE)
4. RecallDispatcher             ⇒ recall_attempts + outbound_messages
                                   · sin canal digital ⇒ intento 'phone' (tarea manual)
5. MessagingWorker              ⇒ entrega, con la idempotencia que ya existe
6. paciente reserva             ⇒ evento appointment.scheduled
7. consumidor recalls.vincular  ⇒ status='scheduled', appointment_id
8. cita finalizada              ⇒ status='completed' + nuevo ciclo
```

---

## 4. Entrega 0 — Capacidad efectiva

### D2. Los entitlements **no** tendrán endpoint HTTP en esta entrega

El plan pide que los escriba «facturación u operación interna autorizada». HealthFlow **no tiene consola interna ni autenticación de back-office**: construirla es un proyecto aparte. Y la forma más barata de garantizar que el administrador de una clínica no se conceda módulos es que **no exista ninguna ruta que los conceda**.

Diseño:

- **Fuente por omisión: mapa versionado `plan → módulos` en `shared-types`.** Es donde ya vive `LIMITES_PLAN`, y es lo que la página de precios promete. Cambiarlo es un despliegue, que es exactamente la cadencia de un cambio de catálogo comercial.
- **Tabla `tenant_module_entitlements` sólo para excepciones**: add-ons, pruebas y acuerdos comerciales. La escribe un script `pnpm db:grant-module` que corre como rol admin. Sin controller, sin DTO, sin CASL.
- `healthflow_app` recibe **sólo `SELECT`**. Un `INSERT` desde la API es `permission denied` a nivel de PostgreSQL, no a nivel de código. Es la misma clase de barrera que el `REVOKE` de `consentimientos`.

Alternativa descartada: tabla + endpoint protegido por un rol `superadmin`. Añade un rol nuevo al sistema de auth, y la protección pasa a depender de que ese rol nunca se asigne por error. Más superficie, menos garantía.

### D3. Una sola función de dominio decide

**Leer y escribir no son la misma pregunta**, así que la función no devuelve un booleano:

```ts
type ModoAcceso = 'lectura' | 'escritura';

type Capacidad =
  | { acceso: 'completo' }
  | { acceso: 'solo_lectura'; razon: RazonNoDisponible }   // sólo la suscripción llega aquí
  | { acceso: 'ninguno'; razon: RazonNoDisponible };

function capacidadEfectiva(entrada: EntradaCapacidad, ahora: Date): Capacidad;
function permite(capacidad: Capacidad, modo: ModoAcceso): boolean;
```

Un módulo sin contratar, en rollback o sin activar **desaparece entero**: no hay nada que consultar. Pero una clínica que se atrasó en el pago **conserva la lectura y pierde la escritura** — la misma decisión que ya gobierna el expediente clínico, y por el mismo motivo. Un booleano único obligaría a cada punto de aplicación a reponer esa distinción por su cuenta, que es justo lo que esta función existe para evitar.

De ahí sale también el orden: **la suscripción se evalúa al final**. Si fuera antes, a quien no contrató el módulo le diríamos "regulariza tu pago" por algo que de todos modos no compró.

El status HTTP se deriva de la razón, no del punto que la detecta: `suscripcion` → **402** (el módulo existe, falta pagar), el resto → **404**. Un solo error, `ModuloNoDisponibleError`, con el status calculado en su constructor.

Pura, sin Nest ni SQL, probada como tabla de verdad. **Tres consumidores obligatorios**, y ninguno reimplementa la regla:

1. `CapacidadInterceptor` — rutas HTTP. Deduce el modo del método (GET/HEAD/OPTIONS = lectura), igual que `SuscripcionInterceptor`.
2. `RecallUseCases` — `asegurar(tx, 'dental_recalls', modo)` al inicio de cada caso de uso, porque el worker no pasa por interceptores. El `modo` es **obligatorio**: obliga a cada caso de uso a declarar si lee o escribe.
3. `AppEventsDispatcher` — evalúa siempre en modo `'escritura'`, porque un consumidor existe para producir un efecto; si no se permite, **aplaza** el evento (no lo cierra ni lo falla).

### Reconciliación: lo que pasó mientras el módulo estaba apagado

Cerrar el evento como procesado perdería los automatismos del periodo apagado: si una clínica apaga el módulo un martes y lo enciende el jueves, las partidas terminadas en medio nunca habrían generado su recall. Dejarlo fallar tampoco sirve — el backoff `3^n` de Fase A lo mataría en unas dos horas.

Se agrega un estado **`deferred`** a `app_event_consumptions` y una función `defer_app_event(event_id, consumer, motivo, reintentar_en)`:

- no consume presupuesto de reintentos (`attempts` no crece; se lleva un contador `deferrals` aparte), porque no es un fallo;
- `claim_app_events` recoge los aplazados cuyo `next_attempt_at` ya pasó, así que **encender el módulo reconcilia solo** en la siguiente vuelta del worker;
- ventana de reconciliación de **90 días** desde `occurred_at`: pasado ese plazo el consumo pasa a `dead` con código `reconciliation_window_expired`. Un recall de una limpieza de hace cuatro meses ya no es accionable, y sin tope la cola crece sin límite;
- reintento diario, no por minuto: nadie enciende un módulo y espera que reaccione en segundos a algo de la semana pasada.

Consecuencia para el dominio: **un consumidor debe ser idempotente respecto al tiempo, no sólo a la repetición.** `recalls.generar` calcula `due_date` desde la fecha del evento (`occurred_at`), no desde `now()`; si no, un recall reconciliado tres días tarde vencería tres días tarde. Y si al reconciliar el `due_date` ya pasó, el recall nace directamente en `due`.

Requiere una migración que altere el `CHECK` de `app_event_consumptions` y reemplace `claim_app_events`. **No es modificar `0046`**: es una migración nueva sobre las tablas que `0046` creó. El archivo `0046` no se toca.

### Separación de responsabilidades sobre `tenant_feature_flags`

Hoy `PUT /modulos` mezcla rollout y configuración. Se separan:

| Columna / tabla | Quién escribe | Semántica |
|---|---|---|
| mapa `plan → módulos` + `tenant_module_entitlements` | HealthFlow (script admin) | contratado |
| `tenant_feature_flags.rollout_habilitado` | HealthFlow (script admin) | piloto y rollback |
| `tenant_feature_flags.habilitado` (ya existe) | titular de la clínica vía `PUT /modulos` | quiere usarlo |

`GET /modulos` devuelve los cuatro booleanos por módulo más `disponible` y, cuando es `false`, la `razon`. La UI muestra «no incluido en tu plan» y «disponible próximamente» como estados distintos, que es la diferencia entre una venta y una queja.

Migración: **`0047_module_entitlements.sql`**. Recall se recorre a `0048`.

---

## 5. Entrega 1 — Recall

### D1. Mensajería: se extiende la outbox existente, no se duplica

Éste es el punto más caro del diseño y el que el plan da por resuelto.

**El problema.** `outbound_messages.appointment_id` es `NOT NULL` con FK a `appointments`; `kind` tiene `CHECK IN ('confirmation','reminder','rescheduled','cancelled')`; `claim_outbound_messages` hace `JOIN appointments a ON a.id = c.appointment_id` (inner) y devuelve `a.inicio_programado`; y `ProviderMessage` exige `startsAt` y `manageUrl`. Un recall no tiene cita ni hora de inicio.

| Opción | A favor | En contra |
|---|---|---|
| **A. Extender `outbound_messages`** (recomendada) | Hereda supresión de correo, el trigger de `0044` que cancela WhatsApp al revocar consentimiento, reintentos, webhooks de estado, métricas y el `idempotency_key` único | Toca `claim_outbound_messages`, que es código de producción estabilizado a lo largo de `0035`→`0045` |
| B. Tabla `recall_outbound_messages` propia | No toca nada existente | **Duplica la aplicación del consentimiento.** Habría que reimplementar supresión, opt-out y webhooks; el primer bug de privacidad viviría ahí |
| C. Sin envío automático: sólo tareas manuales | Cero riesgo | No cumple el objetivo; el valor del módulo es que recepción no persiga a mano |

Se elige **A**, con una migración estrictamente aditiva — y **después** de que exista el esquema de Recall, porque la nueva columna referencia `recall_attempts`. Intentar la outbox primero, como proponía la versión anterior de este ADR, fallaría: no hay tabla a la que apuntar. El orden correcto es esquema de Recall → outbox polimórfica.

```sql
ALTER TABLE outbound_messages ALTER COLUMN appointment_id DROP NOT NULL;
ALTER TABLE outbound_messages ADD COLUMN recall_attempt_id uuid REFERENCES recall_attempts(id) ON DELETE CASCADE;
-- Una sola dirección: `recall_attempts` NO lleva `outbound_message_id`.
ALTER TABLE outbound_messages DROP CONSTRAINT outbound_messages_kind_check;
ALTER TABLE outbound_messages ADD CONSTRAINT outbound_messages_kind_check
  CHECK (kind IN ('confirmation','reminder','rescheduled','cancelled','recall'));
-- Exactamente un sujeto: o cita, o intento de recall. Nunca ambos, nunca ninguno.
ALTER TABLE outbound_messages ADD CONSTRAINT outbound_messages_sujeto_check
  CHECK (num_nonnulls(appointment_id, recall_attempt_id) = 1);
```

y `claim_outbound_messages` pasa a `LEFT JOIN appointments`, devolviendo `starts_at` nullable. `ProviderMessage` se convierte en unión discriminada por `kind`, de modo que **el compilador obliga** a cada adaptador a tratar el caso `recall` (sin `startsAt`, con `bookingUrl` en vez de `manageUrl`).

**La referencia va en una sola dirección.** El plan original (§8) pedía además `recall_attempts.outbound_message_id`, lo que crearía una relación circular entre las dos tablas: dos fuentes de verdad para el mismo vínculo, que pueden discrepar, y un orden de borrado imposible de razonar. Se conserva **únicamente `outbound_messages.recall_attempt_id`**; el intento consulta sus envíos con un `JOIN`, que es lo que una relación uno-a-muchos significa.

Red de seguridad: las tres suites de integración de mensajería (`mensajeria-idempotencia`, `mensajeria-webhooks`, `mensajeria-metricas`) **se conservan sin un solo cambio** y deben seguir verdes. Las rutas de recall se cubren con una suite nueva (`mensajeria-recall.integration.spec.ts`): sujeto polimórfico, `CHECK` de sujeto único, reclamo de un mensaje sin cita, y que revocar el consentimiento cancele también los mensajes de recall. Si para que pase el verde hubiera que editar las suites viejas, el cambio dejó de ser aditivo y el diseño está mal.

**El contenido del mensaje de recall** es la frase mínima: nombre de la clínica, que toca una revisión, y el enlace de reserva. Sin tipo de recall, sin pieza, sin tratamiento, sin importe — «limpieza» ya es información clínica en un canal no cifrado.

### D4. `pending → due` por barrido, no por evento

Un `recall.due` programado a futuro requeriría emitir el evento al crear el recall con `available_at = due_date`, y cambiar el intervalo dejaría eventos huérfanos apuntando a fechas viejas. Un barrido `UPDATE … WHERE status='pending' AND due_date <= (now() AT TIME ZONE tz)::date` es naturalmente idempotente, respeta un cambio de periodicidad y no deja basura. El evento `recall.due` se emite **como consecuencia** del barrido, para quien quiera reaccionar.

### D5. Los emisores son parte de esta entrega

Fase A dejó el bus sin productores. Recall necesita instrumentar tres casos de uso existentes, **dentro de su transacción actual**:

| Caso de uso | Evento | Payload mínimo |
|---|---|---|
| `PresupuestosUseCases.cambiarEstatusPartida` → `'terminado'` | `treatment_item.completed` | `presupuestoId`, `partidaId`, `patientId`, `doctorId`, `appointmentId` |
| `ScheduleAppointmentUseCase` | `appointment.scheduled` | `appointmentId`, `patientId`, `doctorId`, `serviceId`, `inicioProgramado` |
| `CancelAppointmentUseCase` | `appointment.cancelled` | `appointmentId`, `patientId` |
| marcar `no_asistio` (nuevo, ver D7) | `appointment.no_show` | `appointmentId`, `patientId` |
| `BookingService.createPublicAppointment` | `appointment.scheduled` | igual que el interno, con `origen: 'publico'` |
| `BookingService.cancel` | `appointment.cancelled` | `appointmentId`, `patientId` |
| `BookingService.reschedule` y la reprogramación interna | `appointment.rescheduled` | `appointmentId`, `patientId`, `doctorId`, `inicioAnterior`, `inicioNuevo` |

**Las citas públicas son el camino que cierra el ciclo.** El paciente que recibe un recall reserva por `/reservar/{slug}`, no por recepción: si `PublicBookingService` no emite, el recall nunca pasa a `scheduled` y la métrica de conversión queda en cero justo en el caso que el módulo existe para medir. `BookingService` no usa casos de uso ni repositorios (es un servicio plano con SQL crudo), así que la emisión va dentro de su `withToken`/transacción, igual que el resto de su escritura.

**Sobre `reschedule`: un solo evento, no un par.** La versión anterior de este ADR proponía emitir `appointment.cancelled` + `appointment.scheduled` con el mismo `appointmentId` y dejar que cada consumidor dedujera que hubo reemplazo. Eso obliga a cada consumidor a correlacionar dos eventos dentro de una ventana temporal, y basta con que uno escuche sólo `appointment.cancelled` para que reabra un seguimiento que nunca debió reabrirse — con la cita nueva ya en la agenda. Un `appointment.rescheduled` hace la intención explícita y nadie tiene que adivinar. Es el caso de aceptación «una cita de reemplazo evita reactivar contacto», resuelto en el contrato en vez de en cada consumidor.

`asegurarPayloadDeEvento` ya prohíbe nombre, teléfono, correo y texto clínico: estos payloads pasan porque son sólo UUIDs y una fecha ISO.

### D6. El worker necesita permisos de tabla

`healthflow_worker` tiene cero `GRANT` de tabla. La migración de Recall debe incluir:

```sql
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='healthflow_worker') THEN
  GRANT SELECT, INSERT, UPDATE ON patient_recalls, recall_attempts TO healthflow_worker;
  GRANT SELECT ON recall_types, patients, appointments, tenant_feature_flags TO healthflow_worker;
END IF; END $$;
```

RLS sigue aplicando: el rol no es `BYPASSRLS` y `runInTenant` fija el tenant del evento. Sin esto, el dispatcher de Fase A falla en el primer consumidor real — un fallo que hoy nadie detecta porque no hay consumidores.

### D7. `agendada → no_asistio` sólo después de una tolerancia

No existe hoy caso de uso que marque `no_asistio`: el estado sólo aparece en el `CHECK` de `0000_init` y en los seeds. Se construye, porque el no-show es la fuente de reactivación más rentable.

La regla que lo hace seguro: **la transición sólo se admite cuando ya pasó `fin_programado + tolerancia`** (30 minutos por omisión, configurable por clínica más adelante). Sin eso, un dedazo en la sala de espera marca como ausente a un paciente que va llegando, y ese error dispara un evento `appointment.no_show` que crea un recall de reactivación — una cadena automática nacida de un clic equivocado, que además le manda un mensaje al paciente que sí está en la sala.

- Transición válida sólo desde `agendada` y `en_espera`. Desde `en_consulta` o `finalizada` no tiene sentido; desde `cancelada` tampoco.
- El reloj lo recibe el dominio como parámetro (`ahora: Date`), nunca lo consulta: es lo que hace la regla comprobable sin esperar 30 minutos.
- La tolerancia se evalúa en la zona de la clínica (`booking_settings.timezone`).
- Permiso: `checkin` sobre `Appointment` — quien gestiona llegadas es quien constata la ausencia; ya lo tienen recepción y médico.
- Error de dominio propio (`AusenciaPrematuraError`, 409) con el instante a partir del cual sí se puede: el frontend deshabilita el botón y explica por qué, en vez de dejar que el usuario adivine.

### Modelo de datos

Migración **`0048_dental_recalls.sql`** (o `0047` si Entrega 0 se pospone), más su compensatoria en `migrations/rollback/`.

Lo que no es evidente del esquema del plan:

**`patient_recalls`** — el índice que sostiene «no hay dos recalls vivos equivalentes»:

```sql
CREATE UNIQUE INDEX patient_recalls_vivo_idx
  ON patient_recalls (tenant_id, patient_id, recall_type_id)
  WHERE status IN ('pending','due','contacted','scheduled');
```

Es la **segunda** capa de idempotencia. La primera es `app_event_consumptions(event_id, consumer)`: reprocesar el mismo evento no vuelve a entrar. El índice cubre el otro caso, que el plan no distingue: **dos eventos distintos** (dos limpiezas terminadas el mismo día) que pedirían el mismo recall.

`due_date` es `date`, no `timestamptz`: «vence en marzo» es un concepto local de la clínica. La conversión usa `booking_settings.timezone`, igual que `0038` para el worker.

**`recall_attempts`** — sin `outbound_message_id` (ver D1: la referencia vive sólo en la outbox). Un intento de canal `phone` o `manual` **no** crea fila en `outbound_messages`: es una tarea que recepción cierra a mano desde la worklist. Es lo que hace que el módulo funcione sin Twilio y sin dominio de correo verificado.

Unicidad de intento por ventana: `UNIQUE (tenant_id, patient_recall_id, attempt_number)` más una clave de idempotencia derivada `recall:{recallId}:a{n}:{channel}` en `outbound_messages.idempotency_key`, que ya es `UNIQUE`. Dos workers no pueden crear el mismo envío aunque ambos reclamen.

### API y permisos

Las rutas son las del plan. Lo que fija este diseño:

- `@RequiereFlag('dental_recalls')` a nivel de **clase**, más `asegurarCapacidad` en cada caso de uso.
- CASL ya tiene los permisos de Fase A y están probados: `contactar` para recepción, `write` sólo para médico/titular. No hace falta tocar la matriz.
- `GET /recalls` pagina con cursor por `(due_date, id)`. Orden inestable en una worklist con acciones masivas es una fuente de errores de operación, no de estética.
- Las acciones masivas reciben **la lista explícita de ids**, nunca «todo lo que coincide con el filtro»: el conjunto puede haber cambiado entre que recepción lo vio y lo confirmó.

### Métricas

Tres denominadores distintos, etiquetados en la UI:

| Métrica | Cuenta | Definición |
|---|---|---|
| Vencidos | recalls | `status='due'` al cierre del periodo |
| Contactados | recalls únicos | recalls con ≥1 intento en el periodo — **no** intentos |
| Convertidos | recalls | `status` pasó a `scheduled` dentro de los 30 días del primer contacto |
| Recuperados | pacientes únicos | pacientes con cita **finalizada** originada en un recall |

«Ingreso recuperado» **se deja fuera del MVP**: atribuir dinero a un recall exige decidir si cuenta lo presupuestado, lo terminado o lo cobrado, y con qué ventana. Es una definición de negocio, no un query, y una cifra mal definida en la primera demo es peor que no tenerla. Entra con Entrega 8, donde §13.3 obliga a documentar cada KPI.

---

## 6. Escala y confiabilidad

- **Carga real:** ~11 recalls/día por clínica. El cuello de botella no es el volumen sino la corrección.
- **Concurrencia:** dos workers se excluyen con el `ON CONFLICT` de `app_event_consumptions` (ya probado) y con el `UNIQUE` de `idempotency_key`. El barrido `pending→due` es un `UPDATE` idempotente; no necesita lock.
- **Fallos:** transitorios reintentan con el backoff `3^n` de Fase A y mueren a los 8 intentos. Un `permanent` del proveedor (correo inválido) cierra el intento y **degrada el recall a tarea manual** en vez de reintentar.
- **Observabilidad mínima antes del piloto:** consumiciones en `dead`, `outbound_messages` en `uncertain`, recalls `due` con más de N días sin intento, y recalls `exhausted` por semana. Sin esto, un consumidor roto es invisible.
- **Rollback:** apagar `dental_recalls` corta API y worker; los datos quedan. La compensatoria borra tablas — sólo para un entorno donde el módulo nunca se usó.

---

## 7. Lo que revisaría al crecer

| Cuándo | Qué |
|---|---|
| >50 clínicas | El barrido secuencial por tenant deja de escalar; particionar por tenant o mover a un cron por clínica. |
| Cuando entre WhatsApp | Plantillas aprobadas por Meta: el contenido deja de ser libre y la ventana de 24 h cambia la lógica de reintento. |
| Cuando existan Entregas 2 y 7 | «Ingreso recuperado» se vuelve calculable; ahí entra la atribución. |
| Si las métricas tardan | Recién entonces, tabla de hechos incremental. No antes: §13.5 lo dice y el volumen lo confirma. |

---

## 8. Plan de entrega

| # | Commit | Contenido | Verde cuando |
|---|---|---|---|
| 1 ✅ | entitlements y capacidad efectiva | `0047`: `tenant_module_entitlements`, `rollout_habilitado`, estado `deferred` y `defer_app_event`; mapa plan→módulos; `capacidadEfectiva` pura; `GET /modulos` con 4 ejes; script de concesión | Un `INSERT` de entitlement desde la API es `permission denied`; un evento aplazado se reclama solo al encender el módulo |
| 2 ✅ | esquema y dominio de Recall | `0048`: `recall_types`, `patient_recalls`, `recall_attempts`, grants del worker; entidad `PatientRecall` con su máquina de estados pura | Transiciones inválidas rechazadas en dominio; RLS con dos tenants |
| 3 | outbox polimórfica | `0049`: `appointment_id` nullable, `recall_attempt_id`, `CHECK` de sujeto único, `kind='recall'`; `claim_outbound_messages` con `LEFT JOIN`; `ProviderMessage` como unión discriminada | Las 3 suites de mensajería siguen verdes **sin una sola edición**, y la suite nueva de recall pasa |
| 4 | repositorio y casos de uso | 10 casos de uso, transacciones, auditoría | Cobertura de dominio y de integración por caso de uso |
| 5 | emisores, no-show y consumidores | `MarcarNoAsistioUseCase` con tolerancia; emisión en presupuestos, citas internas y `PublicBookingService`; 4 consumidores | Dos workers, un solo recall; una cita pública cierra el recall |
| 6 | API y contratos | Rutas, DTOs, paginación por cursor, `shared-types` sin `any` | Matriz CASL probada |
| 7 | frontend | `/recalls`, `/ajustes/recalls`, panel en expediente, botón de ausencia con tolerancia | Estados vacío/carga/error/módulo no disponible |
| 8 | E2E, métricas y reconciliación | Partida terminada → recall → contacto → reserva pública → cierre; reconciliación tras encender el módulo | Las métricas cuadran con las entidades del E2E |

**El orden cambió respecto a la primera versión de este ADR.** La outbox polimórfica ya no va segunda: su columna nueva referencia `recall_attempts`, así que el esquema de Recall tiene que existir antes. Sigue yendo en un commit propio —es el único que toca código de mensajería en producción— pero ahora en tercer lugar.

---

## 9. Lo que apareció al implementar el commit 1

Dos suposiciones del diseño resultaron falsas contra PostgreSQL real. Quedan aquí porque las dos son trampas que reaparecerán en las migraciones siguientes.

**Un `REVOKE` por columna no recorta un `GRANT` de tabla.** `REVOKE UPDATE (rollout_habilitado) ON tenant_feature_flags FROM healthflow_app` se ejecuta sin error y no protege nada: `0001_rls` ya había concedido `UPDATE` sobre la tabla entera, y un permiso de tabla autoriza cualquier columna. Hay que quitar el permiso de tabla y volver a concederlo columna por columna:

```sql
REVOKE UPDATE, INSERT ON tenant_feature_flags FROM healthflow_app;
GRANT UPDATE (habilitado, habilitado_at, habilitado_por, notas, updated_at) ON … TO healthflow_app;
```

Lo detectó la prueba «la API tampoco puede levantar un rollback de operación», que sin ella habría pasado por buena una barrera inexistente.

**`DELETE` seguía concedido sobre `tenant_feature_flags`.** Se revocaron `INSERT` y `UPDATE` y se volvieron a conceder por columna, pero `DELETE` quedó vivo desde el `GRANT` de `0046`. Borrar la fila era la puerta trasera a todo lo anterior: se lleva por delante el interruptor de rollback —la fila vuelve a nacer con `rollout_habilitado = true`— y el "activo desde". Lección: al recortar permisos hay que enumerar los cuatro verbos, no los que parecen peligrosos.

**`Promise.all` sobre una transacción.** Las lecturas de capacidad se lanzaban en paralelo sobre el mismo `tx`. Una transacción es UNA conexión y node-postgres no multiplexa: dos consultas en vuelo se pisan. Se volvieron secuenciales y, de paso, plan y estado de cobro se leen en una sola consulta porque salen de la misma fila de `tenants`.

**La vista calculaba «contratado» con un predicado propio.** `contratado: entitlement !== null` mostraba como contratado un derecho `suspended` que la capacidad efectiva ya estaba negando: la pantalla decía una cosa y la API otra. Se exportó `tieneDerechoVigente` y ahora la vista y la decisión usan **la misma función**. Regla para lo que viene: si un campo de la respuesta responde a la misma pregunta que una regla de dominio, tiene que salir de esa regla, no de una reimplementación al lado.

---

## 10. Riesgos abiertos

1. **Tocar `claim_outbound_messages`** afecta la entrega de mensajes de citas en producción. Mitigación: cambio aditivo, commit aislado, y las suites existentes intactas como criterio de aceptación — si hay que editarlas, se revierte.
2. **El caso de uso de no-show es nuevo** y su regla de tolerancia (D7) hay que validarla con recepción: 30 minutos es una suposición, no un dato. Si la clínica cierra citas mucho después, la lista de «ausentes» se llenará tarde.
3. **Sin dominio de correo verificado** (pendiente de `README_VERSION_VENDIBLE.md`), el piloto de Recall funciona sólo con tareas manuales. No bloquea el desarrollo; sí bloquea medir conversión.
4. **Apagar un flag pierde automatismos** del periodo apagado, no datos. Debe estar en la documentación de soporte antes del piloto.
5. **El commit `22e2f06` se llama «modulos de laboratorio»** y contiene la Fase A. Conviene aclararlo en el historial antes de que alguien lo busque por nombre.
