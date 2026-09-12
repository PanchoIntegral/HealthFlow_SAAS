# HealthFlow — Plan de ejecución para la siguiente etapa competitiva

> Documento operativo para una IA o equipo de ingeniería.
>
> Baseline original: `main` en `5195d8c` (`0049_outbox_polimorfica.sql`).
> Baseline actual: `main` en `967ed26` (`0050_recall_automation.sql`), con los commits 4 y
> su hardening ya aplicados.
> Fecha de revisión: 2026-09-12.
>
> Este documento reemplaza el orden de ejecución futuro de los README anteriores cuando
> exista una contradicción. Los ADR existentes siguen siendo la autoridad sobre decisiones
> ya tomadas.

## 1. Objetivo de producto

La siguiente versión debe poder venderse con una promesa concreta para clínicas dentales:

> **HealthFlow ayuda a llenar la agenda, recuperar pacientes, convertir tratamientos y
> cambiarse desde otro sistema sin perder información.**

No se intentará copiar de inmediato cada función de Huli o Doctoralia. El orden prioriza:

1. cerrar los flujos que ya se empezaron;
2. producir resultados económicos visibles para la clínica;
3. reducir la fricción de migración desde un competidor;
4. completar después la profundidad clínica y operativa.

La métrica norte de esta etapa es **citas atendidas generadas o recuperadas por HealthFlow**.
Las métricas secundarias son conversión de presupuestos, ocupación de espacios cancelados,
tiempo de incorporación y retención de clínicas piloto.

---

## 2. Estado real verificado

### 2.1 Implementado

- Pacientes, agenda, sala de espera y expediente.
- Reserva pública con disponibilidad, confirmación, cancelación y reprogramación.
- Mensajería transaccional, outbox, worker, webhooks, reintentos e idempotencia.
- Odontograma, notas clínicas, recetas, radiografías y consentimientos.
- Presupuestos, partidas, abonos, caja y facturación.
- Roles/CASL, RLS, auditoría, suscripciones, feature flags y entitlements.
- Bus interno persistente de eventos y reconciliación de eventos aplazados.
- Recall: esquema `0048`, dominio puro, outbox polimórfica `0049`, y —desde el commit 4—
  configuración de automatización `0050`, repositorio, casos de uso y auditoría de sistema.

### 2.2 Empezado pero no utilizable por una clínica

Recall **ya tiene** (commits 4 y siguientes de hardening):

- relación explícita partida→tipo de control y configuración de reactivación por no-show;
- `AuditService.recordSystem()` para el worker y la reserva pública, sin contexto HTTP;
- puerto `RecallRepository` y adaptador Drizzle;
- quince casos de uso, con capacidad efectiva por modo y reloj inyectado;
- barrido `pending → due` (`ProcessDueRecallsUseCase`), pendiente de invocar desde el worker;
- las dos barreras de contacto: una gestión sin entregar bloquea siempre, y entregada la
  anterior manda el espaciado del tipo.

Recall **todavía no tiene**:

- productores de eventos conectados (nadie emite: el bus sigue sin fuentes reales);
- consumidores registrados;
- `MarcarNoAsistioUseCase`;
- API;
- frontend;
- invocación del barrido desde el worker;
- fechas inmutables de transición, sin las cuales las métricas de conversión no se publican;
- actualización de `recall_attempts` desde el webhook del proveedor (ADR 0004 §D8);
- E2E del ciclo clínico.

### 2.3 No implementado aunque existan nombres, flags o permisos

- Lista de espera inteligente.
- Importador/migración asistida.
- Presupuestos públicos con aceptación y firma.
- Portal general del paciente y formularios previos.
- Periodontograma.
- Laboratorio dental general.
- Inventario dental con lotes y movimientos.
- Anticipos en línea de pacientes.
- Reputación/reseñas e integración de captación.

`dental_labs` y `dental_inventory` existen como feature flags y subjects CASL, pero no hay
módulos Nest, tablas de negocio, APIs ni pantallas. El módulo `plantillas` es una orden
especializada; no sustituye la gestión general de laboratorio dental.

---

## 3. Orden obligatorio

```text
R1  Terminar Recall
      ↓
R2  Lista de espera + importador
      ↓
R3  Presupuesto compartible + anticipo
      ↓
R4  Portal/formularios + reputación
      ↓
R5  Periodontograma
      ↓
R6  Laboratorios + inventario
```

No comenzar R2 hasta que el flujo E2E de Recall esté verde. No comenzar pagos reales hasta
que el presupuesto público tenga snapshot inmutable y aceptación idempotente.

---

# R1 — Terminar Recall y reactivación

## 4. Resultado esperado

Recepción debe poder ver pacientes por contactar, enviar o registrar una gestión, y observar
cómo una nueva cita cierra el seguimiento automáticamente. El flujo debe funcionar con
correo o tareas telefónicas aunque Twilio aún no esté configurado.

