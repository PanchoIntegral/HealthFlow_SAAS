# HealthFlow: continuación después de `Fase2-Odont`

> Documento de ejecución para una IA o equipo de desarrollo.
>
> Estado revisado: 11 de septiembre de 2026.
> Rama: `Fase2-Odont`.
> Mercado inicial: consultorios y clínicas dentales en México.

## 1. Objetivo

Continuar el producto dental desde las fundaciones de `Fase2-Odont` y entregar
el siguiente flujo vendible:

```text
Visita o tratamiento terminado
  -> HealthFlow calcula cuándo debe regresar el paciente
  -> recepción ve el seguimiento pendiente
  -> se contacta por un canal autorizado
  -> el paciente reserva una cita
  -> la cita cierra el seguimiento
  -> la clínica mide pacientes e ingresos recuperados
```

Este flujo es **Recall y reactivación**. No es un recordatorio: el recordatorio
parte de una cita existente; el recall intenta conseguir una cita nueva.

## 2. Qué ya está implementado

`Fase2-Odont` implementa la Fase A transversal:

- feature flags por clínica;
- eventos internos persistentes e idempotentes;
- consumiciones independientes por módulo;
- dispatcher integrado al worker;
- acciones y subjects CASL para los futuros módulos;
- helpers para tokens públicos aleatorios almacenados como hash;
- validación para impedir PII/PHI, credenciales y tokens en eventos/logs;
- pantalla administrativa de módulos;
- pruebas de dominio e integración de estas fundaciones.

La migración `0046_fundaciones_dentales.sql` ya existe y **no debe
modificarse**.

Aunque el commit se llame "módulos de laboratorio", aún no existen tablas,
casos de uso, API ni pantallas funcionales de recall, periodontograma, portal,
formularios, laboratorio dental, inventario, pagos o comisiones. Esto también
está registrado en `docs/adr/0003-fundaciones-modulos-dentales.md`.

Documentos fuente:

- `docs/adr/0003-fundaciones-modulos-dentales.md`: decisiones de Fase A;
- `README_MODULOS_DENTALES_PRIORITARIOS.md`: especificación de los ocho módulos;
- `README_VERSION_VENDIBLE.md`: bloqueadores de producción y venta;
- este README: orden inmediato posterior a `Fase2-Odont`.

## 3. Orden recomendado

| Orden | Entrega | Resultado |
|---:|---|---|
| 0 | Entitlements separados de flags | Nadie usa módulos no contratados |
| 1 | Recall y reactivación | Recuperar pacientes y llenar agenda |
| 2 | Presupuesto compartible y aceptable | Convertir diagnósticos en tratamientos |
| 3 | Portal ligero y formularios | Reducir captura y llamadas |
| 4 | Periodontograma | Completar expediente dental especializado |
| 5 | Laboratorios dentales | Controlar trabajos externos y retrasos |
| 6 | Inventario dental | Controlar lotes, caducidad, costo y consumo |
| 7 | Pagos y anticipos | Asegurar citas y reducir fricción de cobro |
| 8 | Reportes y comisiones | Medir rentabilidad y liquidar al equipo |

Cada módulo debe llegar a un vertical slice operable, medible y protegido antes
de iniciar el siguiente.

---

# Entrega 0 — Contratación, configuración y rollout

> **Hecha** (2026-09-11): migración `0047_module_entitlements.sql`, commits
> `1a0ed63` y `6de51c6`. Diseño y alternativas descartadas en
> `docs/adr/0004-diseno-recall-y-entitlements.md`.
>
> Dos desviaciones respecto a lo que pedía esta sección, ambas razonadas en el
> ADR: (1) **no hay endpoint HTTP** para conceder derechos — la forma más
> barata de garantizar que un titular no se los conceda es que no exista la
> ruta; se usa `pnpm db:grant-module` como rol admin, y el rol de la aplicación
> tiene sólo SELECT sobre la tabla. (2) La capacidad **distingue lectura de
> escritura**: una clínica con el pago atrasado conserva la consulta y pierde
> el registro, en vez de perder el módulo entero.

