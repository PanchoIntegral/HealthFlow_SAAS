# HealthFlow — Plan de implementación de módulos dentales prioritarios

> Documento de ejecución para una IA o equipo de ingeniería.
>
> Estado de referencia: repositorio revisado después de la versión vendible de reservas públicas y mensajería.
> Este documento describe trabajo futuro; no afirma que los módulos aquí definidos ya estén implementados.

## 0. Estado de ejecución

> Se actualiza al terminar cada fase. No se borran pendientes ni evidencia histórica (§20.12).

| Fase | Estado | Evidencia |
|---|---|---|
| A — Fundaciones | **Hecha** (2026-09-11) | Migración `0046_fundaciones_dentales.sql`, `docs/adr/0003-fundaciones-modulos-dentales.md`, 543 pruebas en verde |
| Entrega 0 — Entitlements y capacidad efectiva | **Hecha** (2026-09-11) | Migración `0047_module_entitlements.sql`, `docs/adr/0004-diseno-recall-y-entitlements.md`, 569 pruebas en verde |
| B — Conversión y retorno | Pendiente | — |
| C — Clínica dental avanzada | Pendiente | — |
| D — Operación | Pendiente | — |
| E — Ingresos y gestión | Pendiente | — |

**Corrección a la numeración de migraciones de este documento.** La Fase A ocupó `0046` y la
Entrega 0 (entitlements) `0047`, así que cada migración de módulo se recorre: recalls es `0048`,
más una `0049` para la outbox polimórfica que el plan original no contemplaba. La tabla de la §16
ya refleja el corrimiento. Verificar igualmente el directorio antes de escribir (§20.3).

---

## 1. Objetivo

Completar el núcleo odontológico de HealthFlow con los módulos que más aumentan el valor comercial para consultorios y clínicas dentales mexicanas, sin romper las garantías existentes de aislamiento multi-tenant, expediente clínico, auditoría, cobranza y mensajería.

El resultado esperado es cubrir este flujo:

```text
captación y reserva
  → formularios previos
  → diagnóstico dental y periodontal
  → plan de tratamiento compartido
  → aceptación y anticipo
  → ejecución por citas
  → consumo de materiales
  → trabajo de laboratorio
  → cobro, comisión y facturación
  → recall, reactivación y medición de resultados
```

## 2. Hallazgos verificados en el proyecto

HealthFlow ya cuenta con:

- pacientes y expediente clínico;
- citas, sala de espera y agenda;
- reserva pública, confirmación, cancelación y reprogramación;
- odontograma;
- notas clínicas y asistente de IA;
- recetas;
- consentimientos;
- radiografías y almacenamiento de archivos;
- presupuestos, partidas, abonos y saldos;
- caja;
- facturación CFDI;
- reportes clínicos básicos;
- mensajería con outbox;
- roles, RLS, auditoría y suscripciones.

No se encontró implementado:

- inventario dental;
- gestión general de laboratorios dentales;
- periodontograma;
- recall/recare y reactivación;
- portal completo del paciente;
- formularios previos a consulta;
- aceptación pública y firma de presupuestos;
- pagos o anticipos en línea de pacientes;
- comisiones de odontólogos;
- analítica dental comercial completa.

El módulo `plantillas` existente es una orden de órtesis para podología y no debe renombrarse ni reutilizarse como laboratorio dental genérico.

## 3. Alcance y prioridad

| Orden | Módulo | Prioridad | Valor principal |
|---:|---|---|---|
| 1 | Recall y reactivación | P0 comercial | Recupera pacientes y ocupa agenda |
| 2 | Periodontograma | P0 clínico dental | Completa el expediente odontológico |
| 3 | Plan de tratamiento compartible, aceptación y firma | P0 comercial | Aumenta conversión de presupuestos |
| 4 | Formularios y portal ligero del paciente | P0 operativo | Reduce captura en recepción |
| 5 | Laboratorios dentales | P1 operativo | Evita retrasos de prótesis y coronas |
| 6 | Inventario dental | P1 operativo | Controla faltantes, caducidad y costo |
| 7 | Pagos y anticipos en línea | P1 ingresos | Reduce fricción y asegura citas |
| 8 | Reportes dentales y comisiones | P1 gestión | Permite dirigir y pagar al equipo |

La prioridad P0/P1 de este documento es relativa al producto dental, no reemplaza los bloqueadores de producción de `README_VERSION_VENDIBLE.md`.

## 4. Dependencias entre módulos

```text
Pacientes ─────────────────────────────────────────────────────────────┐
   ├── Formularios/portal ─── Consentimientos                          │
   ├── Periodontograma ────── Nota clínica ───── Odontograma           │
   ├── Recall ─────────────── Agenda pública ─── Mensajería            │
   └── Presupuestos ───────── Aceptación/firma ─ Pagos                 │
                                      │                                │
                                      ├── Partidas ─── Laboratorio     │
                                      ├── Partidas ─── Inventario      │
                                      └── Partidas ─── Citas           │
                                                                       │
Caja/CFDI ◄──────────── Pagos ────────┴──────────── Reportes/comisiones┘
```

Orden obligatorio de construcción:

1. convenciones transversales y feature flags;
2. recall y periodontograma, que pueden desarrollarse de forma independiente;
3. portal ligero y aceptación de presupuestos;
4. formularios sobre la infraestructura del portal;
5. laboratorio e inventario;
6. pagos sobre presupuestos aceptados;
7. reportes y comisiones después de estabilizar los eventos que los alimentan.

## 5. Reglas arquitectónicas obligatorias

### 5.1. Estructura de módulos

Cada módulo nuevo debe seguir el patrón existente:

```text
apps/api/src/modules/<modulo>/
  application/
    *.use-case.ts
  domain/
    *.entity.ts
    *.errors.ts
    *.repository.ts
  infrastructure/
    dto/
    *.controller.ts
    *.drizzle-repo.ts
  <modulo>.module.ts
```

No colocar reglas de negocio en controladores, componentes React o repositorios. Las máquinas de estado, cálculos y validaciones clínicas deben vivir en entidades o servicios de dominio puros y tener pruebas sin PostgreSQL.

### 5.2. Base de datos y multi-tenancy

Toda tabla de negocio debe incluir:

```sql
tenant_id uuid NOT NULL
  DEFAULT current_tenant_id()
  REFERENCES tenants(id) ON DELETE CASCADE
```

También debe:

- habilitar y forzar RLS;
- crear política `tenant_isolation` con `USING` y `WITH CHECK`;
- conceder sólo los permisos mínimos a `healthflow_app`;
- usar `TenantDbService.run()` para operaciones autenticadas;
- validar pertenencia al mismo tenant en funciones `SECURITY DEFINER`;
- evitar borrado físico de documentos clínicos, financieros o firmados;
- incluir índices empezando por `tenant_id` en consultas de alto volumen;
- usar UTC en `timestamptz` y convertir con la zona IANA de la clínica sólo al presentar o calcular reglas locales.

