# Plan de integración — Recetas médicas válidas

> ⚠️ Este documento fija los requisitos **técnicos** derivados de la normativa mexicana. No es asesoría legal: igual que [docs/legal/anexo-riesgo-y-cumplimiento.md](legal/anexo-riesgo-y-cumplimiento.md), requiere validación por abogado con cédula en México antes de publicar la función.

## 1. Qué exige la ley para que una receta sea válida

Marco aplicable: **Reglamento de Insumos para la Salud (RIS)** arts. 28, 29, 64 y 65; **Ley General de Salud (LGS)** arts. 226, 240 y 241; **NOM-004-SSA3-2012** (el contenido de la receta forma parte del expediente); **NOM-024-SSA3-2012** (validez del documento electrónico, integridad y trazabilidad).

### 1.1 Datos del emisor (RIS art. 64 y 65)

| Dato | ¿Existe hoy en HealthFlow? |
|---|---|
| Nombre del médico | ✅ `users.nombre` |
| **Institución que expidió el título profesional** | ❌ **no existe columna** |
| Número de cédula profesional | ✅ `users.cedula_profesional` (mig. `0013`) |
| Número de registro de especialidad (art. 65, solo especialistas) | ✅ `users.cedula_especialidad` (mig. `0024`) |
| Domicilio del establecimiento | ✅ `tenants.direccion` (mig. `0024`) |
| Fecha de expedición | ✅ trivial |
| Firma (autógrafa en papel / electrónica en digital) | 🟡 existe `FirmaMedica` para notas, no para recetas |

**Único hueco duro:** la institución que expidió el título. Es una columna nueva en `users` y un campo en Ajustes; sin ella, toda receta impresa queda incompleta frente al art. 64.

### 1.2 Datos de la prescripción (RIS art. 28 y 29)

Por cada medicamento:

- **Denominación genérica** (obligatoria — la sustancia activa)
- Denominación distintiva (marca) — opcional, y si se escribe, el farmacéutico puede surtir el genérico
- **Presentación** (tabletas 500 mg, suspensión 250 mg/5 mL…)
- **Dosis**
- **Vía de administración** (oral, tópica, IM, IV…)
- **Frecuencia**
- **Duración del tratamiento**

Hoy todo esto vive como **texto libre** dentro de `NotaEvolucionContent.planTerapeutico` (HTML de TipTap). Es decir: HealthFlow ya permite *escribir* una receta, pero no puede garantizar que traiga los siete campos, ni imprimirla como documento aparte, ni validarla.

### 1.3 Datos del paciente

Nombre ✅, edad ✅ (derivable de `patients.fecha_nacimiento`), **sexo ❌ (no existe columna)**. El sexo es práctica estándar en el recetario y además condiciona advertencias (p. ej. embarazo).

### 1.4 Medicamentos controlados (LGS art. 226)

| Fracción | Ejemplo | Regla |
|---|---|---|
| **I** — estupefacientes | morfina, fentanilo | **Recetario especial con código de barras** que COFEPRIS asigna al médico (trámite `COFEPRIS-03-006-A`). No es imprimible desde un SaaS. |
| **II** — psicotrópicos gpo. II | clonazepam, metilfenidato | Receta especial / permiso; el farmacéutico **retiene** la receta. |
| **III** — psicotrópicos gpo. III | fenobarbital | Receta que se retiene, hasta 2 resurtidos. |
| **IV** — requieren receta que se retiene | antibióticos | Se retiene. Vigencia y número de surtidos acotados. |
| **V** — requieren receta, no se retiene | mayoría de crónicos | Puede resurtirse las veces que indique el médico. |
| **VI** — libre venta | analgésicos OTC | Sin receta. |

**Decisión de producto obligatoria:** HealthFlow **no puede** emitir recetas de fracción I ni II — requieren papel foliado por la autoridad. El sistema debe bloquear su prescripción impresa y explicar por qué, no imprimir un documento inválido. Las fracciones III–V sí son emisibles.

### 1.5 Receta electrónica

