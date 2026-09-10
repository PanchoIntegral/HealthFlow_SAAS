# HealthFlow: plan de trabajo para completar la primera versión vendible

> Documento de ejecución para una IA o equipo de desarrollo.
>
> Estado de referencia: 10 de septiembre de 2026.
> Mercado inicial: consultorios y clínicas dentales en México.

## 1. Objetivo

Completar una versión de HealthFlow que pueda venderse y operarse con 3 a 5 clínicas piloto sin depender de intervención técnica diaria.

El flujo comercial que debe funcionar de punta a punta es:

```text
Configuración de clínica
  -> publicación de agenda
  -> reserva del paciente
  -> confirmación automática
  -> recordatorios
  -> confirmación, cancelación o reprogramación
  -> atención clínica
  -> cobro y medición del resultado
```

La primera versión vendible no necesita igualar todos los módulos de Huli, Dentalink, AgendaPro o Doctoralia. Debe resolver con alta confiabilidad la agenda, comunicación, expediente dental y operación básica de un consultorio mexicano.

## 2. Alcance y reglas no negociables

- Mantener aislamiento multi-tenant mediante RLS.
- La API normal debe usar `healthflow_app`; el worker debe usar `healthflow_worker`.
- No registrar teléfonos, correos, tokens públicos, cuerpos de mensajes ni datos clínicos en logs.
- WhatsApp, correo y webhooks nunca deben incluir motivo, servicio, diagnóstico, tratamiento o cualquier dato clínico.
- Las citas canceladas se conservan; nunca se eliminan para representar una cancelación.
- La creación de paciente, cita, auditoría y outbox debe permanecer en una sola transacción.
- Los cambios de base de datos deben añadirse como migraciones nuevas. No modificar migraciones ya aplicadas.
- La siguiente migración debe comenzar en `0045_*.sql` (0042 a 0044 aplicadas en Sprint 1).
- Mantener las APIs públicas sin `tenantId` y sin respuestas que permitan enumerar pacientes.
- No integrar Google Calendar ni anticipos hasta completar todos los bloqueadores P0.
- Usar feature flags por tenant para desplegar cambios de riesgo.
- Todo cambio debe incluir pruebas proporcionales al riesgo.

## 3. Estado actual comprobado

Ya existen:

- Reserva pública por clínica, servicio y profesional.
- Opción de asignar al primer profesional disponible.
- Prevención de traslapes mediante PostgreSQL.
- Configuración de horarios semanales y excepciones.
- Límite de anticipación, horizonte y cancelación.
- Página pública para confirmar, cancelar y reprogramar.
- Outbox PostgreSQL con reintentos y dead-letter.
- Adaptadores fake, Twilio y Resend.
- Webhooks firmados de Twilio y Resend.
- Panel de entregas fallidas y métricas iniciales.
- Consentimiento de WhatsApp y versión del aviso aceptado durante la reserva.
- Directorio público de clínicas y especialidades.
- Expediente, odontograma, recetas, radiografías, consentimientos, presupuestos, caja y facturación.
- Control de suscripción, auditoría y RLS.
- CI con PostgreSQL, typecheck, pruebas y build.

Validación realizada al elaborar este documento:

- `pnpm lint`: exitoso, con tres advertencias no bloqueantes.
- `pnpm build`: exitoso para API y web.
- Pruebas de dominio: aprobadas.
- Suite completa local: no pudo verificar integración porque PostgreSQL no estaba disponible. El CI debe ser la fuente inmediata de verdad hasta levantar la base local.

## 4. Definición de versión vendible

No declarar la versión vendible hasta cumplir todos estos puntos:

- [ ] Una reserva real produce exactamente una confirmación por el canal autorizado.
- [x] Los recordatorios de 48 y 24 horas se envían como trabajos distintos.
- [x] Ningún reintento normal genera mensajes duplicados.
- [x] Los webhooks repetidos o adelantados no pierden ni duplican estados.
- [x] El paciente sólo puede elegir horarios realmente disponibles al reprogramar.
- [x] No se puede reprogramar una cita cancelada, finalizada o marcada como no-show.
- [ ] La clínica puede capturar y actualizar correo, canal preferido y consentimiento de pacientes internos.
- [ ] El aviso de privacidad puede abrirse y leerse antes de aceptarlo.
- [x] Las métricas usan citas únicas y el mismo periodo de medición.
- [ ] Existe monitoreo de API, worker, outbox y webhooks.
- [ ] Existe respaldo automático y se ha probado una restauración.
- [ ] El flujo completo pasa pruebas E2E y de concurrencia en CI.
- [ ] Hay un proceso documentado de alta, soporte y baja de una clínica.
- [ ] Se completaron credenciales productivas, dominio de correo y plantillas aprobadas.

---

# Fase P0: bloqueadores técnicos y legales

## P0.1. Corregir idempotencia de correo y trazabilidad del proveedor

### Problema

`LiveMessagingProvider.resend()` construye la clave con `kind + manageUrl`. Dos recordatorios de una misma cita comparten ambos valores, así que el proveedor puede tratarlos como el mismo envío.

### Cambios

- Añadir `idempotencyKey` a `ProviderMessage`.
- Hacer que `claim_outbound_messages()` devuelva `idempotency_key`.
- Pasar esa clave desde `MessagingWorker` al proveedor.
- Usar esa clave directamente en `Idempotency-Key` de Resend.
- No derivar claves nuevas dentro del adaptador.
- Mantener una clave diferente para confirmación, cada recordatorio, reprogramación y cancelación.

### Archivos probables

- `apps/api/src/modules/messaging/messaging.types.ts`
- `apps/api/src/modules/messaging/worker.service.ts`
- `apps/api/src/modules/messaging/providers.ts`
- Nueva migración `apps/api/src/db/migrations/0042_messaging_claim_idempotency.sql`

### Pruebas

- Dos recordatorios de 48 h y 24 h reciben claves diferentes.
- El mismo trabajo reclamado nuevamente conserva la misma clave.
- Resend recibe exactamente la clave guardada en outbox.
- El fake provider permite inspeccionar metadatos sin registrar datos personales.

### Terminado cuando

- [x] No existe ninguna clave de proveedor derivada únicamente de `kind` y `manageUrl`.
- [x] Una prueba demuestra que 48 h y 24 h son envíos distintos.

## P0.2. Manejar entregas ambiguas y carreras de webhooks

### Problema

Un proveedor puede aceptar el mensaje y la aplicación puede fallar antes de guardar su identificador. También puede llegar un webhook antes de que `provider_message_id` quede persistido. Actualmente un webhook sin mensaje asociado puede quedar marcado como procesado y perderse.

### Cambios

- Clasificar fallos del proveedor como:
  - `retryable`: rechazo seguro antes de aceptación o HTTP 429/5xx conocido.
  - `permanent`: destino o plantilla inválida.
  - `uncertain`: timeout o desconexión donde no se sabe si el proveedor aceptó.
- No reintentar automáticamente un resultado `uncertain`; enviarlo a revisión manual para evitar duplicados.
- Guardar en `messaging_webhook_events` el proveedor, ID externo, ID del mensaje del proveedor, tipo, estado y payload mínimo sanitizado.
- Dejar como `pending` un webhook que todavía no encuentra su mensaje.
- Reprocesar webhooks pendientes después de registrar `provider_message_id`.
- Hacer idempotente el reprocesamiento.
- Añadir edad máxima y alerta para webhooks pendientes.

### Archivos probables

- `apps/api/src/modules/messaging/providers.ts`
- `apps/api/src/modules/messaging/worker.service.ts`
- `apps/api/src/modules/messaging/messaging.controller.ts`
- Nueva migración `0043_messaging_uncertain_webhooks.sql`

### Pruebas