## 5. Commit 4 — Configuración de automatización, repositorio y casos de uso

### 5.1 Corregir dos huecos del modelo

Crear `0050_recall_automation.sql` y su compensatoria.

Agregar:

```sql
ALTER TABLE presupuesto_partidas
  ADD COLUMN recall_type_id uuid REFERENCES recall_types(id) ON DELETE SET NULL;

CREATE TABLE recall_settings (
  tenant_id uuid PRIMARY KEY DEFAULT current_tenant_id()
    REFERENCES tenants(id) ON DELETE CASCADE,
  no_show_recall_type_id uuid REFERENCES recall_types(id) ON DELETE SET NULL,
  no_show_delay_days int NOT NULL DEFAULT 1 CHECK (no_show_delay_days BETWEEN 0 AND 30),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Reglas:

- Terminar una partida sólo genera Recall si esa partida tiene `recall_type_id`.
- Nunca inferir el tipo desde `descripcion`.
- Un no-show sólo genera reactivación si `recall_settings.no_show_recall_type_id` está
  configurado y activo.
- El vencimiento del no-show es la fecha local del evento más `no_show_delay_days`; no usa
  `interval_months`.
- Triggers `SECURITY DEFINER` deben comprobar que partida, tipo y configuración pertenecen
  al mismo tenant.
- RLS forzado, grants mínimos y pruebas con dos tenants.

Actualizar `NuevaPartida`, `PresupuestoPartida`, repositorio de presupuestos y UI para poder
seleccionar opcionalmente el tipo de control. La edición de un presupuesto histórico no debe
modificar recalls ya creados.

### 5.2 Auditoría ejecutada por worker

`AuditService.record()` depende de `RequestContextService` y falla fuera de una petición.
Agregar una vía explícita, no implícita:

```ts
recordSystem(tx, tenantId, entry, source: 'worker' | 'public-booking'): Promise<void>
```

- `user_id = NULL` para actores de sistema.
- El tenant se recibe explícitamente y debe coincidir con `current_tenant_id()`.
- Aplicar `asegurarDetalleAuditable()` también a esta vía.
- No fabricar un usuario técnico ni instalar un contexto HTTP falso en el worker.
- Probar actor autenticado, actor de sistema, tenant incorrecto y detalle sensible.

### 5.3 Puerto `RecallRepository`

Crear:

```text
apps/api/src/modules/recalls/domain/recall.repository.ts
apps/api/src/modules/recalls/infrastructure/recall.drizzle-repo.ts
```

El puerto debe cubrir, sin exponer SQL:

- tipos: listar, buscar, crear y actualizar;
- configuración de automatización;
- cargar un recall `FOR UPDATE`;
- insertar y guardar `PatientRecall`;
- buscar recall vivo compatible por paciente y servicio;
- crear/cerrar/cancelar intentos;
- cancelar mensajes pendientes de intentos anteriores;
- listar worklist con cursor `(due_date, id)`;
- reclamar vencimientos e intentos con concurrencia segura;
- consultar métricas desde entidades origen.

No usar `Promise.all` sobre el mismo `tx`.

### 5.4 Casos de uso

Implementar estos diez casos:

1. `CreateRecallTypeUseCase`.
2. `UpdateRecallTypeUseCase`.
3. `AssignPatientRecallUseCase`.
4. `GenerateRecallFromCompletedTreatmentUseCase`.
5. `ListRecallWorklistUseCase`.
6. `ScheduleRecallAttemptUseCase`.
7. `RecordRecallOutcomeUseCase`.
8. `MatchAppointmentToRecallUseCase`.
9. `DismissRecallUseCase`.
10. `ProcessDueRecallsUseCase`.

Todos deben:

- recibir reloj/fecha cuando la regla dependa del tiempo;
- ejecutar dentro de la transacción recibida o de `TenantDbService.run()`;
- llamar `CapacidadService.asegurar(tx, 'dental_recalls', modo)`;
- auditar dentro de la misma transacción;
- traducir unicidad concurrente a un resultado idempotente o conflicto de dominio;
- no aceptar tenant desde DTO.

### 5.5 Criterio de aceptación del commit 4

> **Estado: hecho** (2026-09-12). Migración `0050_recall_automation.sql` y su compensatoria.
> Evidencia al cierre del hardening: **707 pruebas en verde** — 530 de dominio y 177 de
> integración —, de las cuales 34 de integración en
> `recalls-casos-de-uso.integration.spec.ts` y 22 de dominio en
> `recall-use-cases.domain.spec.ts`. `pnpm lint`, `pnpm build` y `git diff --check` limpios.
>
> | Criterio | Evidencia |
> |---|---|
> | Cada caso de uso tiene pruebas de dominio y PostgreSQL | Las dos suites citadas |
> | Dos altas equivalentes dejan un solo recall vivo | «dos altas equivalentes dejan UN solo control vivo» |
> | Dos contactos simultáneos dejan un solo número de intento | «dos contactos simultáneos dejan un solo número de intento» |
> | Una partida sin tipo no genera nada | «una partida SIN tipo no genera nada» |
> | Una partida con tipo genera exactamente un control | «una partida CON tipo genera exactamente un control, fechado por el hecho» |
> | Un no-show sin configuración no inventa un tipo | «un no-show sin configuración NO inventa un tipo» |
> | Auditoría del worker se persiste sin contexto HTTP | «la auditoría del worker se persiste sin contexto HTTP, con user_id nulo» |
> | RLS bloquea lectura y escritura cruzada | «RLS impide ver o tocar los controles de la otra clínica» |
>
> **Hardening posterior** (`218527e`, `00ef6f8`, `967ed26`):
>
> - Cerrar una gestión exige el vínculo `attemptId`↔`recallId`. RLS acota el
>   tenant, pero dentro de una clínica no distingue un control de otro. Un
>   `UPDATE` que no toca ninguna fila levanta `IntentoNoActualizable` (409) en
>   vez de devolver éxito.
> - El estado admitido al cerrar es **`pending` o `sent`**, no sólo `pending`:
>   el webhook mueve el intento a `sent` al entregar el mensaje (ADR §D8), y es
>   justo entonces cuando el paciente contesta. Con `pending` a secas, las
>   gestiones que sí funcionaban eran las imposibles de cerrar. `closed` y
>   `cancelled` siguen en 409.
> - Declinar cancela de verdad el mensaje que seguía en cola: el orden estaba
>   invertido y el paciente recibía el correo del control que acababa de
>   rechazar.
> - Admitir `sent` abrió un hueco simétrico —la barrera de "gestión en curso"
>   cae al entregar—, así que programar el siguiente contacto exige además
>   `ahora >= next_attempt_at`, con `ContactoDemasiadoPronto` (409) y
>   `allowedAt`. No hacerlo permitía un segundo correo idéntico minutos
>   después: el canal se vuelve a elegir solo y no pasa a teléfono.
>   Llamar antes de tiempo queda como acción explícita separada, sin construir.
>
> **Pendiente declarado:** el selector de tipo de control en la UI de partidas
> (§5.1) NO se implementó. Necesita `GET /recalls/types`, que es del commit 6, y
> §29 prohíbe avanzar al frontend en este commit. Los contratos
> (`NuevaPartida.recallTypeId`), el DTO y el repositorio de presupuestos sí
> quedaron listos para que esa pantalla sólo tenga que consumirlos.


- Cada caso de uso tiene pruebas de dominio y PostgreSQL.
- Dos altas equivalentes dejan un solo recall vivo.
- Dos contactos simultáneos dejan un solo número de intento.
- Una partida sin tipo no genera nada.
- Una partida con tipo genera exactamente un control.
- Un no-show sin configuración no inventa un tipo.
- Auditoría del worker se persiste sin contexto HTTP.
- RLS bloquea lectura y escritura cruzada.

## 6. Commit 5 — Emisores, no-show, finalización y consumidores

### 6.1 Productores de eventos

Inyectar `AppEventsService` y emitir dentro de la misma transacción:

| Productor | Evento | Payload mínimo |
|---|---|---|
| `PresupuestosUseCases.cambiarEstatusPartida` | `treatment_item.completed` | ids de presupuesto, partida, paciente, médico, cita y tipo de recall |
| `ScheduleAppointmentUseCase` | `appointment.scheduled` | ids de cita, paciente, médico y servicio; inicio ISO |
| `CancelAppointmentUseCase` | `appointment.cancelled` | ids de cita y paciente |
| `BookingServiceApp.create` | `appointment.scheduled` | mismo contrato, `origen: publico` |
| `BookingServiceApp.cancel` | `appointment.cancelled` | ids de cita y paciente |
| `BookingServiceApp.reschedule` | `appointment.rescheduled` | cita, paciente, médico, inicio anterior y nuevo |
| `FinishConsultationUseCase` | `appointment.completed` | ids de cita y paciente |
| `MarcarNoAsistioUseCase` | `appointment.no_show` | ids de cita y paciente |

No reutilizar `messaging_events`; son telemetría del proveedor y no el bus de negocio.

La reprogramación actual modifica la misma cita, por lo que debe emitir un solo
`appointment.rescheduled`. El recall conserva su `appointment_id`; no se reabre.

### 6.2 Caso de uso de ausencia

Crear `MarcarNoAsistioUseCase`.

- Transiciones permitidas: `agendada` o `en_espera` → `no_asistio`.
- Sólo después de `fin_programado + 30 minutos`.
- `Appointment` debe conocer `finProgramado` o recibir el umbral explícito; la regla queda en
  dominio y el reloj se inyecta.
- Error `AusenciaPrematuraError` → HTTP 409, incluyendo `allowedAt`.
- Cancela mensajes pendientes de la cita.
- Audita y emite evento atómicamente.
- Notifica la sala de espera sólo después del commit.

### 6.3 Consumidores estables

Registrar con `APP_EVENT_CONSUMER`:

- `recalls.generar.tratamiento.v1` — `treatment_item.completed`.
- `recalls.vincular.cita.v1` — `appointment.scheduled`.
- `recalls.ciclo.cita.v1` — `appointment.cancelled`, `appointment.completed` y
  `appointment.rescheduled`.
- `recalls.reactivar.no_show.v1` — `appointment.no_show`.

No cambiar esos nombres después de desplegar. Todos requieren `dental_recalls` y usan los
casos de uso; no escriben SQL desde el manejador.

Reglas de asociación:

- Asociación automática sólo cuando `appointment.service_id` coincide con
  `recall_types.booking_service_id`.
- Un tipo sin servicio asociado requiere vínculo manual.
- Si hay más de un candidato compatible, elegir por `due_date, id` y registrar la decisión.
- Cancelar reabre únicamente el recall vinculado.
- Reprogramar no cambia su estado.
- Finalizar la cita pasa el recall vinculado a `completed`.

### 6.4 Criterio de aceptación del commit 5

- El bus ya tiene productores reales.
- Reprocesar el mismo evento no duplica efectos.
- Dos eventos diferentes tampoco crean dos recalls vivos equivalentes.
- Una reserva pública compatible marca el recall `scheduled`.
- Reprogramarla conserva el vínculo.
- Cancelarla lo devuelve a `due`.
- Finalizarla cierra el ciclo.
- No-show prematuro falla sin mutar cita, mensajes ni eventos.

## 7. Commit 6 — API y contratos

Agregar tipos a `packages/shared-types` y DTOs validados, sin `any`:

```text
GET    /recalls/types
POST   /recalls/types
PATCH  /recalls/types/:id
GET    /recalls/settings
PUT    /recalls/settings
GET    /recalls?status=&dueFrom=&dueTo=&doctorId=&q=&cursor=&limit=
POST   /recalls
POST   /recalls/:id/contact
POST   /recalls/:id/outcome
POST   /recalls/:id/dismiss
POST   /appointments/:id/no-show
```

`GET /recalls/metrics` **NO va en este commit**. Convertidos, recuperados y agotados se
fechan hoy con `updated_at`, que es mutable, y "vencidos" es backlog y no una cifra del
periodo. El endpoint entra en el commit 8, después de las fechas inmutables de transición.

Seguridad:

- `@RequiereModulo('dental_recalls')` o decorador vigente a nivel de controller.
- CASL: `read`, `write` y `contactar` según matriz existente.
- Cursor opaco firmado o codificado; orden estable `(due_date, id)`.
- Máximo 100 elementos por página.
- Búsqueda normalizada por paciente sólo en rutas autenticadas.
- Acciones masivas futuras deben recibir ids explícitos, no un filtro mutable.

Errores esperados:

- 404 recurso inexistente o de otro tenant.
- 409 transición/conflicto/ausencia prematura.
- 422 DTO o regla clínica inválida.
- 402 suscripción sin escritura.
- 404 módulo no contratado/apagado conforme a la política actual.

## 8. Commit 7 — Frontend de Recall

### `/recalls`

- Tarjetas KPI: **sólo "pendientes por contactar"**, etiquetado como el backlog de hoy y
  fuera de cualquier bloque con selector de fechas. Convertidos y agotados NO se pintan
  todavía: sus cifras se mueven solas hasta que existan fechas inmutables (commit 8), y una
  conversión que cambia sola es peor que no mostrarla — es el número con el que la clínica
  juzga si el módulo sirve.
- Tabla: paciente, tipo, vencimiento, médico, último intento, siguiente acción y estado.
- Filtros sincronizados en URL.
- Acciones: llamar, enviar, registrar resultado, descartar y abrir paciente.
- Refresco después de conflicto; nunca actualizar optimistamente una transición irreversible.

### `/ajustes/recalls`

- CRUD de tipos.
- Periodicidad, servicio público asociado, anticipación e intentos.
- Configuración del seguimiento por no-show y demora.
- Desactivar conserva histórico.

### Expediente y sala de espera

- Panel de próximo control, vencidos e historial en `/pacientes/[patientId]`.
- Selector opcional de tipo de recall en partidas del presupuesto.
- Botón “No asistió” con hora de habilitación y confirmación explícita.

Todas las vistas deben cubrir loading, vacío, error, 402, módulo no disponible, permiso
insuficiente y conflicto 409. Teclado, foco visible y etiquetas accesibles son parte de Done.

## 9. Commit 8 — Barrido, métricas, observabilidad y E2E

### Worker

- Ejecutar barrido `pending → due` por fecha local de clínica.
- Reclamar intentos vencidos con `SKIP LOCKED` o función `SECURITY DEFINER` acotada.
- Digital: crear `outbound_messages` con idempotencia
  `recall:{recallId}:a{n}:{channel}`.
- Sin canal digital: crear tarea `phone`, nunca un envío inválido.
- Fallo permanente degrada a tarea manual; transitorio usa reintentos existentes.

### Métricas MVP

- Vencidos: recalls, no mensajes. **Backlog de hoy, no cifra del periodo** (ver abajo).
- Contactados: recalls únicos con intento en el periodo.
- Convertidos: recalls vinculados dentro de 30 días desde primer contacto.
- Recuperados: pacientes únicos cuya cita vinculada terminó.
- Tiempo mediano desde primer contacto hasta reserva.

No mostrar “ingreso recuperado” todavía.

> **"Vencidos" es backlog, no histórico.** La consulta ignora el rango de
> fechas: reconstruir cuántos controles estaban vencidos en un mes pasado
> exigiría un histórico de estados que no existe. Pedir enero–marzo devuelve el
> pendiente de hoy. Se muestra aparte y etiquetado como tal, nunca dentro del
> bloque con selector de fechas.
>
> **Bloqueo conocido (detectado en el commit 4).** Convertidos, recuperados,
> agotados y la mediana se fechan hoy con `patient_recalls.updated_at`, que es
> MUTABLE: cualquier edición posterior arrastra el control al periodo actual, el
> informe de un mes pasado cambia solo, y dos consultas del mismo rango pueden
> no coincidir. **Estas cifras no pueden exponerse —ni por API ni en pantalla—
> hasta que existan fechas inmutables de transición** (`scheduled_at`,
> `exhausted_at`, escritas una sola vez en el cambio de estado). Esa migración
> es parte de este commit 8. Vencidos y contactados sí son correctos hoy.
> Consecuencia para el commit 6: `GET /recalls/metrics` NO se construye ahí.

### Webhooks del proveedor sobre `recall_attempts`

`apply_messaging_webhook` sólo toca `outbound_messages` y `messaging_events`:
un intento de recall se quedaría en `pending` para siempre y bloquearía el
control por la regla de "una gestión en curso a la vez". El mapeo de estados y
sus dos consecuencias —un rebote degrada el control a tarea telefónica; cerrar
un intento desde SQL exige poner `status` y `result` a la vez por el CHECK—
están definidos en `docs/adr/0004-diseno-recall-y-entitlements.md` §D8.

### Alertas

- consumos de eventos `dead`;
- mensajes `uncertain`;
- recalls vencidos sin intento por más de N días;
- recalls agotados por semana;
- diferencia entre eventos producidos y consumidos.

### E2E obligatorio

```text
partida terminada con recall_type_id
  → evento
  → recall pendiente/vencido
  → intento
  → mensaje o tarea manual
  → reserva pública compatible
  → recall scheduled
  → consulta finalizada
  → recall completed