La LGS ya reconoce la receta electrónica (reforma vigente desde 2024, reforzada en 2025-2026), pero **la reglamentación operativa sigue incompleta**. Consecuencia práctica: el camino seguro hoy es **imprimir la receta para firma autógrafa** — igual que ya hace [ordenes-plantillas/[id]/page.tsx](../apps/web/app/ordenes-plantillas/%5Bid%5D/page.tsx) — y construir la infraestructura electrónica (folio, hash, verificación por QR, bitácora inmutable) para que la validez digital sea un interruptor, no un rediseño.

---

## 2. Qué del proyecto ya sirve (y no hay que reinventar)

| Pieza existente | Uso para recetas |
|---|---|
| `cie10_diagnosticos` (mig. `0008`): tabla **global sin `tenant_id` ni RLS**, con `pg_trgm` + índice GIN | Patrón exacto para el catálogo de medicamentos |
| `consentimientos` (mig. `0015`): tabla insert-only, con `REVOKE UPDATE, DELETE` explícito porque `0001_rls.sql` otorga esos permisos por default | Patrón exacto de inmutabilidad médico-legal de la receta |
| `ordenes_plantillas` (mig. `0023`) + su vista de impresión sin `AppShell` | Patrón exacto de documento imprimible con membrete (clínica, dirección, teléfono, doble cédula) |
| `patients.alergias` + `sin_alergias_conocidas` + índice GIN (mig. `0013`) | Alerta de alergia al prescribir — el dato ya está capturado y ya distingue "sin alergias" de "sin información" |
| `FirmaMedica` en shared-types | Estampado del emisor al emitir la receta |
| `CaslAbilityFactory` | Falta el subject `'Receta'`; el asistente debe tener `read` y nunca `create` |
| `AuditModule` | Bitácora de emisión/cancelación |
| `NOM004Validator` | Modelo para un `RecetaValidator` de dominio |

---

## 3. Plan de integración

Siete fases; cada una deja el sistema en un estado usable. Las migraciones arrancan en `0026`.

### Fase 0 — Cerrar los huecos de identidad *(chico, prerrequisito de todo)*

- Migración `0026_receta_identidad.sql`:
  - `users.institucion_titulo text` — art. 64 RIS.
  - `patients.sexo text CHECK (sexo IN ('femenino','masculino','otro'))` nullable, para no romper pacientes existentes.
- Ajustes: campo "Institución que expidió el título" junto a las dos cédulas.
- Alta/edición de paciente: selector de sexo.
- **Sin esto, ninguna receta impresa cumple el art. 64.**

### Fase 1 — Catálogo de medicamentos

- Migración `0027_medicamentos.sql`, calcada de `0008_cie10.sql`: tabla global `medicamentos`, sin RLS, con `gin_trgm_ops`.

  ```
  clave              text PRIMARY KEY   -- clave CNIS o slug propio
  denominacion_generica text NOT NULL
  presentacion       text NOT NULL
  via_administracion text NOT NULL
  fraccion           smallint NOT NULL  -- 1..6, art. 226 LGS
  grupo_terapeutico  text
  ```

- Semilla desde el **Compendio Nacional de Insumos para la Salud (CNIS)** del CSG. Recomendación: **no sembrar las 14 806 claves** — arrancar con el subconjunto de medicamentos del CNIS (excluye material de curación, prótesis, instrumental) y, si el archivo pesa, cargarlo con `COPY` en `seed.ts` en vez de `INSERT` inline como hace CIE-10.
- Endpoint `GET /catalogos/medicamentos?q=` en `CatalogosModule`, gemelo de `buscar-cie10.use-case.ts`.
- **Escape hatch obligatorio:** el médico debe poder prescribir un medicamento fuera de catálogo escribiéndolo a mano. Un catálogo incompleto que bloquea al médico se convierte en la razón por la que deja de usar el módulo.

### Fase 2 — Dominio y persistencia de la receta

