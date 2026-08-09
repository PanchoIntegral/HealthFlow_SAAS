# Auditoría de rendimiento de datos — HealthFlow

**Fecha:** agosto 2026 · **Alcance:** `apps/api` (Drizzle ORM sobre `pg` + PostgreSQL con RLS)

---

## Por qué casi todo se reduce a `tenant_id`

El aislamiento multi-tenant va por Row-Level Security: cada petición corre dentro de una transacción
que fija el tenant (`set_config('app.current_tenant', …, true)` en
[`tenant-db.service.ts`](../apps/api/src/common/tenant-context/tenant-db.service.ts) y
[`drizzle.ts`](../apps/api/src/db/drizzle.ts)), y las políticas filtran con
`tenant_id = current_tenant_id()` ([`0001_rls.sql`](../apps/api/src/db/migrations/0001_rls.sql)).

La consecuencia práctica: **Postgres inyecta un predicado `tenant_id = …` en toda query**. Un índice
que no empiece por `tenant_id` obliga al planificador a recorrer filas de todas las clínicas para
después descartarlas. Antes de esta auditoría, casi ningún índice de las tablas calientes lo llevaba
como primera columna, y varias queries del camino crítico estaban escritas de forma no-sargable
(`inicio_programado::date = current_date`), lo que anula cualquier índice sobre esa columna.

**Volumen:** no hay conteos reales de producción; los umbrales de este documento usan la proyección
del escenario objetivo (~10 clínicas × 2-4 médicos → ~120k citas y ~120k notas clínicas al año).
Todo umbral marcado como proyección debe revalidarse con datos reales.

**Regla transversal de compatibilidad NOM-004.** Ningún cambio de este documento —aplicado o
diferido— toca la inmutabilidad de las notas cerradas, la trazabilidad de `note_amendments` ni la
distinción `historia_clinica` / `nota_evolucion`. Sobre `clinical_notes` solo se añaden índices de
lectura. No se borra ni se archiva ninguna fila.

---

## Resumen

| # | Hallazgo | Impacto | Estado |
|---|---|---|---|
| P1 | Queries no-sargables sobre `appointments` + índice de fecha sin `tenant_id` | Alto | ✅ Aplicado |
| P2 | `hasOverlap` sin índice por médico | Medio-alto | ✅ Aplicado |
| P3 | Búsqueda de pacientes: el `OR` anula ambos índices | Medio | ✅ Aplicado |
| P4 | `getRecordView` trae el expediente completo sin paginación | Medio hoy / alto a 3-5 años | ✅ Aplicado (índice + paginación por cursor) |
| P5 | `getUltimoOdontograma` sin índice parcial | Medio (dentales) | ✅ Aplicado |
| P6 | Reportes: `jsonb_array_elements` sobre todo el histórico | Alto a mediano plazo | ⚠️ Cota aplicada, rollup diferido |
| P7 | Transacción extra por escritura (`SuscripcionInterceptor`) | Medio | ⏸ Diferido |
| P8 | Pool sin configurar / veredicto PgBouncer | Medio | ⏸ Diferido |
| P9 | Realtime: ya correcto; huecos en eventos y en multi-instancia | Medio (corrección) | ⏸ Diferido |
| P10 | Particionado / archivado de `clinical_notes` | Ninguno hoy | 📌 Señal de alerta |

Implementado en [`0021_indices_rendimiento.sql`](../apps/api/src/db/migrations/0021_indices_rendimiento.sql)
más las reescrituras de query en los repositorios de citas, dashboard, pacientes y reportes.

---

## P1 — Queries no-sargables sobre `appointments` + falta de índice por fecha

**Problema.** `inicio_programado::date = current_date` aparecía en la sala de espera
([`appointment.drizzle-repo.ts`](../apps/api/src/modules/appointments/infrastructure/appointment.drizzle-repo.ts)),
en tres de los seis KPIs del dashboard y en el `LEFT JOIN` de `citasPorDia`
([`dashboard.drizzle-repo.ts`](../apps/api/src/modules/dashboard/infrastructure/dashboard.drizzle-repo.ts)).
El cast se evalúa por fila e impide usar índice. El único índice de fecha existente
(`appointments_inicio_idx ON appointments(inicio_programado)`, migración 0005) tampoco llevaba
`tenant_id` delante.

