# ADR 0003. Fundaciones de los módulos dentales (Fase A)

- Estado: aceptado
- Fecha: 2026-09-11
- Contexto de referencia: `README_MODULOS_DENTALES_PRIORITARIOS.md`, secciones 5, 14 y 18 (Fase A)
- Alcance: las piezas transversales que los ocho módulos dentales dan por supuestas — feature flags por clínica, subjects y acciones CASL, eventos internos idempotentes, helpers de tokens públicos y clasificación de datos para bitácora y logs.

No incluye ningún módulo de negocio. Es infraestructura habilitante, deliberadamente construida antes del primer vertical slice porque los ocho módulos la comparten y retrofitearla después obligaría a tocar ocho migraciones.

---

## 1. Verificación previa contra el código

El plan describía el estado del repositorio; se comprobó antes de escribir nada:

| Afirmación del plan | Verificado |
|---|---|
| Última migración `0045_booking_stabilization.sql` | Sí. La Fase A ocupa `0046`; el resto de la numeración del plan (`0047`…`0053`) sigue siendo válida. |
| No existen inventario, laboratorios, periodontograma, recall, portal, formularios, pagos ni comisiones | Sí. `apps/api/src/modules/` no tiene ninguno. |
| `plantillas` es una orden de órtesis de podología | Sí. No se tocó ni se renombró. |
| Estructura `application/ domain/ infrastructure/` por módulo | Parcial. La siguen `presupuestos`, `consentimientos`, `patients`, `clinical-records`…; `messaging` y `public-booking` NO (son servicios planos con SQL crudo). Los módulos dentales seguirán la estructura completa. |

## 2. Decisiones

### 2.1. Los feature flags viven en la base, no en variables de entorno

`tenant_feature_flags(tenant_id, flag, habilitado, …)`, con la **ausencia de fila como apagado**.

Alternativas descartadas:

- **Variable de entorno por flag.** No permite liberar a una clínica sí y a otra no, que es justo lo que pide §5.8, y obliga a un despliegue para apagar durante un incidente.
- **Columna booleana por módulo en `tenants`.** Cada módulo nuevo sería una migración de `ALTER TABLE`, y el histórico de "desde cuándo" no cabría.

El catálogo de nombres vive en `shared-types` (`FEATURE_FLAGS`) y no en un `CHECK` de SQL: agregar un flag no debe costar una migración. El `CHECK` solo valida el formato del nombre.

**Rollback.** Apagar es `UPDATE habilitado=false`; la fila y todos los datos del módulo se conservan. Es lo que exige §5.8 y lo que verifica la prueba de integración.

### 2.2. El flag se aplica con un INTERCEPTOR, no con un guard

Los guards de Nest corren **antes** que los interceptores, y por tanto antes de que `RequestContextInterceptor` abra el `AsyncLocalStorage` con el tenant fijado. Un guard no tiene a quién preguntarle el flag.

`FeatureFlagInterceptor` se registra como `APP_INTERCEPTOR` después de `RequestContextInterceptor` y `SuscripcionInterceptor`: los interceptores globales se anidan en orden de registro, así que corre dentro del contexto de ambos. Es el mismo razonamiento —y el mismo orden frágil a propósito— que ya documenta `SuscripcionInterceptor`.

Va al final de los tres porque una suscripción vencida (402) es una respuesta más útil que un "este módulo no existe" (404).

**Esto no sustituye la verificación en el dominio.** Un caso de uso invocado desde el worker o desde otro módulo no pasa por el interceptor; por eso existe `FeatureFlagsService.asegurarHabilitado(tx, flag)` y los casos de uso sensibles lo llamarán.

**404 y no 403.** Un 403 diría "existe, pero tu rol no alcanza" y mandaría al usuario a pedirle permisos a su administrador en vez de activar el módulo. El `code` `ModuloNoDisponible` es estable para que el frontend distinga.

**Sin caché.** Es una lectura por llave primaria. Cuando haya que apagar un módulo en producción por un incidente, el apagado tiene que valer en la siguiente petición, no en 30 segundos.

### 2.3. Eventos internos: outbox en PostgreSQL, idempotencia en la llave primaria

`app_events` (append-only) + `app_event_consumptions` con `PRIMARY KEY (event_id, consumer)`.

- **Emitir dentro de la transacción del caso de uso.** Si la operación de negocio se revierte, el evento se va con ella. Elimina el "escribí pero no publiqué" y el doble envío del patrón inverso.
- **La idempotencia del §14 ES la llave primaria.** No hay lógica en el worker que se pueda olvidar: reclamar es un `INSERT … ON CONFLICT DO UPDATE … WHERE (reclamo vencido)`; dos workers concurrentes se serializan en el índice único y el segundo no recibe nada.
- **Efecto exactamente-una-vez.** El manejador y `complete_app_event(..., true)` corren en **una sola transacción** del tenant del evento. O se confirman los dos, o ninguno.
- **Cada consumidor avanza por su cuenta.** Que el consumidor de inventario esté roto no detiene al de recalls; el reclamo es por `(evento, consumidor)`.
- **Backoff y muerte.** Un fallo reintenta con `3^n` minutos y a los 8 intentos queda `dead`. Un consumidor roto no gira para siempre sobre el mismo evento.