## 4. Por qué debe hacerse

Actualmente `tenant_feature_flags` define si el módulo está habilitado y el
titular puede cambiarlo con `PUT /modulos`. Esto sirve para rollout técnico,
pero permitiría que una clínica active una función no contratada.

Separar tres conceptos:

| Concepto | Responsable | Propósito |
|---|---|---|
| Entitlement | HealthFlow/facturación | Qué compró la clínica |
| Feature flag | Operación de HealthFlow | Pilotos, rollout y rollback |
| Configuración | Administrador de clínica | Si desea usar lo disponible |

La decisión efectiva debe ser:

```text
disponible = suscripcion_vigente
             AND entitlement_contratado
             AND rollout_habilitado
             AND configuracion_activa
```

## 5. Implementación

Crear una migración con el siguiente número libre. Si se utiliza `0047`, Recall
se recorre a `0048`; nunca reutilizar un número aplicado.

Tabla sugerida:

```text
tenant_module_entitlements
  id
  tenant_id
  module_key
  source            -- plan, addon, trial, manual
  status            -- active, trialing, suspended, expired
  starts_at
  ends_at nullable
  granted_by nullable
  metadata jsonb limitado y sin datos clínicos
  created_at
  updated_at
```

Requisitos:

- unicidad tenant/módulo para el entitlement vigente;
- catálogo de módulos compartido entre API y web;
- RLS por tenant;
- escritura sólo desde facturación u operación interna autorizada;
- auditoría de concesión, suspensión y vencimiento;
- una función de dominio como única fuente de verdad de capacidad;
- validación tanto en API como en workers y consumidores de eventos;
- `GET /modulos` debe distinguir contratado, rollout, configuración y
  disponibilidad efectiva;
- apagar o suspender nunca elimina el histórico.

Si los módulos son parte fija de cada plan, puede iniciarse con un mapa
versionado `plan -> modules` en `shared-types`. La tabla sigue siendo necesaria
para add-ons, pruebas y excepciones comerciales.

### Aceptación

- [ ] Una clínica sin entitlement no puede usar el módulo manipulando la API.
- [ ] Tener entitlement no evita un rollback mediante feature flag.
- [ ] El administrador de clínica no puede concederse entitlements.
- [ ] Suspender bloquea escrituras pero conserva el histórico.
- [ ] API, worker y consumidores aplican la misma decisión.
- [ ] RLS impide consultar o modificar derechos de otro tenant.
- [ ] Las transiciones quedan auditadas sin información sensible.

---

# Entrega 1 — Recall y reactivación

## 6. Por qué sigue Recall

Recall reutiliza pacientes, citas, servicios, profesionales, reserva pública,
consentimientos, outbox, worker, eventos internos, auditoría y RLS. Tiene menor
riesgo de interfaz clínica que el periodontograma y entrega valor comercial
medible: citas y pacientes recuperados.

No depende de Twilio. Puede pilotearse inicialmente mediante correo, llamadas
manuales y el adaptador fake, manteniendo WhatsApp deshabilitado.

## 7. Alcance MVP

- Tipos configurables: limpieza, revisión, periodontal y personalizado.
- Intervalo predeterminado en meses.
- Fecha de vencimiento por paciente.
- Asignación manual desde el expediente.
- Generación desde un tratamiento terminado.
- Reactivación por no-show, cancelación sin reemplazo, presupuesto/tratamiento
  pendiente o ausencia prolongada.
- Estados `pending`, `due`, `contacted`, `scheduled`, `completed`, `dismissed`
  y `exhausted`.
- Worklist para recepción con filtros y acciones.
- Contacto manual y automático por canales autorizados.
- Enlace a reserva pública con servicio/profesional cuando aplique.
- Vinculación automática al crear una cita compatible.
- Exclusión por opt-out, paciente archivado, cita equivalente o cierre manual.
- Métricas de contacto, conversión y recuperación.