**Impacto: ALTO.** La sala de espera es la pantalla más abierta del producto y hacía *seq scan*
completo de `appointments` en cada carga; el dashboard hacía tres más. Se nota en latencia y en CPU
de Railway, y empeora linealmente con la antigüedad de la cuenta — una clínica con dos años de
historia paga por recorrer dos años de citas para mostrar las de hoy.

**Solución aplicada.**

```sql
DROP INDEX IF EXISTS appointments_inicio_idx;
CREATE INDEX appointments_tenant_inicio_idx ON appointments (tenant_id, inicio_programado);
```

```sql
-- Mismo día, misma zona horaria, pero sargable
WHERE a.inicio_programado >= current_date::timestamptz
  AND a.inicio_programado <  (current_date + 1)::timestamptz
```

Los KPIs del dashboard se acotan primero al mes con un CTE de límites y los `FILTER` trabajan sobre
ese subconjunto. `citasPorDia` agrega primero por día dentro de la ventana de 7 días y luego une la
serie, en vez de unir la serie contra la tabla entera con un cast en la condición del join.

**Compatibilidad NOM-004.** No toca `clinical_notes` ni `note_amendments`. Cambia el plan de
ejecución de lecturas sobre `appointments`; el conjunto de filas devuelto es idéntico.

---

## P2 — `hasOverlap` sin índice por médico

**Problema.** La validación de doble reserva filtra por `doctor_id` + ventana horaria. No existía
ningún índice con `doctor_id`; el único aprovechable era `appointments_tenant_estatus_idx`, que con
seis estatus posibles casi no discrimina.

**Impacto: MEDIO-ALTO.** Corre en cada agendado **dentro de la transacción de escritura**, así que
su costo se paga en tiempo de lock además de en latencia — es el peor lugar donde tener un seq scan.

**Solución aplicada.** Cubierto por un índice que además sirve para la agenda por médico:

```sql
CREATE INDEX appointments_tenant_doctor_inicio_idx
  ON appointments (tenant_id, doctor_id, inicio_programado);
```

**Compatibilidad NOM-004.** Sin relación con el expediente.

---

## P3 — Búsqueda de pacientes: el `OR` anula ambos índices

**Problema.** [`patient.drizzle-repo.ts`](../apps/api/src/modules/patients/infrastructure/patient.drizzle-repo.ts)
buscaba con `WHERE lower(nombre) LIKE 'x%' OR lower(curp) LIKE 'x%'`. Dos problemas encadenados:
`patients_nombre_lower_idx` era `(lower(nombre) text_pattern_ops)` **sin `tenant_id`**, y para CURP el
único índice era `patients_tenant_curp_uidx (tenant_id, curp)` sobre el valor **crudo**, inútil frente
a `lower(curp)`. Y aunque ambos hubieran sido perfectos, un `OR` entre dos columnas rara vez usa
índice: el planificador tendría que combinar dos índices distintos sobre la misma tabla, y
normalmente prefiere el seq scan.

**Impacto: MEDIO.** Es un autocompletado: se dispara por pulsación de tecla. Latencia visible al
usuario y carga desproporcionada para lo que devuelve.

**Solución aplicada.**

```sql
DROP INDEX IF EXISTS patients_nombre_lower_idx;
CREATE INDEX patients_tenant_nombre_lower_idx
  ON patients (tenant_id, lower(nombre) text_pattern_ops);
CREATE INDEX patients_tenant_curp_lower_idx
  ON patients (tenant_id, lower(curp) text_pattern_ops) WHERE curp IS NOT NULL;
```