Las migraciones propuestas comienzan en `0046`, porque la última observada es `0045_booking_stabilization.sql`. Antes de implementar, volver a listar `apps/api/src/db/migrations/` y renumerar si otro cambio ocupó esos números.

### 5.3. Auditoría

Toda transición relevante debe llamar a `AuditService.record()` dentro de la misma transacción:

- crear, editar, firmar o corregir una evaluación periodontal;
- crear o cerrar un recall;
- compartir, aceptar o rechazar un presupuesto;
- enviar, recibir, ajustar o cancelar un trabajo de laboratorio;
- registrar o revertir un movimiento de inventario;
- crear o resolver un pago;
- calcular, aprobar o reabrir una liquidación de comisión.

El detalle de auditoría no debe guardar cuerpos clínicos completos, firmas dibujadas, tokens, teléfonos, correos ni payloads completos de proveedores.

### 5.4. Dinero

- Guardar importes en centavos enteros (`bigint`).
- No confiar en totales enviados por frontend.
- Derivar total, saldo, impuesto y comisión en backend.
- Congelar precio y regla de comisión al aceptar/aprobar; los cambios futuros no deben reescribir el histórico.
- Los webhooks de pago deben ser firmados e idempotentes.
- Un pago, devolución o ajuste se revierte con un movimiento compensatorio; no se elimina.

### 5.5. Documentos clínicos

- Un borrador puede editarse.
- Un documento firmado es inmutable.
- Una corrección posterior se almacena como adenda relacionada con el original.
- La vista debe mostrar autor, fecha, versión y motivo de corrección.
- Los archivos viven en almacenamiento privado y se entregan con URL prefirmada corta.

### 5.6. APIs públicas

- No devolver `tenantId`.
- Usar tokens aleatorios de al menos 256 bits; guardar sólo hash SHA-256/HMAC.
- Cada token debe tener propósito, vigencia, revocación y límite de uso explícitos.
- Los `GET` nunca deben producir aceptación, firma, pago ni cancelación.
- Las acciones sensibles requieren pantalla de resumen y `POST` explícito.
- Rate limit por IP y por token hash.
- Respuestas uniformes para impedir enumeración de pacientes o documentos.

### 5.7. Roles y permisos

Agregar subjects a `CaslAbilityFactory`, como mínimo (**hecho en Fase A**, junto con las
acciones `firmar`, `contactar`, `costear` y `aprobar`):

```ts
type Subject =
  | 'Recall'
  | 'Periodontograma'
  | 'PortalPaciente'
  | 'FormularioPaciente'
  | 'LaboratorioDental'
  | 'Inventario'
  | 'PagoPaciente'
  | 'Comisiones';
```

Matriz inicial:

| Acción | Admin | Médico | Asistente |
|---|---:|---:|---:|
| Configurar recall | Sí | Sí | No |
| Contactar recall | Sí | Sí | Sí |
| Crear/firmar periodontograma | Sí | Sí | No |
| Consultar periodontograma | Sí | Sí | Según política clínica |
| Crear/enviar formulario | Sí | Sí | Sí |
| Ver respuesta clínica | Sí | Sí | Limitado |
| Crear/aceptar internamente presupuesto | Sí | Sí | Sólo consultar/cobrar |
| Gestionar laboratorio | Sí | Sí | Sí |
| Ajustar inventario | Sí | Sí | Sí con motivo |
| Ver costos/márgenes | Sí | Sí | No |
| Configurar comisiones | Sí | No | No |
| Aprobar liquidaciones | Sí | No | No |

No usar el rol `admin` como autor clínico implícito. Si una acción requiere juicio médico, validar que el usuario también sea profesional habilitado.

### 5.8. Feature flags

Crear flags por tenant para liberar por etapas (**hecho en Fase A**; el catálogo vive en
`packages/shared-types` → `FEATURE_FLAGS`):

- `dental_recalls`;
- `periodontal_charting`;
- `patient_portal`;
- `patient_forms`;
- `dental_labs`;
- `dental_inventory`;
- `patient_online_payments`;
- `provider_commissions`.

Un flag apagado debe ocultar navegación y devolver `404` o error de capacidad estable desde API. No debe borrar ni volver inaccesible el histórico para administradores durante un rollback.

## 6. Módulo 1 — Recall y reactivación

### 6.1. Objetivo

Detectar automáticamente pacientes que deben regresar, ayudar a recepción a contactarlos y cerrar el ciclo cuando reservan, rechazan o terminan la secuencia de intentos.

No confundir:

- recordatorio de cita: ya existe una cita futura;
- recall: existe una fecha clínica en la que el paciente debería volver, pero todavía no hay cita;
- reactivación: paciente sin visita reciente o tratamiento pendiente sin próxima cita.

### 6.2. Alcance MVP

- Tipos configurables: limpieza, revisión, control periodontal y personalizado.
- Intervalo predeterminado en meses.
- Fecha de vencimiento por paciente.
- Lista de vencidos, próximos, contactados, agendados y descartados.
- Generación desde procedimiento terminado o asignación manual.
- Reactivación por no-show, cancelación sin reprogramar, presupuesto pendiente y paciente inactivo.
- Envío manual y automático mediante la outbox actual.
- Enlace directo a la reserva pública conservando servicio/profesional cuando aplique.
- Exclusión inmediata por opt-out, paciente archivado, cita futura equivalente o cierre manual.
- Métricas de contacto, reserva y recuperación.

### 6.3. Modelo de datos — migración `0047_dental_recalls.sql`

#### `recall_types`

- `id`, `tenant_id`;
- `nombre`;
- `intervalo_meses`;
- `booking_service_id` nullable;
- `activo`;
- `auto_generar`;
- `dias_antes_primer_contacto`;
- `max_intentos`;
- `separacion_intentos_dias`;
- timestamps.

Restricción: nombre único por tenant entre tipos activos.

#### `patient_recalls`

- `id`, `tenant_id`, `patient_id`, `recall_type_id`;
- `origen`: `manual`, `procedimiento`, `periodontograma`, `reactivacion`;
- `origen_entidad_id` nullable;
- `due_date`;
- `status`: `pending`, `due`, `contacted`, `scheduled`, `completed`, `dismissed`, `exhausted`;
- `assigned_doctor_id` nullable;
- `appointment_id` nullable;
- `last_contact_at`, `next_attempt_at`, `completed_at`;
- `dismiss_reason` nullable;
- timestamps.

Índice único parcial que impida dos recalls vivos del mismo tipo para el mismo paciente.

#### `recall_attempts`

- `id`, `tenant_id`, `patient_recall_id`;
- `channel`, `status`;
- `outbound_message_id` nullable;
- `attempt_number`;
- `scheduled_at`, `sent_at`;
- `created_by` nullable;
- `result`: `sent`, `answered`, `booked`, `declined`, `unreachable`, `failed`;
- nota administrativa corta y timestamps.