- Webhook repetido: un solo efecto.
- Webhook recibido antes de completar el worker: se procesa después.
- Timeout ambiguo de Twilio: no se reenvía automáticamente.
- HTTP 429 o 5xx: aplica backoff y reintenta.
- Rebote permanente o queja: suprime correo futuro.

### Terminado cuando

- [x] No se pierde un webhook por llegar antes que la respuesta del proveedor.
- [x] No se promete exactamente-once donde el proveedor no lo garantiza.
- [x] Los casos inciertos aparecen en el tablero administrativo.

## P0.3. Formalizar la máquina de estados de citas públicas

### Problema

Confirmar varias veces crea múltiples eventos. La reprogramación no rechaza explícitamente todos los estados terminales.

### Cambios

- Definir funciones de dominio para las transiciones públicas.
- Hacer `confirm` idempotente: si ya está confirmada, devolver el resumen sin insertar otro evento.
- Rechazar confirmación de citas canceladas, finalizadas o no-show.
- Rechazar reprogramación de citas canceladas, finalizadas o no-show.
- Hacer cancelación idempotente.
- Definir si una cita ya iniciada puede modificarse; por defecto, rechazarla.
- Al reprogramar:
  - cancelar mensajes pendientes anteriores;
  - cambiar horario y profesional;
  - volver el estado de confirmación a `pendiente`;
  - crear confirmación de reprogramación;
  - crear recordatorios nuevos;
  - registrar auditoría y un único evento.
- Invalidar acciones después del vencimiento del token.

### Archivos probables

- `apps/api/src/modules/public-booking/booking.service.ts`
- Nuevo archivo de dominio en `apps/api/src/modules/public-booking/`
- `apps/api/src/modules/public-booking/booking.domain.spec.ts`

### Matriz mínima de transiciones

| Estado actual | Confirmar | Cancelar | Reprogramar |
|---|---:|---:|---:|
| Agendada, pendiente | Permitido | Permitido si está fuera del límite | Permitido si está fuera del límite |
| Agendada, confirmada | Sin cambio | Permitido si está fuera del límite | Permitido; vuelve a pendiente |
| Cancelada | Rechazado | Sin cambio | Rechazado |
| Finalizada | Rechazado | Rechazado | Rechazado |
| No-show | Rechazado | Rechazado | Rechazado |

### Pruebas

- Confirmar dos veces crea un solo evento.
- Cancelar dos veces no programa dos avisos.
- Una cita cancelada no se puede reprogramar.
- Una cita finalizada/no-show no se puede administrar.
- Los mensajes pendientes se reconstruyen exactamente una vez.

## P0.4. Reprogramar usando disponibilidad real

### Problema

La página `/cita/[token]` permite escribir fecha y hora manualmente. El backend rechaza horarios inválidos, pero la experiencia no es aceptable para pacientes.

### Cambios

- Crear endpoint público de disponibilidad ligado al token de gestión o reutilizar de forma segura el contrato actual.
- El endpoint debe inferir clínica y servicio desde la cita; nunca exponer `tenantId`.
- Mostrar semanas o calendario dentro del horizonte configurado.
- Mostrar únicamente slots libres.
- Permitir conservar profesional o elegir “cualquiera disponible”.
- Mostrar zona horaria de la clínica.
- Pedir confirmación explícita antes del POST final.
- Si otro paciente ocupa el horario, mostrar disponibilidad actualizada después del HTTP 409.
- Nunca enviar un cambio mediante un simple GET o al abrir un enlace.

### Archivos probables

- `apps/web/app/cita/[token]/page.tsx`
- `apps/web/lib/api.ts`
- `apps/api/src/modules/public-booking/booking.controller.ts`
- `apps/api/src/modules/public-booking/booking.service.ts`
- `packages/shared-types/src/index.ts`

### Pruebas

- E2E móvil y escritorio.
- El selector no presenta slots ocupados ni fuera de ventana.
- Conflicto concurrente devuelve 409 y refresca slots.
- No se revela nombre ni información de otros pacientes.