Y el `OR` se parte en dos ramas `UNION`, cada una con su `LIMIT`, para que cada rama pueda atacar su
propio índice. `UNION` y no `UNION ALL`: un paciente cuyo nombre y CURP empiecen igual aparecería
duplicado. `patients_tenant_curp_uidx` se conserva intacto — es la restricción de unicidad de CURP
por clínica, no un índice de búsqueda.

**Compatibilidad NOM-004.** No afecta al expediente; cambia cómo se localiza al paciente, no qué se
guarda de él.

---

## P4 — `getRecordView` trae el expediente completo sin paginación

**Problema.** [`clinical-record.drizzle-repo.ts`](../apps/api/src/modules/clinical-records/infrastructure/clinical-record.drizzle-repo.ts)
hace `SELECT … FROM clinical_notes WHERE clinical_record_id = … ORDER BY created_at DESC` **sin
`LIMIT`**, trayendo `contenido_nom004` (el jsonb completo) de cada nota. Un paciente crónico con diez
años de seguimiento devuelve cientos de notas completas en una sola respuesta. El índice existente
(`clinical_notes_record_idx`) era solo `(clinical_record_id)`, sin `tenant_id` ni orden, así que cada
apertura de expediente terminaba además en un sort.

**Impacto: MEDIO hoy, ALTO a 3-5 años.** Es el hallazgo que peor envejece: crece con la antigüedad
del paciente, no con la del sistema, y el jsonb es la columna más pesada del esquema. Se nota en
latencia, en memoria del proceso Node y en ancho de banda del cliente.

**Solución aplicada (índice).**

```sql
DROP INDEX IF EXISTS clinical_notes_record_idx;
CREATE INDEX clinical_notes_tenant_record_created_idx
  ON clinical_notes (tenant_id, clinical_record_id, created_at DESC);
```

**Solución aplicada (paginación por cursor).** `GET /patients/:id/clinical-record` acepta `limit`
(por omisión 20, tope 50) y `cursor`, y devuelve `nextCursor` más `totalNotas`. El keyset va sobre
`(created_at, id)` y encaja con el índice de arriba.

Cursor y no `OFFSET`: el expediente se lee de lo más reciente hacia atrás, y el `OFFSET` degrada
justo en los pacientes con más historia, que son los que más importan. El `id` desempata para que dos
notas del mismo instante no puedan repetirse ni perderse al cambiar de página. Un cursor corrupto
devuelve 400 en vez de degradar a la primera página — devolver silenciosamente el inicio del
historial haría creer al médico que está viendo la continuación.

**Nota sobre el diseño.** La versión original de esta auditoría proponía además separar una lista de
cabeceras (sin `contenido_nom004`) del detalle de cada nota. Al revisar cómo se consume resultó
innecesario: la vista del expediente muestra cada nota expandida —necesita el contenido— y la barra
lateral de la consulta, que era el peor derroche (se bajaba el historial entero para pintar tres
líneas), se arregla pidiendo `limit=6`. La paginación sola cubre los dos casos sin rediseñar la UI.

**Verificado:** recorriendo el historial completo con `limit` de 1, 3, 5 y 100, la concatenación de
páginas es idéntica al orden sin paginar, sin duplicados ni omisiones.

**Compatibilidad NOM-004.** Paginar y no traer el jsonb en la lista **no altera** el expediente. Las
notas cerradas siguen siendo inmutables (`saveNote` es el único camino de escritura y el dominio
bloquea el cierre doble), los `note_amendments` siguen colgando de su nota y viajan con el detalle, y
la distinción `historia_clinica` / `nota_evolucion` va en la cabecera, así que sigue visible en la
lista paginada. El requisito normativo es que el expediente esté **completo y disponible**, no que se
transfiera entero en una sola respuesta HTTP.

---

## P5 — `getUltimoOdontograma` sin índice parcial

**Problema.** Filtra `estatus = 'cerrada' AND contenido_nom004 ? 'odontograma'` ordenando por
`cerrado_en DESC`, para arrastrar el estado dental de la visita anterior. Corre **dentro de la
transacción de `startConsultation`**, en cada inicio de consulta.