Fuera del MVP: marketing masivo, predicción por IA, promociones automáticas y
cualquier envío de información clínica por correo o WhatsApp.

## 8. Persistencia

Entrega 0 ocupó `0047_module_entitlements.sql`, así que **Recall es
`0048_dental_recalls.sql`**.

Además hace falta una segunda migración, **`0049_outbox_polimorfica.sql`**, que
este documento no contemplaba: `outbound_messages.appointment_id` es `NOT NULL`
y `claim_outbound_messages` hace `JOIN appointments`, de modo que un mensaje de
recall —que no tiene cita— hoy no cabe en la outbox. Va **después** de `0048`,
porque su columna nueva referencia `recall_attempts`. Ver
`docs/adr/0004-diseno-recall-y-entitlements.md` §D1.

### `recall_types`

- `id`, `tenant_id`, `name`;
- `interval_months`;
- `booking_service_id` nullable;
- `active`, `auto_generate`;
- `days_before_first_contact`;
- `max_attempts`, `attempt_spacing_days`;
- timestamps.

Nombre normalizado único por tenant entre tipos activos.

### `patient_recalls`

- `id`, `tenant_id`, `patient_id`, `recall_type_id`;
- `source`: `manual`, `procedure`, `periodontal`, `reactivation`;
- `source_entity_id` nullable;
- `due_date`, `status`;
- `assigned_doctor_id`, `appointment_id` nullable;
- `last_contact_at`, `next_attempt_at`, `completed_at` nullable;
- `dismiss_reason` nullable y acotado;
- timestamps.

Agregar un índice único parcial que impida dos recalls vivos del mismo tipo para
el mismo paciente.

### `recall_attempts`

- `id`, `tenant_id`, `patient_recall_id`;
- `channel`: `email`, `whatsapp`, `phone`, `manual`;
- `status`, `attempt_number`;
- `scheduled_at`, `sent_at` nullable;
- `created_by` nullable;
- `result`: `sent`, `answered`, `booked`, `declined`, `unreachable`, `failed`;
- nota administrativa corta y timestamps.

No duplicar el cuerpo del mensaje: entrega y proveedor viven en
`outbound_messages`.

**La referencia va en una sola dirección**: `outbound_messages.recall_attempt_id`
apunta al intento, y el intento consulta sus envíos con un `JOIN`. La versión
anterior de este documento pedía además `recall_attempts.outbound_message_id`,
lo que crearía una relación circular: dos fuentes de verdad para el mismo
vínculo, que pueden discrepar, y un orden de borrado imposible de razonar.

Un intento de canal `phone` o `manual` **no** crea fila en `outbound_messages`:
es una tarea que recepción cierra a mano. Eso es lo que hace que el módulo
funcione sin Twilio y sin dominio de correo verificado.

Todas las tablas requieren foreign keys tenant-safe, RLS deny-by-default,
grants mínimos, índices de consultas reales y migración compensatoria en
`apps/api/src/db/migrations/rollback/`.

## 9. Dominio

Implementar `PatientRecall` con transiciones explícitas:

```text
pending -> due -> contacted -> scheduled -> completed
                   |              |
                   +-> exhausted  +-> due al cancelar sin reemplazo
                   +-> dismissed
```

Reglas:

- una cita futura compatible detiene el contacto automático;
- completar un procedimiento crea el siguiente ciclo, no reescribe el anterior;
- reprocesar un evento no genera duplicados;
- no contactar pacientes archivados o fallecidos;
- nunca inferir consentimiento de WhatsApp;
- no duplicar intento por recall/canal/ventana;
- cambios de periodicidad sólo afectan ciclos nuevos;
- fechas y envíos usan la zona horaria IANA de la clínica;
- cancelar una cita reactiva sólo cuando no existe reemplazo;
- completar o descartar conserva trazabilidad.