## P0.5. Validación estricta de datos públicos

### Cambios

- Validar fechas de calendario reales; rechazar, por ejemplo, `2026-02-31`.
- Rechazar fecha de nacimiento futura.
- Definir una edad máxima razonable sin excluir casos legítimos.
- Normalizar correo con `trim().toLowerCase()`.
- Normalizar teléfonos mexicanos de forma consistente y probar prefijos `+52`.
- Requerir correo cuando el canal sea correo.
- Requerir consentimiento cuando el canal sea WhatsApp.
- Forzar `whatsappOptIn=false` cuando el canal sea diferente de WhatsApp.
- Evitar que un nuevo formulario retire accidentalmente un consentimiento histórico que deba conservarse como evidencia; modelar otorgamiento y retiro como eventos o conservar historial.

### Pruebas

- Fechas imposibles, futuras y entradas con espacios.
- Correo requerido por canal.
- Teléfonos nacionales e internacionales válidos e inválidos.
- Historial de otorgamiento/retiro de consentimiento.

## P0.6. Completar contactos y consentimiento en pacientes internos

### Problema

El alta y edición administrativa de pacientes sólo manejan el teléfono, mientras la reserva pública guarda correo, canal y consentimiento. Las citas creadas en recepción no pueden usar de forma completa la mensajería nueva.

### Cambios

- Extender DTO, entidad, repositorio, shared types y UI con:
  - correo;
  - teléfono normalizado;
  - canal preferido;
  - estado del consentimiento de WhatsApp;
  - fecha, versión y origen del consentimiento;
  - retiro de consentimiento;
  - supresión de correo por rebote/queja.
- Programar mensajes también al crear o mover una cita interna cuando exista autorización.
- No enviar mensajes al editar una cita histórica.
- Mostrar advertencia cuando el canal elegido no tenga destino o consentimiento.
- Permitir resolver la marca `posible_duplicado` desde recepción con auditoría.

### Archivos probables

- `apps/api/src/modules/patients/`
- `apps/api/src/modules/appointments/`
- `apps/web/components/ficha-paciente.tsx`
- `apps/web/app/calendario/page.tsx`
- `packages/shared-types/src/index.ts`
- Nueva migración para historial de consentimiento si se adopta el modelo de eventos.

### Pruebas

- Paciente interno con opt-in recibe mensajes.
- Paciente sin opt-in no recibe WhatsApp.
- Retiro de consentimiento cancela WhatsApp pendiente.
- Cita interna respeta los mismos límites y privacidad que la pública.

## P0.7. Reparar las métricas del embudo

### Problema

Las reservas públicas se cuentan desde eventos de mensajería, las confirmaciones pueden duplicarse y los no-shows no usan el mismo periodo.

### Cambios

- Contar reservas desde `appointments.origen='publico'`.
- Contar citas únicas para confirmación, cancelación y reprogramación.
- Aplicar el mismo rango temporal a todas las métricas.
- Separar métricas de citas y métricas de mensajes.
- Añadir parámetros `from` y `to` con límites razonables.
- Devolver:
  - reservas públicas;
  - confirmaciones únicas;
  - cancelaciones únicas;
  - reprogramaciones únicas;
  - asistencias;
  - no-shows;
  - mensajes programados, enviados, entregados, fallidos y suprimidos;
  - tasa de entrega por canal;
  - tasa de confirmación;
  - tasa de no-show.
- Evitar divisiones entre cero.

### Archivos probables

- `apps/api/src/modules/messaging/messaging.controller.ts`
- `apps/web/app/ajustes/reservas/page.tsx`
- `packages/shared-types/src/index.ts`

### Pruebas

- Reserva con canal “sin avisos” sí aparece.
- Confirmación repetida cuenta una vez.
- No-show fuera del periodo no aparece.
- Cada tenant sólo ve sus cifras.

## P0.8. Aviso de privacidad y documentos contractuales

### Cambios de producto