**Impacto: MEDIO** en clínicas dentales (retiene lock en el camino crítico de abrir consulta), bajo
en el resto.

**Solución aplicada.** Índice parcial con el mismo predicado que la query, de modo que solo indexa
las filas que la query puede llegar a devolver:

```sql
CREATE INDEX clinical_notes_odontograma_idx
  ON clinical_notes (tenant_id, clinical_record_id, cerrado_en DESC)
  WHERE estatus = 'cerrada' AND contenido_nom004 ? 'odontograma';
```

**Compatibilidad NOM-004.** Es un índice de lectura sobre notas ya cerradas. No las modifica ni
cambia qué se considera una nota válida.

---

## P6 — Reportes: `jsonb_array_elements` sobre todas las notas cerradas

**Problema.** [`reports.drizzle-repo.ts`](../apps/api/src/modules/reports/infrastructure/reports.drizzle-repo.ts)
expandía `contenido_nom004->'diagnosticos'` de **cada nota cerrada del tenant, sin filtro de fecha**,
para devolver un top 8. Es la query que peor escala del sistema: su costo crece con el histórico
completo y ningún índice B-tree la puede ayudar en su forma original.

**Impacto: ALTO a mediano plazo, BAJO hoy.** Con datos de seed no se nota. Proyectando ~120k
notas/año, la pantalla de reportes empieza a doler alrededor de las ~500k notas — antes de que
`clinical_notes` sea grande por ningún otro motivo.

**Solución aplicada (cota).** Ventana de 12 meses sobre `cerrado_en`, apoyada en:

```sql
CREATE INDEX clinical_notes_tenant_cerrado_idx
  ON clinical_notes (tenant_id, cerrado_en DESC) WHERE estatus = 'cerrada';
```

Es además la decisión de producto correcta: "los diagnósticos más frecuentes" es una foto del
presente, y un panel que promedia una década dice menos, no más.

**Diferido — rollup.** Tabla de agregado incremental o vista materializada refrescada a diario. Es
el candidato número uno a cache el día que exista Redis.
**Disparador:** ~500k notas cerradas por tenant, o p95 de la pantalla de reportes > 1 s.

**Compatibilidad NOM-004.** La cota es de **reporting**, no del expediente — está anotado así en el
código para que nadie la lea como una política de retención. El acceso clínico al historial
(`getRecordView`, `findNoteByAppointment`) sigue sin filtro temporal, y no se borra ninguna fila.

---

## P7 — Transacción extra por cada escritura (`SuscripcionInterceptor`) · diferido

**Problema.** [`suscripcion.interceptor.ts`](../apps/api/src/common/subscription/suscripcion.interceptor.ts)
llama a `EstadoSuscripcionReader.leer()`, que abre **su propia** `tenantDb.run()` — una transacción
completa (`BEGIN`, `set_config`, `SELECT`, `COMMIT`) y una toma del pool — antes de que el caso de uso
abra la suya. Toda escritura cuesta dos transacciones y dos tomas del pool, en serie.

**Impacto: MEDIO.** No es lento por sí solo, pero duplica la presión sobre un pool de 10 conexiones
(ver P8) y añade un round-trip a cada mutación.

**Nota importante:** el comentario del reader argumenta bien por qué **no** cachear ese estado en
Redis (retrasaría la reanudación tras pagar, justo cuando el usuario está mirando la pantalla, y no
sería válido con varias instancias). Ese argumento sigue en pie y no se discute. Lo que sobra es la
**transacción separada**, no la lectura.

**Solución propuesta.** Memoizar el resultado por petición en el `AsyncLocalStorage` de
`RequestContextService` — sigue siendo una lectura fresca por petición, cero staleness, pero deja de
repetirse; o mover la verificación al inicio de la transacción del caso de uso. Se difiere porque
toca el orden de interceptores documentado en `app.module.ts`, que es diseño deliberado y merece su
propio cambio revisable.

**Compatibilidad NOM-004.** Ninguna relación.

---

## P8 — Connection pooling y veredicto sobre PgBouncer · diferido