```

También cubrir cancelación, reprogramación, no-show, flag apagado/encendido y reconciliación.

## 10. Gate R1

- [ ] Diez casos de uso completos.
- [ ] Productores y consumidores registrados.
- [ ] API y frontend funcionales.
- [ ] E2E completo en PostgreSQL real.
- [ ] Cero mensajes duplicados.
- [ ] Cero cruces de tenant.
- [ ] Flujo manual operable sin Twilio.
- [ ] `pnpm lint`, `pnpm test` y `pnpm build` verdes.
- [ ] Piloto interno con feature flag y rollback probado.

---

# R2 — Llenar huecos de agenda y facilitar el cambio de sistema

## 11. Lista de espera inteligente

Éste es el siguiente diferenciador comercial después de Recall.

### Modelo — migración posterior al último número real

- `waitlist_entries`: paciente, servicio, médico opcional, rango de fechas, ventanas horarias,
  prioridad, estado y expiración.
- `waitlist_offers`: entrada, espacio, expiración, token hash, estado y cita resultante.
- `appointment_slot_holds`: médico, rango `tstzrange`, expiración y offer id.
- Exclusión PostgreSQL para impedir holds o citas traslapadas.
- RLS, índices y triggers de coherencia tenant/paciente/médico/servicio.

### Flujo

1. Recepción agrega paciente a espera.
2. `appointment.cancelled` busca candidatos compatibles.
3. Se crea un hold corto para el primer candidato.
4. Se envía enlace sin motivo clínico.
5. El paciente confirma con `POST`; se crea la cita y se consume el hold atómicamente.
6. Si expira, se ofrece al siguiente candidato.

La disponibilidad pública debe excluir holds activos. No crear citas fantasma para reservar un
espacio. Extender la outbox con `waitlist_offer_id` y un `CHECK num_nonnulls(...) = 1`,
conservando las suites históricas sin modificación.

### API/UI

```text
GET/POST/PATCH /waitlist
POST /waitlist/:id/cancel
GET  /public/waitlist-offers/:token
POST /public/waitlist-offers/:token/accept
POST /public/waitlist-offers/:token/decline
```

Pantalla en agenda con candidatos, ofertas activas, expiraciones y citas recuperadas.

### Aceptación

- Dos pacientes no pueden aceptar el mismo espacio.
- Una reserva pública no puede tomar un hold activo.
- Expirar una oferta libera el espacio.
- GET público no acepta nada.
- Token repetido es idempotente.
- Cancelar otra cita dispara un solo ciclo de ofertas.

## 12. Importador y migración asistida

El MVP importa **pacientes y citas futuras** desde CSV. No importar notas clínicas ni saldos en
la primera versión.

### Modelo

- `import_batches`.
- `import_rows` con estado, hash, errores normalizados y resultado.
- Archivo original privado con expiración corta.
- `idempotency_key` por tenant + hash de archivo + tipo.

### Flujo

1. Cargar archivo.
2. Detectar columnas y mostrar mapeo.
3. Validar todo en modo simulación.
4. Mostrar nuevos, coincidencias, errores y conflictos de agenda.
5. Usuario elige política de duplicados.
6. Ejecutar por lotes pequeños y registrar auditoría.
7. Exportar reporte de resultados.

Coincidencia fuerte de paciente: nombre normalizado + fecha de nacimiento + teléfono. Las
coincidencias débiles sólo se marcan para revisión; nunca se fusionan automáticamente.

### Aceptación

- Repetir el mismo lote no duplica pacientes ni citas.
- Una fila inválida no revierte las filas válidas si el usuario aceptó ejecución parcial.
- Una cita traslapada queda como conflicto, no rompe la restricción existente.
- Los archivos no aparecen en logs y se eliminan al vencer.
- RLS y permisos se prueban con dos tenants.

## 13. Gate R2

- [ ] Cancelación real recupera un espacio mediante lista de espera.
- [ ] Importación de muestra produce un reporte reproducible.
- [ ] Tiempo objetivo para cargar 1,000 pacientes: menos de 15 minutos de operación humana.
- [ ] Existe guía de migración y plantilla CSV descargable.

---

# R3 — Convertir presupuestos en tratamientos y anticipos

## 14. Presupuesto compartible y firma

Crear snapshot inmutable del presupuesto al compartir; no exponer la fila editable.

Tablas:

- `treatment_plan_snapshots`.
- `treatment_plan_public_links` con token hash, propósito, expiración y revocación.
- `treatment_plan_decisions` append-only.
- `treatment_plan_signatures` con evidencia, versión de aviso y hash del snapshot.

Flujo público:

```text
GET  /public/treatment-plans/:token
POST /public/treatment-plans/:token/accept
POST /public/treatment-plans/:token/reject
POST /public/treatment-plans/:token/request-appointment
```

Un GET nunca firma. La aceptación debe mostrar importe, alcance, vigencia y que el precio no
reemplaza el consentimiento clínico. Cambiar el presupuesto crea una versión nueva y revoca
el enlace anterior; no reescribe la versión aceptada.

## 15. Anticipo en línea

Crear puerto `PatientPaymentProvider`; no reutilizar directamente la integración de Stripe de
suscripciones SaaS.

MVP:

- anticipo de cita o presupuesto;
- monto calculado sólo por backend;
- checkout hospedado por proveedor;
- webhook firmado e idempotente;
- abono y movimiento de caja únicamente al confirmar pago;
- reembolso total y conciliación de eventos faltantes.

Nunca guardar PAN/CVV. Cancelar una cita no debe reembolsar automáticamente sin una política
configurada y aceptada por el paciente.

## 16. Gate R3

- [ ] Presupuesto aceptado conserva snapshot y evidencia.
- [ ] Webhook repetido genera un solo abono.
- [ ] Monto manipulado desde navegador es ignorado/rechazado.
- [ ] Caja, presupuesto y proveedor concilian.
- [ ] Fake provider permite E2E sin cuenta productiva.

---

# R4 — Portal, formularios y reputación

## 17. Portal ligero del paciente

Primero usar enlaces por propósito; no crear contraseñas de pacientes todavía.

- próximas citas;
- presupuestos compartidos;
- formularios pendientes;
- documentos expresamente publicados;
- actualización de contacto y consentimientos;
- check-in previo, sin mostrar diagnósticos por canales no seguros.

Los tokens deben ser de alta entropía, almacenados como hash, revocables y con uso/expiración.
Para información clínica sensible, requerir verificación adicional por OTP.

## 18. Formularios previos

- Plantillas versionadas.
- Asignación a cita/paciente.
- Respuestas como borrador y envío final inmutable.
- Revisión por recepción/médico antes de incorporarlas al expediente.
- Firma y versión del aviso aceptado cuando aplique.
- Formularios iniciales: antecedentes, alergias, datos de contacto y consentimiento de datos.

Una respuesta del paciente no modifica directamente la historia clínica sin revisión.

## 19. Reputación

- Enviar solicitud a todos los pacientes elegibles después de una cita finalizada.
- Encuesta privada de satisfacción y enlace configurable de reseña pública.
- No condicionar el enlace público a una calificación alta.
- Registrar invitación, apertura y clic; no almacenar el texto de una reseña externa como si
  fuera parte del expediente.
- Permitir suspender campañas por clínica y respetar opt-out.

Una integración avanzada con Google/marketplaces entra después de validar la invitación
básica y revisar requisitos vigentes de sus APIs.

---

# R5 y R6 — Profundidad clínica y operación

## 20. Periodontograma

- Exámenes versionados, dientes y seis sitios por pieza.
- Sangrado, supuración, placa, margen, profundidad, movilidad, furca y ausencias.
- Borrador editable; firmado inmutable; corrección mediante adenda.
- Comparación histórica y alertas visuales.
- `periodontal_exam.signed` puede crear Recall sólo con regla explícita.
- Validar UX y reglas clínicas con al menos dos odontólogos antes de congelar el esquema.

## 21. Laboratorio dental general

- Catálogo de laboratorios y contactos administrativos.
- Casos vinculados a paciente, presupuesto, partida y cita.
- Estados: borrador, enviado, recibido, en_proceso, listo, entregado, cancelado.
- Fechas prometidas, prueba, recepción, costo visible sólo con permiso y adjuntos privados.
- Alertas cuando una cita se acerca y el caso no está listo.
- Historial append-only de cambios de estado.

No reutilizar `plantillas`; puede convivir como integración especializada.

## 22. Inventario dental

- Catálogo de insumos, unidades y mínimos.
- Almacenes, lotes, caducidad y proveedor.
- Ledger append-only para entradas, consumos, ajustes, transferencias y reversos.
- FEFO para consumibles con caducidad.
- Compras y recepciones parciales.
- Kits por procedimiento; el consumo siempre requiere confirmación humana en el MVP.
- Costos ocultos para roles sin `costear`.

No guardar “stock actual” como fuente de verdad independiente del ledger; puede existir una
proyección reconciliable para lectura rápida.

---

## 23. Reglas transversales para todas las entregas

### Base de datos

- Confirmar el último número de migración antes de crear otra.
- Migración compensatoria en `apps/api/src/db/migrations/rollback/`.
- `tenant_id`, RLS forzado, políticas y grants mínimos.
- Triggers de coherencia cross-tenant donde una FK simple no alcance.
- No borrar documentos clínicos, pagos, recalls o movimientos publicados.

### Arquitectura

- Dominio puro; controladores sin SQL ni reglas.
- Puertos para proveedores externos.
- Transacción controla negocio + auditoría + evento/outbox.
- Efectos externos sólo después del commit o mediante outbox.
- Nombres de consumidores estables y versionados.
- Contratos compartidos sin `any`.

### Privacidad y seguridad

- Sin PHI/PII en eventos, logs o mensajes.
- Tokens públicos almacenados sólo como hash.
- GET públicos sin efectos.
- Rate limit por IP y token cuando aplique.
- Webhooks con cuerpo original, firma e idempotencia.
- Archivos privados con URLs prefirmadas cortas, validación MIME/tamaño/hash.

### Frontend

- Loading, vacío, error, conflicto, permiso y módulo apagado.
- Acciones irreversibles con confirmación.
- Accesibilidad por teclado, foco y lector.
- No ocultar conflictos concurrentes; refrescar datos y explicarlos.

---

## 24. Verificación obligatoria por commit

```bash
pnpm lint
pnpm test
pnpm build
pnpm --filter @healthflow/api test:integration
```

Además:

- aplicar migraciones en base limpia y base actualizada;
- probar rollback dentro de una transacción cuando sea posible;
- ejecutar `git diff --check`;
- conservar verdes las suites históricas sin debilitarlas;
- documentar cualquier cambio de diseño en ADR antes de implementar una solución distinta.

## 25. Estrategia de commits

Cada commit debe ser desplegable o quedar detrás de un flag apagado:

```text
4  recall: configuración + auditoría de sistema + repositorio/casos de uso
5  recall: emisores + no-show + consumidores + finalización
6  recall: API y shared-types
7  recall: frontend
8  recall: worker + métricas + observabilidad + E2E
9  waitlist: esquema, dominio y holds
10 waitlist: API, mensajería, UI y E2E
11 imports: staging, dry-run y pacientes
12 imports: citas futuras, UI y reporte
13 treatment-plan: snapshot, enlace, decisión y firma
14 payments: puerto, fake, proveedor y conciliación
15 portal/forms: enlaces, formularios y revisión
16 reputation: invitaciones y métricas
17 periodontal: esquema, dominio, API y UI
18 labs: flujo completo
19 inventory: ledger, lotes, compras y kits
```

No mezclar migraciones de dos módulos en un mismo commit. La numeración de commit es lógica;
la de migración se confirma al empezar cada cambio.

## 26. Condiciones para piloto vendible

Software:

- Recall y lista de espera funcionando con canal manual y fake/email.
- Importador probado con archivos reales anonimizados.
- Backups automáticos y restauración ensayada.
- Alertas de worker, eventos muertos, mensajes inciertos y errores API.
- Exportación completa de datos de la clínica.
- Feature flags y rollback ensayados.
- Guía de recepción y soporte.

Operación externa, en paralelo:

- dominio de correo verificado;
- Twilio/WABA y plantillas aprobadas para WhatsApp;
- aviso de privacidad y términos revisados;
- política de anticipos/cancelaciones antes de activar pagos;
- 3–5 clínicas piloto con línea base de no-show, ocupación y recuperación.

## 27. Qué no implementar todavía

- Marketplace propio de doctores.
- Telemedicina dental general.
- Contabilidad o nómina.
- Seguros/clearinghouse.
- DICOM/PACS completo.
- Diagnóstico automático sin validación clínica/regulatoria.
- Aplicación móvil nativa; primero PWA y experiencia web adaptable.
- Marketing masivo sin consentimientos y reglas de frecuencia.
- “Ingreso recuperado” sin definición contable acordada.

## 28. Definición de éxito

El plan habrá cumplido su objetivo cuando:

- una clínica pueda migrar pacientes y agenda sin soporte de ingeniería;
- una cancelación pueda convertirse en otra cita sin intervención manual continua;
- un paciente vencido reciba seguimiento y vuelva a una cita atendida;
- un presupuesto pueda compartirse, aceptarse y recibir anticipo con trazabilidad;
- la clínica pueda demostrar qué resultados obtuvo con HealthFlow;
- ningún flujo dependa de desactivar RLS, editar datos manualmente o confiar en una acción no
  idempotente.

## 29. Prompt de arranque para la IA implementadora

```text
Trabaja en el repositorio HealthFlow como ingeniero senior. Lee completos
PLAN_EJECUCION_HEALTHFLOW_COMPETITIVO.md y
docs/adr/0004-diseno-recall-y-entitlements.md antes de editar. Verifica git status,
la rama activa, el último número de migración y los cambios existentes; preserva trabajo
ajeno.