- Crear una ruta pública legible para el aviso de privacidad integral.
- Crear versión simplificada para la reserva.
- Convertir “Acepto el aviso” en un enlace real que se pueda abrir antes de marcar.
- Permitir configurar o identificar el aviso de privacidad de cada clínica.
- Registrar versión, fecha, origen e IP de la aceptación de forma segura.
- Añadir historial de versiones; nunca sobrescribir el texto aceptado sin trazabilidad.
- Añadir solicitud/exportación de datos por tenant.
- Documentar conservación, baja, exportación y eliminación.

### Documentos que requieren decisión humana y abogado

- Completar razón social, RFC, domicilio, correos y jurisdicción.
- Finalizar aviso integral y simplificado.
- Finalizar convenio de encargado del tratamiento.
- Publicar lista de subencargados.
- Definir precios, IVA, prueba, renovación, cancelación, SLA y soporte.
- Revisar términos con abogado mexicano especializado en datos personales y salud.

### Archivos probables

- `docs/legal/terminos-y-condiciones.md`
- `docs/legal/anexo-riesgo-y-cumplimiento.md`
- Nuevos documentos en `docs/legal/`
- Nuevas rutas públicas en `apps/web/app/`
- Tabla/versionado mediante una nueva migración.

### Terminado cuando

- [ ] No quedan campos `[pendientes]` en documentos publicados.
- [ ] El paciente puede leer el texto exacto que está aceptando.
- [ ] La aceptación puede demostrarse sin guardar datos innecesarios en logs.

---

# Fase P1: experiencia y operación del piloto

## P1.1. Navegación completa del horizonte de reserva

- Añadir controles de semana anterior/siguiente o calendario.
- Consultar máximo siete días por request, pero permitir avanzar hasta `horizonDays`.
- Conservar servicio y profesional al cambiar de semana.
- Mostrar claramente cuando no hay horarios en una semana y permitir continuar.
- Prevenir requests fuera del horizonte tanto en frontend como backend.

## P1.2. CRUD completo de excepciones

- Listar bloqueos por profesional y rango de fechas.
- Crear día completo, rango horario o disponibilidad extraordinaria.
- Editar y eliminar excepciones.
- Mostrar próximos bloqueos en Ajustes.
- Auditar alta, edición y eliminación.
- Evitar excepciones solapadas o contradictorias.

## P1.3. Perfil público confiable de la clínica

- Mostrar logo, nombre, dirección, teléfono público, especialidades e indicaciones.
- Agregar mapa/enlace de ubicación sólo si la clínica lo habilita.
- Mostrar política de cancelación y zona horaria.
- Permitir personalización limitada de color sin afectar accesibilidad.
- Definir qué campos aparecen en directorio y cuáles sólo en la página de reserva.
- Nunca publicar datos personales de usuarios administrativos.

## P1.4. Onboarding guiado

Crear un checklist visible para administradores:

1. Completar datos de clínica.
2. Crear o activar profesionales.
3. Crear servicios.
4. Asignar servicios a profesionales.
5. Configurar horarios.
6. Revisar excepciones.
7. Configurar canales y recordatorios.
8. Enviar mensaje de prueba.
9. Revisar aviso de privacidad.
10. Publicar agenda.
11. Copiar enlace o código QR.

El checklist debe usar el endpoint de readiness como fuente de verdad, no estados duplicados en frontend.

## P1.5. Importación inicial asistida

Para pilotos, implementar primero una herramienta interna o CLI segura:

- Importar pacientes desde CSV.
- Importar citas futuras opcionalmente.
- Vista previa y validación antes de escribir.
- Reporte de filas aceptadas, rechazadas y posibles duplicados.
- No asumir consentimiento de WhatsApp durante importación.
- Registrar actor, archivo, fecha y resultado sin conservar el CSV más tiempo del necesario.
- Permitir rollback lógico de una importación fallida cuando no existan dependencias posteriores.

Después de validar pilotos, convertirlo en importador autoservicio.