## 10. Eventos y consumidores

Consumidores mínimos:

- `treatment_item.completed` -> crear siguiente recall;
- `appointment.scheduled` -> vincular y marcar `scheduled`;
- `appointment.rescheduled` -> conservar el vínculo, sin reabrir nada;
- `appointment.cancelled` -> reactivar (una cancelación ya es definitiva);
- `appointment.no_show` -> crear/reactivar seguimiento;
- paciente archivado -> cancelar intentos pendientes.

Reprogramar emite **un solo** `appointment.rescheduled`, no una cancelación
seguida de un alta: el par obligaría a cada consumidor a correlacionar dos
eventos dentro de una ventana temporal, y bastaría con que uno escuchara sólo
`appointment.cancelled` para reabrir un seguimiento con la cita nueva ya
agendada. Los emisores incluyen `PublicBookingService`, que es por donde
reserva el paciente que recibió el recall.

Cada consumidor debe tener nombre estable, operar en el tenant del evento,
validar capacidad efectiva, ser idempotente y completar consumo/efecto en una
sola transacción. Los payloads no pueden incluir nombre, teléfono, correo,
diagnóstico ni texto clínico.

## 11. Casos de uso

- `CreateRecallTypeUseCase`;
- `UpdateRecallTypeUseCase`;
- `AssignPatientRecallUseCase`;
- `GenerateRecallFromCompletedTreatmentUseCase`;
- `ListRecallWorklistUseCase`;
- `ScheduleRecallAttemptUseCase`;
- `RecordRecallOutcomeUseCase`;
- `MatchAppointmentToRecallUseCase`;
- `DismissRecallUseCase`;
- `ProcessDueRecallsUseCase` ejecutado por worker.

Los casos de uso controlan transacciones. Controllers y worker sólo validan,
seleccionan y delegan; no contienen SQL ni reglas de estados.

## 12. API

```text
GET    /recalls/types
POST   /recalls/types
PATCH  /recalls/types/:id
GET    /recalls?status=&dueFrom=&dueTo=&doctorId=&q=
POST   /recalls
POST   /recalls/:id/contact
POST   /recalls/:id/outcome
POST   /recalls/:id/dismiss
GET    /recalls/metrics?from=&to=
```

Aplicar DTOs validados, paginación, orden estable, códigos de error de dominio,
`@RequiereFlag('dental_recalls')`, CASL y auditoría. Recepción puede contactar;
sólo roles autorizados configuran tipos.

## 13. Worker y mensajería

- El worker selecciona intentos vencidos y delega.
- Constraints e `outbound_messages.idempotency_key` respaldan idempotencia.
- Usar Resend si existe correo utilizable.
- Crear tareas manuales de llamada cuando no hay canal digital.
- Usar WhatsApp sólo con Twilio configurado y consentimiento verificable.
- Desarrollar y probar con el adaptador fake.
- No bloquear Recall por no tener cuenta de Twilio.
- Nunca incluir diagnóstico, tratamiento, pieza dental o presupuesto en mensajes.

## 14. Frontend

### `/recalls`

Tablero con paciente, tipo, vencimiento, último intento, canal, profesional,
próxima acción y estado. Filtros por estado, rango, profesional y paciente. Las
acciones masivas muestran alcance y requieren confirmación.

### `/ajustes/recalls`

CRUD de tipos, periodicidad, servicio asociado, generación automática,
anticipación y secuencia de intentos. Desactivar no elimina histórico.

### Expediente

Mostrar próximo control, vencidos, historial e indicador de estado. Permitir
asignar, descartar y programar próximo control desde un tratamiento terminado.

Contemplar loading, vacío, error, permisos, flag apagado y conflictos.

## 15. Métricas

- recalls vencidos;
- pacientes contactables;
- intentos y entregas;
- respuestas;
- citas creadas y vinculadas;
- recalls completados;
- tasa de recuperación;
- tiempo desde vencimiento hasta reserva;
- ingreso cobrado atribuible cuando la relación sea verificable.