No duplicar el cuerpo del mensaje: la entrega vive en `outbound_messages`.

### 6.4. Dominio

Crear `PatientRecall` con transiciones explícitas:

```text
pending → due → contacted → scheduled → completed
                   ├───────────────→ exhausted
                   └───────────────→ dismissed
scheduled → due    sólo si la cita se cancela y no existe reemplazo
```

Reglas:

- una cita futura compatible cierra el contacto automático;
- completar el procedimiento genera el siguiente recall, no modifica el anterior;
- nunca asumir consentimiento de WhatsApp;
- no contactar a pacientes archivados o fallecidos;
- no enviar más de un intento del mismo recall/canal/ventana;
- un cambio de intervalo aplica al siguiente ciclo, no reescribe recalls completados;
- la zona horaria de envío es la de la clínica.

### 6.5. Casos de uso

- `CreateRecallTypeUseCase`;
- `UpdateRecallTypeUseCase`;
- `AssignPatientRecallUseCase`;
- `GenerateRecallFromCompletedTreatmentUseCase`;
- `ListRecallWorklistUseCase`;
- `ScheduleRecallAttemptUseCase`;
- `RecordRecallOutcomeUseCase`;
- `MatchAppointmentToRecallUseCase`;
- `ProcessDueRecallsUseCase` ejecutado por worker.

El worker sólo selecciona filas y delega. La idempotencia debe residir en claves únicas de base de datos y en `outbound_messages.idempotency_key`.

### 6.6. API

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

### 6.7. Frontend

- `/recalls`: tablero operativo con filtros y acciones masivas seguras.
- `/ajustes/recalls`: tipos, periodicidad y secuencia de contactos.
- Panel en expediente: próximo control, historial e indicador vencido.
- Acción desde una partida terminada: “Programar próximo control”.

Columnas mínimas del tablero: paciente, tipo, vencimiento, último intento, canal disponible, profesional, próxima acción y estado.

### 6.8. Pruebas de aceptación

- Completar una limpieza genera exactamente un siguiente recall.
- Reprocesar el mismo evento no genera duplicado.
- Crear una cita compatible marca el recall como `scheduled`.
- Cancelarla sin reemplazo reactiva el recall.
- Un paciente sin opt-in no recibe WhatsApp.
- Paciente archivado o con cita futura no aparece como contactable.
- Dos workers no programan el mismo intento.
- Las métricas cuentan recalls únicos, no mensajes.
- RLS impide consultar o actualizar recalls de otro tenant.

## 7. Módulo 2 — Periodontograma

### 7.1. Objetivo

Registrar una evaluación periodontal completa, comparable en el tiempo e integrada con expediente, odontograma, notas y planes de tratamiento.

### 7.2. Alcance MVP

- Dentición permanente con nomenclatura FDI.
- Seis sitios por pieza: MB, B, DB, ML, L, DL.
- Profundidad de sondaje.
- Recesión o margen gingival.
- Nivel de inserción clínica derivado.
- Sangrado, placa y supuración por sitio.
- Movilidad y furcación por pieza.
- Pieza ausente heredada del odontograma, con override explícito auditado.
- Borrador con autoguardado.
- Firma/cierre inmutable.
- Comparación con una evaluación anterior.
- Vista gráfica imprimible.
- Resumen para la nota clínica.

No incluir dictado por voz ni diagnóstico automático en el primer MVP.

### 7.3. Modelo de datos — migración `0048_periodontal_charting.sql`

#### `periodontal_exams`

- `id`, `tenant_id`, `patient_id`;
- `appointment_id` nullable;
- `doctor_id`;
- `status`: `draft`, `signed`, `corrected`;
- `examined_at`;
- `signed_at` nullable;
- `version` integer;
- `corrects_exam_id` nullable;
- `notes` nullable;
- timestamps.

#### `periodontal_sites`

- `id`, `tenant_id`, `exam_id`;
- `tooth_fdi` smallint;
- `surface`: `MB`, `B`, `DB`, `ML`, `L`, `DL`;
- `probing_depth_mm` smallint entre 0 y 15;
- `gingival_margin_mm` smallint entre -15 y 15;
- `bleeding`, `plaque`, `suppuration` boolean;
- `excluded` boolean;
- `excluded_reason` nullable.

Único `(tenant_id, exam_id, tooth_fdi, surface)`.

#### `periodontal_teeth`

- `exam_id`, `tenant_id`, `tooth_fdi`;
- `mobility_grade` entre 0 y 3;
- `furcation_b`, `furcation_l`, `furcation_m`, `furcation_d` nullable entre 0 y 3;
- `implant` boolean;
- `missing` boolean;
- nota.

El nivel de inserción clínica debe calcularse en dominio y devolverse en la vista. No persistirlo si puede derivarse inequívocamente.

### 7.4. Reglas clínicas y de integridad

- Rechazar piezas fuera de la dentición FDI soportada.
- Rechazar sitios repetidos.
- No medir pieza marcada ausente salvo override con motivo.
- Después de `signed`, bloquear `UPDATE` y `DELETE` para el rol de aplicación.
- Una corrección crea un examen nuevo con `corrects_exam_id`.
- Comparar únicamente mediciones homologables.
- No diagnosticar periodontitis automáticamente en MVP; mostrar indicadores y permitir conclusión del odontólogo.
- Mantener unidades en milímetros enteros.

### 7.5. API

```text
GET   /patients/:patientId/periodontal-exams
POST  /patients/:patientId/periodontal-exams
GET   /periodontal-exams/:id
PUT   /periodontal-exams/:id/draft
POST  /periodontal-exams/:id/sign
POST  /periodontal-exams/:id/corrections
GET   /periodontal-exams/:id/compare/:otherId
```

El `PUT draft` recibe un snapshot completo, valida toda la cuadrícula y usa `version` para optimistic locking. Un cliente desactualizado recibe `409` con la versión actual.

### 7.6. Frontend

- Componente `components/periodontograma.tsx` cargado sólo para odontología.
- Captura rápida con teclado: números avanzan entre sitios; teclas para sangrado, placa y supuración.
- Alternar vestibular/lingual y maxilar/mandibular.
- Colores accesibles; no depender sólo del color.
- Gráfica de profundidad y margen.
- Indicadores: sitios ≥4 mm, sangrado, placa, piezas con movilidad/furcación.
- Comparación lado a lado con fecha anterior.
- Confirmación explícita antes de firmar.
- Versión imprimible sin controles interactivos.

### 7.7. Integraciones

- Leer piezas ausentes del odontograma como ayuda inicial, sin modificar el odontograma.
- Adjuntar resumen al expediente.
- Permitir originar partidas de presupuesto seleccionadas por el odontólogo.
- Al firmar, ofrecer crear recall periodontal configurable.
- El asistente IA puede leer el resumen firmado en una fase posterior, pero no debe sobrescribir mediciones.