## P1.6. Observabilidad

Implementar:

- Endpoint de liveness para API.
- Endpoint de readiness que compruebe PostgreSQL.
- Heartbeat del worker.
- Métrica de trabajos pendientes por antigüedad.
- Métrica de mensajes `failed`, `dead` y `uncertain`.
- Métrica de webhooks rechazados y pendientes.
- Logs estructurados con correlation ID, tenant opaco, entidad y código de error.
- Integración con un rastreador de errores.
- Alertas por:
  - API caída;
  - worker sin heartbeat;
  - outbox acumulada;
  - tasa de fallos elevada;
  - ausencia inesperada de webhooks;
  - firmas rechazadas;
  - respaldo fallido.

No incluir PII ni PHI en telemetría.

## P1.7. Respaldos y recuperación

- Configurar backups automáticos cifrados de PostgreSQL.
- Definir retención y región.
- Respaldar metadatos de archivos y objetos clínicos conforme al proveedor usado.
- Documentar RPO y RTO iniciales.
- Ejecutar una restauración en un entorno aislado.
- Verificar conteos, RLS y acceso a archivos después de restaurar.
- Registrar fecha y resultado del simulacro.
- Crear runbook de incidente y responsables.

## P1.8. Centro de ayuda y soporte

- Página “Primeros pasos”.
- Guías de agenda, pacientes, expedientes, cobro y reservas.
- Preguntas frecuentes de WhatsApp, correos y privacidad.
- Canal visible de soporte y horario de atención.
- Flujo para reportar problema con ID de diagnóstico sin compartir datos clínicos.
- Proceso de escalamiento para clínica bloqueada o mensajes fallidos.

---

# Fase P2: integraciones posteriores al piloto

Estas tareas comienzan únicamente cuando P0 está completo y hay al menos dos semanas de datos piloto.

## P2.1. Google Calendar unidireccional

### Alcance inicial

- HealthFlow es la fuente de verdad.
- Crear, mover y cancelar eventos desde HealthFlow hacia Google Calendar.
- Un calendario por profesional.
- Guardar ID externo y estado de sincronización.
- Reintentos idempotentes y desconexión segura.
- Mostrar sólo clínica, fecha, hora y referencia neutral; no incluir información clínica.
- No importar todavía cambios desde Google hacia HealthFlow.

### Fuera de alcance inicial

- Sincronización bidireccional.
- Resolución automática de conflictos externos.
- Múltiples cuentas Google por profesional.

## P2.2. Anticipos con Stripe

### Alcance inicial

- Configuración opcional por servicio: sin anticipo, monto fijo o porcentaje.
- Crear Payment Intent/Checkout asociado a la reserva.
- Estados `pendiente`, `pagado`, `fallido`, `reembolsado` y `expirado`.
- Webhook firmado e idempotente.
- Política visible de devolución/cancelación.
- No marcar una cita como pagada por el retorno del navegador; sólo por webhook.
- Mantener separado el precio informativo del precio clínico final.

Antes de usar Stripe Connect, validar con contador y abogado el modelo de cobro, facturación, comisiones y dispersión.

## P2.3. WhatsApp bidireccional

- Procesar respuestas y opt-out.
- Manejar `STOP`, solicitudes de baja y mensajes inesperados.
- Mostrar que el número es compartido por HealthFlow.
- Enrutar sin revelar otras clínicas.
- Definir horario de atención y respuesta automática.
- No convertir mensajes libres en expediente clínico automáticamente.

## P2.4. Recursos y multi-sucursal

Sólo si los pilotos lo solicitan:

- Consultorios, sillones o gabinetes como recursos reservables.
- Restricción de traslape por recurso.
- Horarios y excepciones por sucursal.
- Profesionales que trabajan en múltiples sedes.
- Reportes por sucursal.

---

# 5. Estrategia de pruebas

## Unitarias y de dominio