No contar mensajes como pacientes. Etiquetar claramente si una métrica usa
recalls, pacientes o citas únicas.

## 16. Aceptación de Recall

- [ ] Completar un procedimiento crea exactamente un recall siguiente.
- [ ] Reprocesar el evento no duplica el recall.
- [ ] No existen dos recalls vivos equivalentes.
- [ ] Una cita compatible marca el recall `scheduled`.
- [ ] Cancelarla sin reemplazo reactiva el recall.
- [ ] Una cita de reemplazo evita reactivar contacto.
- [ ] Sin opt-in no se envía WhatsApp.
- [ ] Sin correo se crea una tarea manual, no un envío inválido.
- [ ] Pacientes archivados no son contactables.
- [ ] Dos workers no procesan el mismo intento.
- [ ] Fallos transitorios usan backoff y permanentes no giran indefinidamente.
- [ ] RLS aísla dos tenants en lectura, escritura y reclamo del worker.
- [ ] La matriz CASL está probada.
- [ ] Eventos, logs y mensajes no contienen PII/PHI prohibida.
- [ ] Apagar el flag bloquea API/worker sin borrar datos.
- [ ] E2E: tratamiento terminado -> recall -> contacto -> reserva -> cierre.
- [ ] Las métricas coinciden con las entidades creadas por el E2E.

## 17. Gate de liberación

Recall no está terminado hasta tener migración y rollback probados, dominio, API,
worker y frontend completos, PostgreSQL real en CI, observabilidad de trabajos
fallidos, documentación para recepción y piloto sin mensajes duplicados.

---

# Entregas posteriores

## 18. Presupuesto compartible, aceptación y firma

HealthFlow ya tiene presupuestos. Agregar snapshot inmutable, token público
hasheado, página pública, aceptación/firma, versión legal, expiración, revocación,
auditoría y métricas `presentado -> visto -> aceptado`.

## 19. Portal ligero y formularios

Crear formularios versionados, asignaciones, borradores y envío final; anexado
controlado al expediente; próximas citas y documentos en un portal seguro;
tokens por propósito, expiración, revocación, rate limit y anti-enumeración.

Al terminar Recall, presupuesto compartible y portal/formularios puede comenzar
el piloto comercial con 3 a 5 clínicas.

## 20. Periodontograma

Validar primero la UX con al menos dos odontólogos. Implementar exámenes
versionados, seis sitios por pieza, sondaje, margen/recesión, inserción calculada,
sangrado, supuración, placa, movilidad, furcación, captura por teclado,
comparación histórica e integración con nota, odontograma y recall.

## 21. Laboratorios dentales

Agregar catálogo de laboratorios, casos ligados a paciente/presupuesto/partida,
etapas, responsables, fecha prometida, alertas, eventos append-only, adjuntos
seguros y costos protegidos por rol.

## 22. Inventario dental

Agregar productos, unidades, mínimos, lotes, caducidad, ledger append-only,
proveedores, órdenes, recepciones, kits por procedimiento, consumo idempotente,
alertas y valorización. No reducirlo a una tabla editable de existencias.

## 23. Pagos, reportes y comisiones

Después de validar lo anterior: intents y anticipos, webhook idempotente,
conciliación con caja/presupuesto, reembolsos, productividad, conversión,
rentabilidad y reglas/periodos de comisión versionados con aprobación inmutable.

---

# Reglas transversales

## 24. Arquitectura

```text
modules/<modulo>/
  domain/
  application/
  infrastructure/
  <modulo>.module.ts
```

- Dominio sin Nest ni SQL.
- Repositorios como puertos y SQL/Drizzle como adaptadores.
- Transacciones en casos de uso; controllers delgados.
- Contratos en `shared-types`, sin `any`.
- Eventos dentro de la transacción de negocio.
- Integraciones asincrónicas mediante eventos, no llamadas cruzadas directas.