**Problema.** `new Pool({ connectionString })` en [`drizzle.ts`](../apps/api/src/db/drizzle.ts) no
declara `max`, `idleTimeoutMillis`, `connectionTimeoutMillis` ni `statement_timeout`. `max` cae al
default de `pg`: **10**. Como cada petición ocupa una conexión durante toda una transacción, 10 es el
techo real de concurrencia de la instancia, y una query patológica (P6) puede retener una conexión
sin límite de tiempo.

**Impacto: MEDIO.** Con una instancia y ~40 usuarios concurrentes probablemente alcanza, pero está
sin declarar y sin red de seguridad.

**Veredicto PgBouncer: no lo necesitas hoy.** Con una sola instancia y un `max` explícito, el pool de
`pg` basta. Tres conclusiones que sí importan para cuando escales:

- El patrón `set_config(..., true)` (equivalente a `SET LOCAL`) es **compatible con pooling en modo
  transacción**, porque su alcance es la transacción. Un `SET` de sesión no lo sería. El diseño
  actual no te cierra la puerta a PgBouncer — vale la pena saberlo antes de escalar, no después.
- Drizzle sobre `node-postgres` usa sentencias **sin nombre**, así que tampoco choca con el modo
  transacción.
- **Disparador:** cuando `instancias × max` se acerque al `max_connections` del Postgres de Railway
  (típicamente ~100 en planes chicos), o al migrar a Supabase/Render con varias réplicas.

**Solución propuesta.** Declarar `max`, `idleTimeoutMillis` y un `statement_timeout` conservador en
la conexión de aplicación (no en la de admin, que corre migraciones largas legítimamente).

**Compatibilidad NOM-004.** Ninguna relación.

---

## P9 — WebSockets: el patrón ya es correcto; los huecos están en otro lado · diferido

**Diagnóstico.** El patrón *cache-then-broadcast* en vez de *query-then-broadcast* **ya está
implementado, y bien**: `WaitingRoomGateway.appointmentUpdated` emite un evento con la entrada ya
calculada dentro de la transacción del caso de uso, y el cliente
([`use-waiting-room.ts`](../apps/web/lib/use-waiting-room.ts)) hace `setQueryData` in-place **sin
refetch**. Ningún evento de WebSocket dispara una query a la base. No hay nada que optimizar aquí.

Dos huecos reales, ambos más de corrección que de rendimiento:

1. **Eventos que faltan.** `ScheduleAppointmentUseCase` y `CancelAppointmentUseCase` no emiten
   `appointment.updated` (cancelar sí notifica al médico, pero por el canal de *notifications*, no
   por el de sala de espera). Una cita agendada o cancelada desde recepción no aparece ni desaparece
   en las pantallas abiertas hasta un refresco manual. Eso es exactamente la presión que acaba en
   "pongamos un polling cada 10 segundos" — y ahí sí nacería el problema de queries repetidas que
   esta auditoría busca evitar. Arreglar los eventos es lo que mantiene el diseño limpio.
2. **Adapter en memoria.** Socket.io usa el adapter por defecto. Con una instancia funciona; con dos,
   un evento emitido por la instancia A no llega a los clientes conectados a la B, silenciosamente.
   **Disparador:** al escalar horizontalmente, añadir `@socket.io/redis-adapter`. Es el primer uso
   real que justificaría Redis en el proyecto — antes que cualquier cache.

**Estrategia de cache (para cuando Redis exista).**

- **Sí cachear:** catálogo CIE-10 (global, casi inmutable — el mejor candidato, y ni siquiera necesita
  invalidación), `DashboardStats` con TTL de 30-60 s por tenant, el rollup de diagnósticos frecuentes
  (P6), `tenants.plan` para los cupos de `PlanService`.
- **No cachear:** el estado de la sala de espera (ya es push; cachearlo solo añadiría una segunda
  fuente de verdad que puede divergir de la que ya es correcta), las notas en borrador,
  `EstadoSuscripcionReader` (razonado en P7), y **cualquier** lectura de `clinical_notes` o
  `note_amendments`.