- Transiciones de cita.
- Normalización y validación de fecha/teléfono/correo.
- Cálculo de claves de idempotencia.
- Clasificación de errores de proveedor.
- Tasas y denominadores de métricas.

## Integración con PostgreSQL

- RLS en configuración, servicios, citas, pacientes, mensajes y consentimientos.
- Dos reservas concurrentes del mismo horario: sólo una gana.
- Dos workers: una sola reclamación por trabajo.
- Reconstrucción de outbox al mover/cancelar.
- Reproceso de webhook adelantado.
- Supresión por rebote o queja.
- Restricción por plan y suscripción.
- Horario de verano en varias zonas IANA mexicanas.

## E2E

1. Administrador configura y publica clínica.
2. Paciente reserva desde móvil.
3. Se genera confirmación.
4. Worker envía mediante fake/sandbox.
5. Webhook actualiza entrega.
6. Paciente confirma.
7. Paciente reprograma usando un slot real.
8. Mensajes anteriores se cancelan y se crean los nuevos.
9. Recepción ve origen y estado.
10. La métrica refleja cada acción una sola vez.

## Seguridad y privacidad

- Tokens alterados, vencidos o revocados fallan sin revelar existencia.
- Rate limit por IP y ruta pública.
- Firmas incorrectas rechazadas.
- Replay de webhooks sin efectos duplicados.
- Escaneo automatizado del contenido enviado para detectar campos clínicos prohibidos.
- Logs sin correo, teléfono, token, nombre ni cuerpo del mensaje.
- Usuarios no administradores no pueden publicar ni cambiar configuración.

## Carga

- Disponibilidad con al menos 50 usuarios concurrentes.
- Reserva concurrente sobre horarios populares.
- Worker con backlog representativo.
- Webhooks en ráfaga y repetidos.
- Definir y registrar p95 de disponibilidad, reserva y confirmación.

---

# 6. Plan de ejecución recomendado

## Sprint 1: confiabilidad, 5 días hábiles

- [x] P0.1 Idempotencia real.
- [x] P0.2 Entregas ambiguas y carrera de webhooks.
- [x] P0.3 Máquina de estados.
- [x] P0.5 Validación estricta.
- [x] Pruebas unitarias e integración de estos cambios.

Salida: mensajería y estados confiables con fake provider.

## Sprint 2: experiencia y datos, 5 días hábiles

- [x] P0.4 Selector de slots para reprogramar.
- [ ] P0.6 Contactos y consentimientos internos.
- [x] P0.7 Métricas base correctas; desglose avanzado por canal queda como mejora.
- [ ] P1.1 Navegación por horizonte.
- [ ] P1.2 CRUD de excepciones.

Salida: flujo consistente para paciente y recepción.

## Sprint 3: operación y lanzamiento, 5 días hábiles

- [ ] P0.8 Superficie legal; entregar textos a revisión humana.
- [ ] P1.3 Perfil público.
- [ ] P1.4 Onboarding.
- [ ] P1.5 Importador asistido.
- [ ] P1.6 Observabilidad.
- [ ] P1.7 Backups y simulacro de restauración.
- [ ] P1.8 Ayuda y soporte mínimo.
- [ ] E2E, sandbox de proveedores y prueba de carga.

Salida: un tenant interno listo para ensayo controlado.

## Piloto escalonado

1. Tenant interno con fake provider.
2. Tenant interno con Twilio/Resend sandbox o destinatarios autorizados.
3. Una clínica piloto durante 3 a 5 días.
4. Corregir incidentes y revisar métricas.
5. Activar de 2 a 4 clínicas adicionales.
6. Mantener Google Calendar y anticipos detrás de feature flags.

---

# 7. Criterios del piloto

- Entrega de mensajes superior a 95% sobre destinos válidos.
- Cero duplicados confirmados.
- Cero fugas entre tenants.
- Cero datos clínicos en mensajes, webhooks o logs.
- Al menos 30% de las citas públicas confirmadas digitalmente.
- Medición confiable de no-shows antes y después.
- Objetivo inicial: reducir no-shows en 20%.
- Una clínica debe completar onboarding en menos de 60 minutos con asistencia.
- Un paciente debe reservar en menos de 3 minutos desde móvil.
- Incidentes `dead` o `uncertain` visibles para administración.
- Restauración de respaldo completada y documentada.