## 25. Seguridad, calidad y operación

Cada módulo requiere:

- RLS y pruebas con dos tenants;
- tenant derivado del contexto, nunca del body;
- CASL por rol;
- auditoría de mutaciones sensibles;
- tokens públicos hasheados y respuesta de rechazo uniforme;
- rate limit público;
- ausencia de PII/PHI en logs, eventos y mensajería;
- pruebas unitarias, integración, concurrencia, idempotencia y E2E;
- estados de UI y accesibilidad básica;
- métricas, alertas, soporte y rollback;
- activación interna antes del primer tenant piloto.

## 26. Bloqueadores paralelos de la versión vendible

También deben cerrarse los pendientes de `README_VERSION_VENDIBLE.md`:

- entrega real mediante proveedor configurado;
- contactos y consentimientos editables para pacientes internos;
- aviso de privacidad visible antes de aceptarlo;
- monitoreo de API, worker, outbox, eventos y webhooks;
- backups y simulacro de restauración;
- E2E y carga en CI con PostgreSQL;
- onboarding, soporte y baja de clínicas;
- dominio de correo y textos legales revisados;
- cuenta y plantillas de WhatsApp cuando se active ese canal.

Estas tareas pueden avanzar junto con Recall, pero bloquean el lanzamiento
público aunque existan muchos módulos.

## 27. Estrategia de trabajo

- Partir de `Fase2-Odont` o fusionarla primero en la rama base acordada.
- No modificar migraciones aplicadas.
- No implementar todas las entregas en un solo cambio.
- Commits sugeridos:
  1. entitlements y capacidad efectiva;
  2. migración y dominio de Recall;
  3. repositorio y casos de uso;
  4. consumidores y worker;
  5. API y contratos;
  6. frontend;
  7. pruebas, métricas y documentación.

## 28. Prompt listo para otra IA

```text
Trabaja sobre la rama que contiene Fase2-Odont. Lee completamente:

1. README_CONTINUACION_FASE2_ODONT.md
2. README_MODULOS_DENTALES_PRIORITARIOS.md
3. README_VERSION_VENDIBLE.md
4. docs/adr/0003-fundaciones-modulos-dentales.md

Primero implementa la Entrega 0: separa entitlement comercial, feature flag de
rollout y configuración del tenant. Un administrador de clínica no puede
concederse módulos no contratados y el rollback no debe borrar información.

Después implementa únicamente el vertical slice completo de Recall descrito en
este documento. Reutiliza eventos internos, outbox de mensajería, reserva
pública, CASL, auditoría, RLS y helpers de privacidad/tokens. No modifiques la
migración 0046; utiliza el siguiente número libre.

No bloquees Recall por Twilio: desarrolla con fake, correo y tareas manuales, y
mantén WhatsApp apagado si faltan credenciales o consentimiento.

Antes de editar, verifica el estado real y ajusta sólo números o nombres que
hayan cambiado. Implementa persistencia, dominio, casos de uso, API, worker,
frontend, métricas y pruebas. No declares terminado hasta ejecutar integración
con PostgreSQL real, RLS con dos tenants, idempotencia con dos workers y un E2E
desde tratamiento terminado hasta nueva reserva.

Entrega al final: archivos modificados, migraciones, decisiones, pruebas y sus
resultados, riesgos restantes, rollback y pasos de despliegue.
```

## 29. Definición de éxito

- La clínica no puede activar módulos no contratados.
- Una acción clínica genera un recall exactamente una vez.
- Recepción trabaja una lista real de pacientes por recuperar.
- El contacto respeta consentimiento y privacidad.
- Una reserva actualiza el recall automáticamente.
- La clínica ve pacientes, citas e ingresos recuperados.
- El flujo funciona sin Twilio y admite habilitarlo después.
- RLS, idempotencia, rollback y E2E tienen evidencia automática.
- El piloto puede habilitarse sin afectar a otros tenants.