Alternativas descartadas: Kafka o Redis Streams (§14 lo desaconseja explícitamente y añadiría infraestructura antes del piloto); `NOTIFY/LISTEN` (no sobrevive a un reinicio ni da reintentos); llamadas directas entre módulos (acopla y pierde el reintento).

**`app_events` es append-only de verdad**: `REVOKE UPDATE, DELETE … FROM healthflow_app`. El `GRANT` positivo no basta porque `0001_rls` concede `ALL` sobre el esquema, y una tabla nueva nace con esos permisos — la misma trampa que ya documenta `0029` sobre las tablas insert-only.

### 2.4. El payload de un evento se valida contra una lista de campos prohibidos

§14 pide "payload mínimo sin PHI innecesaria". Una regla escrita en un documento no se cumple sola, así que `asegurarPayloadDeEvento` la hace fallar: claves prohibidas (nombre, correo, teléfono, diagnóstico, notas, mediciones…), texto libre de más de 120 caracteres, anidamiento de más de 3 niveles y 4096 bytes de tope — el mismo que el `CHECK` de la columna.

Para la **bitácora de auditoría** la regla es distinta y más laxa a propósito: la bitácora SÍ debe identificar sobre qué se actuó (nombre, CURP, folio, motivo) y los casos de uso existentes ya lo hacen. Lo que `asegurarDetalleAuditable` prohíbe es lo que §5.3 enumera y que hoy nadie guarda: credenciales, destinos de contacto, firmas y cuerpos completos (nota clínica, payload crudo del PAC o del proveedor de mensajería).

Ambas fallan la transacción en vez de recortar en silencio: un detalle con un token es un bug del caso de uso, y taparlo lo dejaría vivo.

### 2.5. Tokens públicos: un solo módulo, propósito obligatorio y respuesta uniforme

`common/security/token-publico.ts` concentra las reglas de §5.6: 32 bytes de CSPRNG, solo el SHA-256 en la base, validación de formato antes de consultar, comparación en tiempo constante, y `evaluarToken` puro para propósito / vigencia / revocación / usos.

La pieza que no es obvia: **`EnlaceNoValidoError` es idéntico para las seis causas de rechazo**. El motivo real se conserva del lado del servidor para métricas, pero no viaja al cliente — si "vencido" y "no existe" se distinguieran, un atacante podría enumerar pacientes y documentos probando tokens. Hay una prueba que compara las respuestas serializadas y exige que sean una sola.

El token determinista por HMAC que usa la gestión de citas (`public-booking`) se deja como está: cambiarlo invalidaría los enlaces ya enviados a pacientes. Los módulos nuevos usan tokens aleatorios.

### 2.6. Acciones CASL nuevas en vez de estirar `write`

Se agregaron `firmar`, `contactar`, `costear` y `aprobar`. Cada una separa un juicio distinto:

- `firmar` vuelve inmutable un documento clínico — quien captura no necesariamente es quien firma;
- `contactar` deja que recepción ejecute el seguimiento sin poder cambiar cada cuánto debe volver un paciente;
- `costear` separa "ver el caso de laboratorio" de "ver lo que cuesta", que es la línea de la matriz §5.7;
- `aprobar` congela una liquidación de comisiones.

Es el mismo criterio que ya justifica `abonar` sobre `Presupuesto` y `cancel` sobre `Caja` en el código existente.

La matriz completa se prueba como **tabla** en `matriz-dental.domain.spec.ts`, para que un cambio de criterio sea un cambio visible en esa tabla y no un `can(...)` perdido en un `switch` de 200 líneas.

## 3. Consecuencias

- Un módulo dental nuevo solo tiene que: declarar su flag en `FEATURE_FLAGS`, poner `@RequiereFlag` en su controller, usar los subjects ya definidos y registrar sus consumidores con `APP_EVENT_CONSUMER`.
- El worker corre ahora dos ciclos en la misma vuelta (mensajería y eventos internos), con `try/catch` separados para que uno roto no detenga al otro. Cuando un consumidor escriba en tablas de negocio, `healthflow_worker` necesitará los `GRANT` correspondientes: es parte de la migración del módulo que lo introduzca, no de ésta.
- `pnpm test` pasó a `--runInBand`. Ya fallaba de forma intermitente antes de este cambio: las suites de integración comparten una base y varias cuentan filas o reclaman trabajos con `SKIP LOCKED`, así que en paralelo se pisan. En serie las dos suites tardan ~25 s.

## 4. Lo que esta fase NO resuelve

- No hay pantallas ni datos de ningún módulo dental: el primer vertical slice (Recall, §6) es el siguiente paso.
- `patient_portal_tokens` y las tablas de tokens por módulo (§9.2, §8.3) se crean con su módulo; aquí solo viven los helpers.
- La política de "según política clínica" para que el asistente consulte un periodontograma queda **negada por omisión**; abrirla será un ajuste por clínica, no un cambio de código.