### 7.8. Pruebas de aceptación

- Se guardan 32 piezas × 6 sitios sin pérdida ni duplicados.
- El nivel de inserción calculado coincide con profundidad y margen.
- Una pieza ausente no acepta mediciones silenciosamente.
- Firma vuelve inmutable el examen.
- Corrección conserva el original.
- Optimistic locking rechaza dos ediciones concurrentes.
- Comparación usa las mismas superficies y piezas.
- RLS cubre examen, pieza y sitio.
- La vista funciona con teclado y lector de pantalla.

## 8. Módulo 3 — Plan de tratamiento compartible, aceptación y firma

### 8.1. Objetivo

Extender `presupuestos` sin duplicarlo para que el paciente pueda revisar, aceptar o rechazar un plan desde un enlace seguro y para que la clínica mida la conversión.

### 8.2. Alcance MVP

- Publicar una versión congelada de un presupuesto presentado.
- Compartir por correo/WhatsApp utilizando la outbox.
- Mostrar clínica, profesional, fases, piezas, cantidades, precios, total, vigencia y notas aprobadas para el paciente.
- Aceptación total o por alternativas mutuamente excluyentes; no permitir aceptación arbitraria de partidas si el presupuesto no fue diseñado para ello.
- Rechazo con motivo opcional.
- Firma electrónica simple con evidencia.
- Descargar/imprimir copia.
- Solicitar una cita desde el plan.
- Preparar el punto de extensión para anticipo.

### 8.3. Modelo de datos — migración `0049_treatment_plan_portal.sql`

#### Cambios a `presupuestos`

- `version` integer;
- `published_version` integer nullable;
- `public_token_hash` text nullable;
- `public_token_expires_at` timestamptz nullable;
- `public_token_revoked_at` timestamptz nullable;
- `presented_at` timestamptz nullable;
- `presentation_snapshot` jsonb nullable.

El snapshot contiene únicamente los datos que el paciente puede ver y congela el documento presentado. Nunca renderizar públicamente desde filas que después puedan cambiar.

#### `treatment_plan_decisions`

- `id`, `tenant_id`, `presupuesto_id`;
- `published_version`;
- `decision`: `accepted`, `rejected`;
- `actor_type`: `patient`, `guardian`, `staff`;
- `actor_name`;
- `signature_storage_key` nullable;
- `evidence_hash`;
- `notice_version`;
- `ip_hash` o IP cifrada según decisión legal;
- `user_agent_hash`;
- `decided_at`;
- `revoked_at` nullable y motivo.

Las decisiones son append-only.

#### `treatment_plan_delivery_events`

Relaciona presupuesto, versión, mensaje de outbox y resultado de entrega. No copiar destinos completos.

### 8.4. Firma y evidencia

La firma dibujada por sí sola no demuestra identidad. Para el MVP almacenar:

- hash del snapshot exacto aceptado;
- nombre declarado;
- timestamp del servidor;
- versión del aviso;
- hash de contexto técnico aprobado por legal;
- opcionalmente trazo PNG privado;
- evento de envío y entrega del enlace;
- relación con paciente y presupuesto.

No anunciar “firma avanzada” ni equivalencia jurídica específica sin revisión legal.

### 8.5. API

Administración:

```text
POST /presupuestos/:id/publish
POST /presupuestos/:id/share
POST /presupuestos/:id/revoke-link
GET  /presupuestos/:id/decision-history
```

Pública:

```text
GET  /public/treatment-plans/:token
POST /public/treatment-plans/:token/accept
POST /public/treatment-plans/:token/reject
POST /public/treatment-plans/:token/request-appointment
```

### 8.6. Frontend

- Botón “Presentar y compartir” en `presupuesto-panel`.
- Historial de versiones y entregas.
- `/plan/:token` sin `AppShell`, móvil primero.
- Resumen por fases y piezas.
- Confirmación explícita antes de aceptar/rechazar.
- Checkbox de aviso y nombre del firmante.
- Descarga/imprimir copia.
- Estado visible: vigente, aceptado, rechazado, vencido o reemplazado.

### 8.7. Pruebas de aceptación

- El paciente ve exactamente el snapshot publicado.
- Editar un borrador posterior no altera lo ya aceptado.
- Un token vencido/revocado no permite decidir.
- Escáneres de enlaces no aceptan por hacer `GET`.
- Dos `POST accept` repetidos son idempotentes.
- No se acepta una versión reemplazada.
- El hash de evidencia se puede recalcular.
- Aceptar ejecuta una transición válida de `Presupuesto`.
- RLS y resolución pública no permiten enumerar tenants.

## 9. Módulo 4 — Formularios y portal ligero del paciente

### 9.1. Decisión de alcance

No construir inicialmente cuentas y contraseñas para pacientes. Crear un portal ligero por invitaciones de propósito limitado. Esto reduce soporte, recuperación de credenciales y riesgo de mezclar expedientes familiares.

Unificar bajo una página pública:

```text
/paciente/:token
  - completar formularios pendientes
  - revisar y administrar próxima cita
  - consultar planes compartidos
  - firmar consentimientos asignados
  - pagar anticipo cuando el módulo esté habilitado
```

Cada acción debe seguir autorizándose por recurso; el token del hub no debe dar acceso ilimitado al expediente.

### 9.2. Modelo de datos — migración `0050_patient_forms_portal.sql`

#### `form_templates`

- `id`, `tenant_id`, `name`, `purpose`;
- `schema_version`;
- `json_schema` con tipos de campo permitidos;
- `ui_schema` sin HTML arbitrario;
- `status`: `draft`, `published`, `retired`;
- `published_at`, timestamps.

#### `form_assignments`

- `id`, `tenant_id`, `template_id`, `template_version`;
- `patient_id`, `appointment_id` nullable;
- `status`: `pending`, `opened`, `submitted`, `reviewed`, `expired`, `cancelled`;
- `due_at`, `submitted_at`, `reviewed_by`, `reviewed_at`;
- snapshot del esquema publicado.

#### `form_responses`

- `assignment_id`, `tenant_id`;
- respuestas cifradas o JSONB según clasificación;
- `response_hash`;
- `submitted_at`;
- append-only después de enviar.

#### `patient_portal_tokens`

- hash, propósito, paciente, recurso opcional;
- expiración, revocación, usos máximos y usos consumidos;
- `created_by`, timestamps.

### 9.3. Formularios iniciales

- datos personales y contacto;
- antecedentes médicos;
- alergias y medicamentos;
- cuestionario dental;
- autorización de tratamiento/privacidad;
- actualización periódica de antecedentes.

No escribir automáticamente respuestas clínicas en el expediente definitivo. Mostrar una comparación y requerir revisión humana antes de aplicar alergias, medicamentos o antecedentes.

### 9.4. API