## Eventos que detienen el piloto

- Mensaje duplicado a un paciente.
- Enlace público que administra la cita incorrecta.
- Traslape de horarios confirmado.
- Exposición de datos entre tenants.
- Datos clínicos en un proveedor de mensajería.
- Pérdida silenciosa de webhook o trabajo de outbox.
- Métricas que no pueden reconciliarse con citas reales.

---

# 8. Instrucciones para la IA que implemente este plan

1. Leer `AGENTS.md`, este documento y la arquitectura existente antes de editar.
2. Revisar `git status` y conservar cambios ajenos.
3. Ejecutar primero:

   ```bash
   pnpm lint
   pnpm --filter @healthflow/api test:domain
   pnpm build
   ```

4. Levantar PostgreSQL y ejecutar las pruebas de integración antes de cambiar código.
5. Implementar una tarea P0 por vez, en el orden de este documento.
6. Crear migraciones nuevas y reversibles; no reescribir migraciones existentes.
7. Actualizar `packages/shared-types` antes de consumir contratos nuevos en API o web.
8. Escribir primero pruebas que reproduzcan cada defecto confirmado.
9. Ejecutar después de cada tarea:

   ```bash
   pnpm lint
   pnpm --filter @healthflow/api test
   pnpm build
   ```

10. No marcar una tarea terminada si sólo compila; deben pasar sus criterios de aceptación.
11. No conectar credenciales reales en pruebas automatizadas.
12. No cambiar alcance hacia inventario, telemedicina, FHIR o contabilidad.
13. Documentar decisiones difíciles en `docs/adr/`.
14. Al finalizar cada bloque, reportar:
    - archivos cambiados;
    - migraciones añadidas;
    - pruebas añadidas y resultados;
    - riesgos restantes;
    - pasos manuales pendientes.

## Orden estricto de implementación

```text
P0.1 -> P0.2 -> P0.3 -> P0.5
                   |
                   +-> P0.4
                   +-> P0.6 -> P0.7

P0 completo -> P1 operación -> piloto -> P2 integraciones
```

## Acciones que requieren intervención humana

La IA debe dejar instrucciones, pero no declarar completadas estas tareas sin evidencia humana:

- Alta y verificación de cuenta Twilio/WABA.
- Aprobación de plantillas de WhatsApp.
- Verificación del dominio y reputación de Resend.
- Revisión jurídica de términos, avisos y convenio de encargado.
- Definición comercial de precios, IVA, prueba, SLA y soporte.
- Elección del proveedor productivo de hosting, monitoreo y backups.
- Selección y consentimiento de clínicas piloto.

---

# 9. Backlog posterior, no bloqueante

- Google Calendar bidireccional.
- Anticipos mediante Stripe Connect.
- Importador CSV autoservicio.
- Periodontograma y ortodoncia avanzada.
- Inventario y laboratorios.
- Comisiones y nómina.
- Telemedicina.
- Contabilidad completa.
- FHIR/HL7.
- Marketplace avanzado.
- Automatizaciones de marketing y NPS.

Estas funciones deben priorizarse con evidencia de pilotos pagados, no por comparación superficial con competidores.

## Resultado esperado

Al completar P0 y P1, HealthFlow debe poder venderse como una plataforma dental mexicana que integra:

```text
reservas 24/7
+ agenda clínica
+ recordatorios y autoservicio
+ expediente y odontograma
+ recetas, archivos y consentimientos
+ presupuestos, caja y facturación
+ métricas operativas
```

La ventaja inicial no será tener más módulos, sino ofrecer un flujo completo, sencillo, seguro y medible para reducir trabajo de recepción y ausencias.