- Migración `0028_recetas.sql`, calcada de `consentimientos` + `ordenes_plantillas`:

  ```
  recetas(
    id, tenant_id DEFAULT current_tenant_id(),
    patient_id, doctor_id, appointment_id (nullable),
    folio            text NOT NULL,        -- consecutivo por tenant
    contenido        jsonb NOT NULL,       -- RecetaContent (shared-types)
    firma            jsonb NOT NULL,       -- FirmaMedica
    hash             text NOT NULL,        -- SHA-256 del contenido+firma
    cancelada_en     timestamptz,
    motivo_cancelacion text,
    created_at
  )
  ```

  - RLS `tenant_isolation` + `FORCE ROW LEVEL SECURITY`.
  - `GRANT SELECT, INSERT` y **`UPDATE` solo para la cancelación** — evaluar si conviene modelar la cancelación como fila aparte y hacer la tabla estrictamente insert-only, como `consentimientos`. Recomiendo insert-only + tabla `recetas_cancelaciones`: es más fiel al criterio ya adoptado en `0015` y evita el UPDATE.
  - Índice único `(tenant_id, folio)`.
- `RecetaContent` en shared-types: arreglo de `ItemReceta { medicamentoClave?, denominacionGenerica, denominacionDistintiva?, presentacion, dosis, via, frecuencia, duracionDias, indicaciones? }` + `diagnosticoCie10`, `indicacionesGenerales`, `vigenciaHasta?`, `resurtidos?`.
- `RecetaValidator` de dominio (espejo de `NOM004Validator`): devuelve la lista de campos faltantes por ítem. **La regla vive en el backend**, nunca solo en el front.
- Regla de fracción: si algún ítem es fracción I o II ⇒ error de dominio `MedicamentoRequiereRecetarioEspecialError`.
- Módulo `RecetasModule` con la estructura de siempre (`application/`, `domain/`, `infrastructure/`), importando `AppointmentsModule` y `AuditModule` como hace `PlantillasModule`.
- CASL: subject `'Receta'`. `medico`/`admin` → `create`, `read`, `cancel`. `asistente` → **solo `read`** (mismo criterio que `Consentimiento`: prescribir es juicio clínico).

### Fase 3 — Emisión desde la consulta

- Panel `receta-panel.tsx` en la pantalla de consulta, hermano de `consentimiento-panel.tsx` y `ordenes-plantillas-panel.tsx`.
- Buscador de medicamentos con autocompletado (mismo componente mental que el de CIE-10) y precarga del diagnóstico ya capturado en la nota.
- Precarga del diagnóstico CIE-10 desde `NotaEvolucionContent.diagnosticos` — el médico no debe teclearlo dos veces.
- **Decisión clave:** la receta es un documento hermano de la nota, **no parte de ella**. Igual que `ordenes_plantillas`, tiene ciclo de vida propio: una nota firmada es inmutable por NOM-004, pero una receta puede necesitar reemitirse después de cerrada la consulta.
- Sección de recetas en el expediente del paciente, con historial.

### Fase 4 — Vista de impresión

- Ruta propia `/recetas/[id]`, **sin `AppShell`**, calcada de `ordenes-plantillas/[id]/page.tsx`.
- Membrete: clínica, dirección, teléfono, médico con **institución del título + cédula profesional + cédula de especialidad**.
- Cuerpo: paciente (nombre, edad, sexo), fecha, diagnóstico, tabla de medicamentos con los siete campos, indicaciones generales, folio.
- Pie: línea de firma autógrafa + leyenda de vigencia/resurtidos.
- Impresión vía `window.print()` (Guardar como PDF), como ya está resuelto en el proyecto.

### Fase 5 — Seguridad clínica

- **Alerta de alergia:** al agregar un medicamento, cruzar contra `patients.alergias` (`tipo = 'medicamento'`) por coincidencia de sustancia. Bloqueo blando: advertencia que exige confirmación explícita, no un bloqueo duro — el médico a veces prescribe pese a una alergia leve documentada.
- **Aviso de "sin información de alergias":** si `sin_alergias_conocidas = false` y la lista está vacía, avisar antes de emitir. La ambigüedad ya la resolvió la migración `0013`; hay que aprovecharla.
- Cruce con `patients.antecedentes.banderas` (embarazo, anticoagulados, renal).
- Aviso pediátrico si el paciente es menor: la dosis por peso es responsabilidad del médico, pero el sistema debe recordarlo.
- Estas comprobaciones **no** son diagnóstico: los T&C declaran que HealthFlow no practica la medicina, y la UI debe reflejarlo ("verificación de apoyo, no sustituye criterio clínico").