```text
GET/POST/PATCH /form-templates
POST           /form-assignments
GET            /form-assignments?patientId=&appointmentId=&status=
POST           /form-assignments/:id/send
POST           /form-assignments/:id/review
GET            /public/patient/:token
GET            /public/forms/:token
PUT            /public/forms/:token/draft
POST           /public/forms/:token/submit
```

### 9.5. Seguridad

- Lista cerrada de componentes de formulario.
- Sanitizar textos; nunca ejecutar HTML/JS de plantillas.
- Límite de tamaño y profundidad JSON.
- CSRF adecuado al mecanismo público empleado.
- No indexar rutas públicas.
- No incluir respuestas en logs, analytics o rastreo de errores.
- Enlace de un solo propósito y duración configurable.
- Invalidar invitación después de submit, salvo modo de borrador definido.

### 9.6. Pruebas de aceptación

- La plantilla publicada queda versionada.
- Modificar una plantilla no altera asignaciones existentes.
- Dos envíos simultáneos no crean respuestas distintas.
- Un paciente no puede abrir asignación ajena.
- Respuesta enviada queda inmutable.
- Aplicar cambios al expediente requiere actor autenticado y auditoría.
- Los logs y errores no contienen respuestas.

## 10. Módulo 5 — Laboratorios dentales

### 10.1. Objetivo

Controlar trabajos externos e internos —coronas, puentes, prótesis, férulas, alineadores y modelos— y alertar antes de una cita si el trabajo no está listo.

### 10.2. Alcance MVP

- Catálogo de laboratorios y contactos.
- Catálogo configurable de tipos de trabajo y materiales.
- Caso relacionado con paciente, odontólogo, presupuesto y cita.
- Piezas FDI, color, material e instrucciones.
- Adjuntos privados.
- Fechas prometida, enviada, requerida y recibida.
- Costo estimado/real y estado de pago informativo.
- Línea de tiempo de estados.
- Alertas por atraso y por cita próxima.
- Hoja imprimible/compartible sin datos innecesarios.

### 10.3. Modelo de datos — migración `0051_dental_labs.sql`

#### `dental_labs`

- `id`, `tenant_id`, `name`;
- contacto normalizado, dirección y notas;
- `active`;
- timestamps.

#### `dental_lab_cases`

- `id`, `tenant_id`, `patient_id`, `doctor_id`;
- `lab_id`, `appointment_id` nullable;
- `presupuesto_id` y `partida_id` nullable;
- `case_type`, `material`, `shade`, `teeth_fdi[]`;
- `instructions`;
- `status`: `draft`, `ordered`, `sent`, `in_progress`, `received`, `quality_check`, `adjustment`, `ready`, `delivered`, `cancelled`;
- fechas operativas;
- `estimated_cost_centavos`, `actual_cost_centavos`;
- `external_reference`;
- timestamps.

#### `dental_lab_case_events`

Append-only: transición, actor, fecha, nota corta y metadata mínima.

#### `dental_lab_attachments`

Metadata de objetos privados: tipo, storage key, MIME, tamaño, hash y autor.

### 10.4. Máquina de estados

```text
draft → ordered → sent → in_progress → received → quality_check → ready → delivered
                          ↑                    └──→ adjustment ───────┘
cualquier estado no terminal → cancelled
```

Reglas:

- no marcar `ready` sin recepción y control de calidad;
- un ajuste no borra el ciclo anterior;
- conservar costo estimado y real;
- impedir `delivered` sin paciente y trabajo válido;
- alertar si `required_at` está cerca y el estado no es `ready`;
- al mover una cita, conservar el caso y recalcular sólo alertas, no fechas prometidas;
- una hoja enviada se versiona si las instrucciones cambian.

### 10.5. API y UI

```text
GET/POST/PATCH /dental-labs
GET/POST       /dental-lab-cases
GET/PATCH      /dental-lab-cases/:id
POST           /dental-lab-cases/:id/transition
POST           /dental-lab-cases/:id/attachments/upload-url
POST           /dental-lab-cases/:id/attachments/confirm
GET            /dental-lab-cases/alerts
```

- `/laboratorios`: tablero por estado y fecha requerida.
- Panel dentro del expediente y del presupuesto.
- Indicador en calendario si una cita depende de un caso no listo.
- Vista imprimible de orden y etiqueta de envío.

### 10.6. Pruebas de aceptación

- Estados inválidos son rechazados en dominio.
- Adjuntos nunca tienen URL pública permanente.
- Caso atrasado aparece en alertas.
- Cita próxima muestra advertencia si el caso no está listo.
- Un ajuste conserva todos los eventos previos.
- Costos no son visibles para roles sin permiso financiero.
- RLS cubre laboratorios, casos, eventos y adjuntos.

## 11. Módulo 6 — Inventario dental

### 11.1. Objetivo

Controlar existencias, lotes, caducidades, compras y consumo clínico con un ledger inmutable. El stock no debe ser una cifra editable sin explicación.

### 11.2. Alcance MVP

- Productos e insumos.
- Categorías y unidades.
- Proveedores.
- Una bodega principal por clínica, preparado para varias.
- Entradas, consumos, ajustes, mermas, devoluciones y transferencias.
- Lotes y caducidad.
- Stock mínimo y alertas.
- Órdenes de compra básicas.
- Kits por servicio/procedimiento.
- Consumo sugerido al completar una partida, siempre confirmado por usuario en MVP.
- Costo promedio y valorización.

No implementar contabilidad general ni facturas de proveedor en este módulo.

### 11.3. Modelo de datos — migración `0052_dental_inventory.sql`

Tablas:

- `inventory_categories`;
- `inventory_units`;
- `inventory_items`;
- `inventory_suppliers`;
- `inventory_warehouses`;
- `inventory_lots`;
- `inventory_movements`;
- `inventory_movement_lines`;
- `inventory_purchase_orders`;
- `inventory_purchase_order_lines`;
- `inventory_kits`;
- `inventory_kit_items`.

Campos importantes de `inventory_items`:

- SKU único por tenant;
- nombre y descripción;
- unidad base;
- controla lote/caducidad;
- stock mínimo;
- costo de referencia;
- activo.

Campos importantes de movimientos:

- tipo: `purchase`, `consumption`, `adjustment_in`, `adjustment_out`, `waste`, `return`, `transfer`;
- bodega origen/destino según tipo;
- actor, fecha efectiva y fecha de captura;
- paciente, cita y partida opcionales;
- motivo obligatorio en ajustes/mermas;
- referencia externa;
- estado `draft` o `posted`.

Un movimiento `posted` es inmutable. La corrección crea otro movimiento compensatorio.

### 11.4. Cálculo y concurrencia

- Derivar stock de líneas `posted` o mantener una proyección transaccional verificable.
- Para publicar consumo, bloquear lotes candidatos con `FOR UPDATE`.
- Rechazar stock negativo por defecto.
- Usar FEFO para sugerir primero el lote que vence antes.
- La suma de salidas no puede exceder la disponibilidad del lote.
- Idempotencia por `source_type + source_id + kit_id` para consumos sugeridos desde procedimientos.
- Nunca usar `float`; cantidades deben ser `numeric` con escala definida por unidad.