**Compatibilidad NOM-004.** La última regla queda como invariante explícito: **nada del expediente
clínico se sirve desde cache**. Un expediente servido desde cache es un expediente cuya vigencia no
puedes probar en una auditoría, y el ahorro no compensa ni de lejos ese riesgo.

---

## P10 — Particionado y archivado de `clinical_notes` · señal de alerta

**Diagnóstico.** Proyectando ~120k notas/año, `clinical_notes` no se acerca a necesitar particionado
en el horizonte visible. **No hay acción pendiente**; esto es la señal de alerta que pediste.

- **Umbral para evaluar particionado:** ~10M filas, o cuando el índice caliente deje de caber en RAM,
  o cuando `VACUUM` / `REINDEX` empiecen a impactar el horario laboral. Al ritmo proyectado, eso es
  una década.
- **Si llega ese día: particionar por RANGE de `created_at` (anual), no por tenant.** Por fecha
  porque el acceso es fuertemente temporal —lo reciente se lee, lo antiguo se conserva— y porque
  permite mover particiones viejas a almacenamiento barato sin tocar las calientes. Por tenant sería
  antinatural aquí: con 10-100 clínicas darías particiones muy desiguales, y RLS ya hace el
  aislamiento sin ayuda del particionado. Conviene verificar en su momento la interacción entre
  particionado y políticas RLS heredadas.
- **El problema llega mucho antes que el particionado, y es P6.** La query de reportes se degrada
  alrededor de las ~500k notas, veinte veces antes del umbral de partición. Ahí la solución es
  rollup, no partición. Si alguien propone particionar, la pregunta correcta es si ya se hizo el
  rollup.
- **Archivado.** NOM-004 exige conservar el expediente al menos cinco años. Archivar aquí significa
  **mover a almacenamiento frío conservando accesibilidad**, jamás borrar. Queda documentado que
  ninguna tarea futura de limpieza puede tocar `clinical_notes`, `note_amendments` ni `audit_log`.
- **Aparte:** `audit_log` crece más rápido que `clinical_notes` (una fila por cada mutación de
  negocio) y solo tiene `audit_log_tenant_idx`. Hoy no tiene camino de lectura en el código, pero
  cuando aparezca la pantalla de bitácora hará falta `(tenant_id, created_at DESC)`.

---

## Hallazgo colateral: zona horaria

`inicio_programado::date = current_date` se evalúa en el `TimeZone` de la sesión de Postgres. Si el
Postgres de Railway corre en UTC, **"hoy" para una clínica en `America/Mexico_City` está corrido seis
horas**: las citas después de las 18:00 hora local cuentan como del día siguiente en la sala de espera
y en el dashboard.

Las reescrituras de P1 **preservan la semántica actual exactamente** (`current_date::timestamptz` se
resuelve en el mismo `TimeZone` que el cast que sustituye): no corrigen el desfase ni lo empeoran.
Corregirlo es un cambio de comportamiento deliberado y aparte, y requiere una zona horaria por
tenant. Vale la pena confirmar primero el `TimeZone` real de la instancia de producción — puede que
ya esté configurado y no haya nada que corregir.

---

## Verificación

```bash
pnpm --filter @healthflow/api db:migrate
```

```bash
pnpm --filter @healthflow/api test
```

Comprobar que los índices se usan de verdad, **dentro de una transacción con el tenant fijado** (sin
ella RLS niega todo y el plan no es representativo):

```sql
BEGIN;
SELECT set_config('app.current_tenant', '<uuid-del-seed>', true);
EXPLAIN ANALYZE SELECT ... ;   -- esperar Index Scan, no Seq Scan
ROLLBACK;
```

Con pocas filas el planificador prefiere Seq Scan legítimamente, y hace bien. Para una comprobación
honesta hay que sembrar volumen (decenas de miles de citas) o usar `SET enable_seqscan = off` para
confirmar al menos que el índice es *elegible*.