Implementa únicamente el “Commit 5 — Emisores, no-show, finalización y consumidores”. El
commit 4 y su hardening ya están aplicados: hay migración 0050, repositorio, casos de uso,
auditoría de sistema y las dos barreras de contacto. NO avances a API (commit 6), frontend
(commit 7) ni worker/métricas/E2E (commit 8).

Conecta los productores de eventos dentro de la transacción de negocio que ya existe, en
presupuestos, citas internas y PublicBookingService. Construye MarcarNoAsistioUseCase con la
regla de tolerancia: sólo desde 'agendada' o 'en_espera', y sólo después de
fin_programado + 30 minutos, con el reloj inyectado y AusenciaPrematuraError (409) que
incluya allowedAt. Registra los cuatro consumidores con nombres estables y versionados, que
usen los casos de uso existentes y no escriban SQL desde el manejador.

Reprogramar emite UN solo appointment.rescheduled y no toca el control vinculado. La
asociación automática exige que appointment.service_id coincida con
recall_types.booking_service_id; un tipo sin servicio requiere vínculo manual.

Mantén dominio puro, transacciones, RLS forzado, grants mínimos, idempotencia y aislamiento
entre dos tenants. No uses Promise.all sobre el mismo tx. No atrapes violaciones de unicidad
para lograr idempotencia: en PostgreSQL abortan la transacción — usa ON CONFLICT. Ejecuta
pruebas de dominio e integración con PostgreSQL real, pnpm lint, pnpm test, pnpm build y
git diff --check, y conserva verdes las suites históricas sin debilitarlas. Actualiza el
checklist del plan sólo con evidencia verificable y entrega un resumen de archivos,
migraciones, decisiones, pruebas y riesgos pendientes. No hagas push.
```