### 11.5. API

```text
GET/POST/PATCH /inventory/items
GET/POST/PATCH /inventory/suppliers
GET/POST/PATCH /inventory/warehouses
GET            /inventory/stock
GET            /inventory/alerts
POST           /inventory/movements
POST           /inventory/movements/:id/post
POST           /inventory/movements/:id/reverse
GET/POST/PATCH /inventory/purchase-orders
POST           /inventory/purchase-orders/:id/receive
GET/POST/PATCH /inventory/kits
POST           /inventory/consume-kit
```

### 11.6. Frontend

- `/inventario`: existencias y alertas.
- `/inventario/movimientos`: ledger y captura.
- `/inventario/compras`: órdenes y recepción.
- `/ajustes/inventario`: categorías, unidades, bodegas, proveedores y kits.
- Modal desde consulta/partida terminada para confirmar consumo sugerido.

### 11.7. Alertas

- stock bajo;
- agotado;
- lote vence en 30/60/90 días;
- orden atrasada;
- consumo anormal respecto al kit;
- movimiento en borrador sin publicar.

Las alertas internas no deben enviarse por el canal del paciente.

### 11.8. Pruebas de aceptación

- Dos consumos concurrentes no dejan stock negativo.
- FEFO selecciona el lote correcto.
- Reverso compensa sin borrar el original.
- Recepción parcial conserva saldo de orden.
- Consumo de kit repetido con la misma fuente es idempotente.
- Los costos quedan ocultos para roles no autorizados.
- RLS cubre todas las tablas.
- Exportación de stock reconcilia con el ledger.

## 12. Módulo 7 — Pagos y anticipos en línea

### 12.1. Decisión técnica

Crear un puerto `PatientPaymentProvider`; no acoplar dominio a Stripe, Mercado Pago u otro proveedor.

```ts
interface PatientPaymentProvider {
  createCheckout(input: CreatePatientCheckout): Promise<CheckoutResult>;
  refund(input: RefundPatientPayment): Promise<RefundResult>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): VerifiedPaymentEvent;
}
```

Adaptadores iniciales:

- `FakePatientPaymentProvider` para pruebas;
- un proveedor real seleccionado para el mercado mexicano;
- no reutilizar `StripeService` de suscripciones sin separar cuentas, webhooks, productos y responsabilidades.

### 12.2. Alcance MVP

- Anticipo de cita o presupuesto.
- Link de pago público con monto calculado por backend.
- Estados: creado, pendiente, pagado, fallido, vencido, reembolsado, disputado.
- Webhook firmado e idempotente.
- Registro automático en abonos y caja sólo cuando el proveedor confirma pago.
- Reembolso total inicial; parcial en iteración posterior.
- Conciliación diaria de pagos sin webhook o webhooks sin pago local.

### 12.3. Modelo de datos — migración `0053_patient_payments.sql`

- `patient_payment_intents`;
- `patient_payment_events` append-only;
- `patient_payment_refunds`;
- `payment_webhook_events`;
- `payment_reconciliation_runs`.

Cada intent debe incluir tenant, paciente, cita/presupuesto, propósito, importe, moneda, proveedor, idempotency key, ID externo, estado y expiración.

### 12.4. Reglas críticas

- Nunca aceptar monto desde el navegador como fuente de verdad.
- No guardar PAN, CVV ni secretos del proveedor.
- Un webhook repetido no duplica abono ni movimiento de caja.
- Un pago confirmado fuera de tiempo se registra y va a conciliación; no se pierde.
- Cancelar cita no reembolsa automáticamente sin política explícita.
- Los anticipos deben mostrar política de cancelación antes de pagar.
- El dinero del paciente no debe mezclarse con la suscripción SaaS de HealthFlow.

### 12.5. API/UI y pruebas

```text
POST /public/appointments/:token/payment-intents
POST /public/treatment-plans/:token/payment-intents
GET  /public/payments/:token/status
POST /webhooks/payments/:provider
GET  /payments?status=&from=&to=
POST /payments/:id/refund
GET  /payments/reconciliation
```

Probar firma incorrecta, repetición, llegada adelantada, timeout ambiguo, pago tardío, monto adulterado, devolución y creación atómica de abono/caja.

## 13. Módulo 8 — Reportes dentales y comisiones

### 13.1. Problema actual

`ReportsStats` sólo expone diagnósticos frecuentes, productividad de médicos y tendencia mensual. Se necesita una capa analítica dental con definiciones estables y trazables.

### 13.2. KPIs prioritarios

Agenda:

- citas agendadas, confirmadas, canceladas y no-show;
- ocupación de horas disponibles;
- utilización por profesional;
- tiempo en espera;
- reservas públicas y conversión a asistencia.

Pacientes:

- nuevos, recurrentes y reactivados;
- pacientes sin próxima cita;
- recall vencido y tasa de recuperación;
- origen/referido.

Tratamientos:

- presupuestos presentados, aceptados y rechazados;
- valor presentado y aceptado;
- tasa de aceptación por importe y por paciente;
- partidas pendientes, en proceso y terminadas;
- tiempo entre aceptación e inicio;
- tratamientos abandonados.

Finanzas:

- producción clínica;
- cobranza recibida;
- saldo por cobrar y antigüedad;
- reembolsos;
- ingresos por método;
- costo de laboratorio;
- consumo y costo de inventario;
- margen contribución estimado.

### 13.3. Definiciones obligatorias

Documentar para cada KPI:

- evento o fecha que lo atribuye;
- zona horaria;
- filtros de estado;
- si cuenta pacientes, citas, partidas o dinero;
- tratamiento de cancelaciones y reembolsos;
- periodo de comparación;
- permisos.

Ejemplo: “producción” debe definirse como partidas marcadas terminadas en el periodo, no como presupuestos aceptados ni efectivo cobrado.

### 13.4. Comisiones — migración `0054_provider_commissions.sql`

Tablas:

- `commission_rules` versionadas;
- `commission_rule_services` o filtros por categoría;
- `commission_periods`;
- `commission_entries`;
- `commission_adjustments`;
- `commission_approvals`.

Soportar inicialmente:

- porcentaje de producción;
- porcentaje de cobranza;
- monto fijo por servicio;
- exclusión o descuento de laboratorio/materiales;
- vigencia desde/hasta;
- regla predeterminada y override por profesional/servicio.

Una liquidación aprobada se congela. Correcciones posteriores son ajustes en el siguiente periodo o una reapertura auditada por admin.

No llamar a esto “nómina” ni calcular ISR, IMSS o recibos laborales en el MVP.

### 13.5. Implementación analítica

Etapa 1:

- consultas SQL explícitas y bien indexadas;
- rangos máximos razonables;
- exportación CSV;
- misma función/consulta para tarjeta y exportación.

Etapa 2, sólo cuando el volumen lo exija:

- vistas materializadas o tablas de hechos;
- refresh incremental desde eventos;
- reconciliación con tablas origen;
- fecha de última actualización visible.

No introducir un data warehouse para los primeros pilotos.

### 13.6. API y UI

```text
GET /reports/dental/overview
GET /reports/dental/schedule
GET /reports/dental/patients
GET /reports/dental/treatments
GET /reports/dental/finances
GET /reports/dental/export.csv
GET/POST/PATCH /commissions/rules
POST /commissions/periods/calculate
GET  /commissions/periods/:id
POST /commissions/periods/:id/approve
POST /commissions/periods/:id/adjustments
```

### 13.7. Pruebas de aceptación

- Cada tarjeta concilia con filas origen de fixtures conocidos.
- Periodos locales incluyen correctamente límites de día y DST.
- No-show no cuenta como producción.
- Presupuesto aceptado no cuenta como cobrado.
- Reembolso reduce cobranza sin borrar pago.
- Regla nueva no cambia liquidación aprobada.
- Exportación y UI devuelven los mismos totales.
- Asistente no puede consultar costos, margen ni comisiones.

## 14. Integraciones y eventos internos

Definir eventos de aplicación tipados. No es necesario introducir Kafka; pueden persistirse en una tabla outbox interna y procesarse por el worker actual.

Eventos mínimos:

```text
appointment.scheduled
appointment.cancelled
appointment.no_show
appointment.completed
treatment_plan.presented
treatment_plan.accepted
treatment_item.completed
periodontal_exam.signed
recall.due
recall.scheduled
lab_case.status_changed
inventory.movement_posted
patient_payment.succeeded
patient_payment.refunded
```

Consumidores:

| Evento | Consumidor |
|---|---|
| `appointment.scheduled` | cerrar recall compatible |
| `appointment.cancelled` | reabrir recall si no hay reemplazo |
| `appointment.no_show` | crear candidato de reactivación |
| `treatment_item.completed` | sugerir inventario y calcular producción |
| `periodontal_exam.signed` | ofrecer recall periodontal |
| `treatment_plan.accepted` | permitir anticipo y medir conversión |
| `lab_case.status_changed` | alertas de agenda y costo real |
| `patient_payment.succeeded` | abono, caja y cobranza |

Cada evento debe tener `event_id`, tenant, tipo, entidad, versión, fecha y payload mínimo sin PHI innecesaria. Consumidores idempotentes por `event_id + consumer`.

## 15. Contratos compartidos y frontend

Agregar tipos públicos a `packages/shared-types/src/index.ts`, manteniendo:

- fechas como ISO strings;
- dinero como centavos enteros o strings cuando pueda exceder precisión segura de JS;
- unions cerradas para estados;
- respuestas separadas de requests;
- vistas públicas distintas de vistas autenticadas;
- cero tipos `any` en contratos nuevos.

Extender `apps/web/lib/api.ts` por módulo. Si el archivo crece demasiado, dividir sin cambiar de golpe todos los consumidores:

```text
apps/web/lib/api/
  client.ts
  recalls.ts
  periodontal.ts
  treatment-plans.ts
  forms.ts
  labs.ts
  inventory.ts
  payments.ts
  reports.ts
```

Mantener el export `api` compatible durante la migración.

## 16. Migraciones propuestas

| Migración | Contenido | Estado |
|---|---|---|
| `0046_fundaciones_dentales.sql` | feature flags por tenant, outbox interna de eventos y consumiciones idempotentes | **Aplicada** |
| `0047_module_entitlements.sql` | derechos contratados, interruptor de rollout y reconciliación de eventos aplazados | **Aplicada** |
| `0048_dental_recalls.sql` | tipos, recalls e intentos | Pendiente |
| `0049_outbox_polimorfica.sql` | mensajes de recall en la outbox existente | Pendiente |
| `0050_periodontal_charting.sql` | exámenes, piezas y sitios | Pendiente |
| `0051_treatment_plan_portal.sql` | snapshots, tokens y decisiones | Pendiente |
| `0052_patient_forms_portal.sql` | plantillas, asignaciones, respuestas y tokens | Pendiente |
| `0053_dental_labs.sql` | laboratorios, casos, eventos y adjuntos | Pendiente |
| `0054_dental_inventory.sql` | catálogo, lotes, ledger, compras y kits | Pendiente |
| `0055_patient_payments.sql` | intents, eventos, reembolsos y webhooks | Pendiente |
| `0056_provider_commissions.sql` | reglas, periodos, entradas y aprobaciones | Pendiente |

La migración compensatoria de cada una vive en `apps/api/src/db/migrations/rollback/` — un
directorio que el runner ignora a propósito (solo lee `*.sql` del nivel superior), y que se
ejecuta a mano como rol admin.

Cada migración debe incluir:

- comentarios de intención;
- constraints y máquinas de estado en SQL cuando sea posible;
- índices de consultas documentadas;
- RLS y grants;
- estrategia de backfill;
- compatibilidad con despliegue gradual;
- prueba de aplicar sobre base limpia y base migrada;
- prueba de ejecutar `db:seed` dos veces si la semilla cambia.

## 17. Estrategia de pruebas

### 17.1. Dominio

Pruebas unitarias para máquinas de estado, cálculos, firmas/hash, stock, FEFO, comisiones y recalls. Deben correr sin red ni PostgreSQL.

### 17.2. Integración PostgreSQL

- RLS entre dos tenants.
- constraints e índices únicos.
- concurrencia real.
- funciones y triggers.
- transacciones que actualizan negocio y auditoría.
- claims con `SKIP LOCKED` si se agregan workers.

### 17.3. API

- permisos por rol;
- validación DTO;
- 404/409/422 coherentes;
- rate limits públicos;
- tokens vencidos, alterados y revocados;
- idempotencia de POST públicos y webhooks.

### 17.4. E2E web

Flujos obligatorios:

1. completar formulario → recepción revisa → expediente actualizado;
2. crear periodontograma → firmar → comparar;
3. presentar presupuesto → paciente acepta → solicita cita;
4. pagar anticipo → webhook → abono/caja;
5. terminar partida → confirmar consumo → stock actualizado;
6. crear trabajo de laboratorio → recibir → cita muestra listo;
7. vencer recall → enviar → reservar → cerrar recall;
8. calcular comisión → aprobar → conservar snapshot.

### 17.5. Seguridad y privacidad

- intentos de acceso cruzado por tenant;
- enumeración pública;
- inyección en plantillas y notas;
- MIME/tamaño/hash de archivos;
- firmas de webhook;
- PII/PHI ausente en logs;
- autorización de costos y comisiones;
- borrado físico bloqueado en documentos inmutables.

## 18. Plan de entrega sugerido