### Fase 6 — Trazabilidad y verificación *(prepara la validez electrónica)*

- Folio consecutivo por tenant + `hash` SHA-256 del contenido firmado → NOM-024 (integridad).
- Registro en `audit_log` de emisión, impresión y cancelación.
- QR en la hoja impresa apuntando a un endpoint público `GET /verificar/receta/:folio` que responde **solo** validez, fecha, médico y estatus — nunca el medicamento ni el paciente (dato sensible; ver la regla de no poner datos personales en URLs).
- Con esto ya hecho, adoptar firma electrónica avanzada (e.firma) cuando la reglamentación lo exija es agregar un campo, no rehacer el módulo.

### Fase 7 — Gating y cumplimiento

- Decidir si `Receta` entra en el gating por plan (`common/plan`, `common/subscription`) o es función base. Recomiendo **base**: es el corazón del acto médico, y capar recetas empuja al médico a irse a otra herramienta.
- Actualizar `docs/legal/terminos-y-condiciones.md` (la descripción del Servicio no menciona recetas) y el anexo de riesgo con: fracciones no emisibles, responsabilidad del médico sobre la prescripción, y conservación ≥ 5 años.

---

## 4. Riesgos y decisiones abiertas

1. **Fracciones I y II.** Si el negocio necesita prescribir controlados, no hay solución de software: requiere recetario físico de COFEPRIS. Confirmar que bloquearlas es aceptable.
2. **Fuente del catálogo.** El CNIS es informativo/enunciativo. Verificar licencia de uso y definir cadencia de actualización (el CSG publica actualizaciones en `acnis.csg.gob.mx`).
3. **Insert-only vs. cancelación con UPDATE.** Recomendación arriba (insert-only + tabla de cancelaciones), pero es una decisión de arquitectura que conviene fijar en un ADR antes de escribir la migración.
4. **Interacciones medicamentosas.** Deliberadamente **fuera de alcance**: una base de interacciones es un producto en sí mismo y acerca a HealthFlow a la definición de dispositivo médico, algo que los T&C hoy niegan expresamente.
5. **Marco electrónico en movimiento.** La reglamentación sigue cambiando; la Fase 6 está diseñada para absorber ese cambio sin rediseño.

---

## 5. Orden sugerido de ejecución

Fase 0 → 1 → 2 → 3 → 4 es el mínimo para tener recetas impresas legalmente completas.
Fases 5, 6 y 7 son endurecimiento posterior y pueden ir en paralelo entre sí.

## Fuentes

- [Prescripción y receta médica: requisitos legales en México (SciELO)](https://www.scielo.org.mx/scielo.php?script=sci_arttext&pid=S0187-53372024000200005)
- [Requisitos de la receta médica (ISSEA)](https://www.issea.gob.mx/docstranspa2/Regulacion%20Sanitaria/Requisitos%20Receta%20M%C3%A9dica.pdf)
- [Regulación de la prescripción médica (UV)](https://dsia.uv.mx/saisuv/publico/Documentos/Leyes/Regulaci%C3%B3n%20de%20la%20Prescripci%C3%B3n%20M%C3%A9dica.pdf)
- [Reglas para recetarios especiales con código de barras (DOF)](https://www.dof.gob.mx/nota_detalle.php?codigo=5411543&fecha=14%2F10%2F2015)
- [Medicamentos estupefacientes y psicotrópicos (Farmacopea)](https://www.farmacopea.org.mx/Repositorio/Documentos/2241.pdf)
- [Compendio Nacional de Insumos para la Salud (CSG)](https://www.gob.mx/csg/articulos/compendio-nacional-de-insumos-para-la-salud-367182)
- [Actualizaciones del CNIS](https://acnis.csg.gob.mx/)
- [Receta médica electrónica en la Cámara de Diputados](https://comunicacionsocial.diputados.gob.mx/index.php/boletines/aprueban-en-comision-uso-de-receta-medica-electronica-en-instituciones-de-salud)
