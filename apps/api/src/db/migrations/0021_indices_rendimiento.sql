-- ═══════════════════════════════════════════════════════════════════
-- Índices de rendimiento, alineados con RLS.
--
-- La clave de todo este archivo: como el aislamiento va por RLS
-- (`tenant_id = current_tenant_id()`, ver 0001), Postgres inyecta ese
-- predicado en TODA query. Un índice que no empiece por `tenant_id` obliga al
-- planificador a escanear filas de todas las clínicas para después
-- descartarlas. Por eso aquí se reemplazan varios índices existentes por su
-- versión compuesta: no son índices "de más", son los mismos bien ordenados.
--
-- Ninguno de estos índices cambia qué filas se ven ni qué se puede escribir.
-- Sobre el expediente clínico solo se añaden índices de LECTURA: la
-- inmutabilidad de las notas cerradas, la trazabilidad de note_amendments y la
-- distinción historia_clinica / nota_evolucion quedan exactamente igual.
--
-- Sin CONCURRENTLY a propósito: el runner (src/db/migrate.ts) envuelve cada
-- archivo en una transacción, y CONCURRENTLY no puede correr dentro de una.
-- Al volumen actual el lock dura milisegundos. Si algún día estas tablas son
-- grandes, estos índices habrá que crearlos a mano fuera del runner.
-- ═══════════════════════════════════════════════════════════════════

-- ── appointments ─────────────────────────────────────────────────
-- Sala de espera ("las citas de hoy") y los KPIs del dashboard filtran por
-- rango de inicio_programado. El índice de 0005 era solo (inicio_programado):
-- sin tenant_id delante servía de poco, y encima las queries lo desperdiciaban
-- escribiendo `inicio_programado::date = current_date`, que no es sargable.
-- Los repos pasan a usar rango en esta misma entrega.
DROP INDEX IF EXISTS appointments_inicio_idx;
CREATE INDEX IF NOT EXISTS appointments_tenant_inicio_idx
  ON appointments (tenant_id, inicio_programado);

-- Agenda por médico y, sobre todo, la validación de traslape al agendar
-- (hasOverlap): filtra doctor_id + ventana horaria DENTRO de la transacción de
-- escritura, así que lo que se ahorra aquí se ahorra en tiempo de lock.
CREATE INDEX IF NOT EXISTS appointments_tenant_doctor_inicio_idx
  ON appointments (tenant_id, doctor_id, inicio_programado);

-- Duración media de consulta (dashboard, 30 días) y productividad por médico
-- (reportes, 90 días). Ambas miden sobre consultas ya terminadas, que son una
-- fracción de la tabla: índice parcial con el mismo predicado que usan las
-- queries, para no indexar las citas que nunca van a entrar en el cálculo.
CREATE INDEX IF NOT EXISTS appointments_tenant_fin_real_idx
  ON appointments (tenant_id, fin_real)
  WHERE fin_real IS NOT NULL AND inicio_real IS NOT NULL;

-- ── patients ─────────────────────────────────────────────────────
-- Autocompletado de pacientes: se dispara por pulsación de tecla, así que es
-- de las queries que más veces por minuto corren.
--
-- El índice de 0003 era (lower(nombre) text_pattern_ops) sin tenant_id. Y la
-- búsqueda por CURP no tenía ningún índice utilizable: patients_tenant_curp_uidx
-- es sobre el valor CRUDO, y la query compara lower(curp).
--
-- patients_tenant_curp_uidx se conserva intacto: es la restricción de unicidad
-- de CURP por clínica, no un índice de búsqueda. Son cosas distintas.
DROP INDEX IF EXISTS patients_nombre_lower_idx;
CREATE INDEX IF NOT EXISTS patients_tenant_nombre_lower_idx
  ON patients (tenant_id, lower(nombre) text_pattern_ops);

CREATE INDEX IF NOT EXISTS patients_tenant_curp_lower_idx
  ON patients (tenant_id, lower(curp) text_pattern_ops)
  WHERE curp IS NOT NULL;

-- ── clinical_notes ───────────────────────────────────────────────
-- Historial del expediente: se lee de la nota más reciente hacia atrás. El
-- índice de 0004 era solo (clinical_record_id), sin tenant_id ni orden, así
-- que cada apertura de expediente terminaba en un sort.
DROP INDEX IF EXISTS clinical_notes_record_idx;
CREATE INDEX IF NOT EXISTS clinical_notes_tenant_record_created_idx
  ON clinical_notes (tenant_id, clinical_record_id, created_at DESC);

-- Odontograma de arrastre: la última nota CERRADA del expediente que traiga
-- estado dental. Corre en cada inicio de consulta, dentro de la transacción.
-- Índice parcial porque el predicado es fijo: solo indexa las notas que la
-- query puede llegar a devolver, y queda diminuto frente a la tabla.
CREATE INDEX IF NOT EXISTS clinical_notes_odontograma_idx
  ON clinical_notes (tenant_id, clinical_record_id, cerrado_en DESC)
  WHERE estatus = 'cerrada' AND contenido_nom004 ? 'odontograma';

-- Reportes agregados sobre notas cerradas. La query de diagnósticos
-- frecuentes expandía el jsonb de TODO el histórico; en esta entrega se acota
-- a los últimos 12 meses y este índice es lo que hace barata esa cota.
--
-- Que se acote el REPORTE no acota el expediente: getRecordView y
-- findNoteByAppointment siguen leyendo el historial completo, sin filtro
-- temporal. La conservación NOM-004 no se toca — no se borra nada.
CREATE INDEX IF NOT EXISTS clinical_notes_tenant_cerrado_idx
  ON clinical_notes (tenant_id, cerrado_en DESC)
  WHERE estatus = 'cerrada';