### Fase A — Fundaciones, 1 semana — **HECHA (2026-09-11)**

- [x] Feature flags por clínica — `tenant_feature_flags`, `common/feature-flags/`,
      `FeatureFlagInterceptor` (404 `ModuloNoDisponible`), pantalla en `/ajustes` › Módulos.
      Ausencia de fila = apagado; apagar no borra datos.
- [x] Subjects CASL — 8 subjects y 4 acciones nuevas (`firmar`, `contactar`, `costear`,
      `aprobar`); la matriz §5.7 se prueba como tabla en `matriz-dental.domain.spec.ts`.
- [x] Eventos internos idempotentes — `app_events` (append-only) + `app_event_consumptions`
      con `PRIMARY KEY (event_id, consumer)`, `claim_app_events` / `complete_app_event`,
      `AppEventsDispatcher` en el worker. Efecto exactamente-una-vez: manejador y cierre del
      reclamo en la misma transacción.
- [x] Helpers para tokens públicos — `common/security/token-publico.ts`: 256 bits, solo hash
      en base, propósito/vigencia/revocación/usos, y una respuesta de rechazo idéntica para
      las seis causas (no permite enumerar).
- [x] Clasificación de datos y reglas de logging — `common/privacidad/datos-sensibles.ts`,
      aplicada en `AuditService.record` y en la emisión de eventos.
- [x] Fixtures multi-tenant — `test/fundaciones-dentales.integration.spec.ts` levanta dos
      clínicas y verifica RLS, append-only, exclusión del reclamo y backoff.

Decisiones y alternativas descartadas: `docs/adr/0003-fundaciones-modulos-dentales.md`.

### Fase B — Conversión y retorno, 2–3 semanas

- Recall/reactivación.
- Publicación y aceptación de presupuesto.
- Portal ligero.
- Formularios iniciales.

Se puede pilotear al terminar esta fase.

### Fase C — Clínica dental avanzada, 2 semanas

- Periodontograma.
- Integración con expediente, presupuesto y recall.

Validar UX con al menos dos odontólogos antes de firmar el esquema definitivo.

### Fase D — Operación, 3 semanas

- Laboratorios dentales.
- Inventario, lotes, compras y kits.
- Alertas integradas.

### Fase E — Ingresos y gestión, 2–3 semanas

- Proveedor de pagos.
- Anticipos y conciliación.
- Reportes dentales.
- Comisiones.

Las estimaciones son de orden relativo. Cada fase debe desplegarse detrás de flags y validarse antes de iniciar una expansión grande del siguiente módulo.

## 19. Definición global de terminado

Un módulo no está terminado sólo porque tenga una pantalla. Debe cumplir:

- [ ] migración reproducible y reversible mediante una migración compensatoria;
- [ ] RLS probado con dos tenants;
- [ ] permisos CASL definidos y probados;
- [ ] entidad/reglas de dominio con pruebas;
- [ ] repositorio y casos de uso transaccionales;
- [ ] auditoría de mutaciones sensibles;
- [ ] API documentada y DTOs validados;
- [ ] contratos compartidos sin `any`;
- [ ] estados vacíos, loading, error y conflicto en frontend;
- [ ] accesibilidad básica de teclado y lector;
- [ ] logs sin PII/PHI;
- [ ] métricas operativas y alertas;
- [ ] E2E del flujo principal;
- [ ] documentación de soporte;
- [ ] flag por tenant y rollback probado;
- [ ] validación con clínica piloto;
- [ ] checklist de aceptación específico completado.

## 20. Instrucciones para la IA implementadora

1. Leer completos antes de editar:
   - `README_VERSION_VENDIBLE.md`;
   - `docs/adr/0001-instrumentos-graficos-especialidad.md`;
   - `docs/adr/0002-diseno-tecnico-version-vendible.md`;
   - `apps/api/src/app.module.ts`;
   - `apps/api/src/modules/auth/casl/ability.factory.ts`;
   - `apps/api/src/common/tenant-context/tenant-db.service.ts`;
   - `apps/api/src/common/audit/audit.service.ts`;
   - módulos `presupuestos`, `consentimientos`, `radiografias`, `messaging` y `public-booking`.
2. Revisar `git status` y preservar cambios ajenos.
3. Confirmar el siguiente número de migración; no confiar ciegamente en los números de este documento.
4. Implementar un solo vertical slice por cambio: migración → dominio → repo → caso de uso → API → frontend → pruebas.
5. No crear todos los esquemas primero y dejar funcionalidad incompleta.
6. No reutilizar el módulo de órdenes de plantillas de podología para laboratorio dental.
7. No modificar documentos firmados ni movimientos publicados.
8. No acoplar pagos, archivos o mensajería a un proveedor concreto dentro del dominio.
9. Ejecutar después de cada slice:

   ```bash
   pnpm lint
   pnpm test
   pnpm build
   ```

10. Ejecutar integración con PostgreSQL real antes de marcarlo terminado.
11. Documentar decisiones no contempladas mediante ADR.
12. Actualizar este README marcando criterios, pero no borrar pendientes ni evidencia histórica.

## 21. Qué no construir todavía

- Diagnóstico periodontal automático.
- Análisis radiográfico con IA sin validación clínica y regulatoria.
- PACS/DICOM completo y drivers de equipos.
- Nómina fiscal mexicana.
- Contabilidad general.
- Seguros y clearinghouse internacional.
- App móvil nativa.
- Teleodontología.
- Ortodoncia completa.
- Marketplace de laboratorios.
- Automatizaciones de marketing masivo.

Estos elementos se reconsideran después de datos de uso y ventas de los módulos prioritarios.

## 22. Métricas del piloto

- ≥30% de recalls contactados convierten a reserva en 30 días.
- ≥40% de presupuestos compartidos reciben decisión digital.
- Aumento medible de aceptación de tratamientos.
- ≥80% de formularios asignados se completan antes de la consulta.
- Cero modificaciones de documentos firmados.
- Cero accesos cruzados entre tenants.
- Cero duplicados de mensajes, pagos o consumos.
- ≥95% de casos de laboratorio listos antes de su cita asociada.
- Diferencia de inventario menor al objetivo acordado con la clínica piloto.
- Reportes y exportaciones concilian con movimientos origen.

## 23. Referencias de producto consultadas

- [Dentalink México — funcionalidades](https://www.softwaredentalink.com/mx/)
- [Open Dental — Recall List](https://www.opendental.com/manual/recalllist.html)
- [Open Dental — Lab Cases](https://opendental.com/site/0_labcases.html)
- [CareStack — Dental Software Features](https://carestack.com/dental-software/features)
- [Curve Dental — Feature Overview](https://www.curvedental.com/feature-overview)

Estas referencias sirven para identificar capacidades esperadas por el mercado. No deben copiarse interfaces, textos, modelos propietarios ni reglas sin validarlas con usuarios de HealthFlow.
