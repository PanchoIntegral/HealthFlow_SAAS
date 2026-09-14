# ADR 0005. Notas clínicas v2: reglas por especialidad, contexto y activación controlada

- Estado: **técnico aceptado e implementado; catálogo clínico v1 en BORRADOR**, pendiente de aprobación clínico-legal
- **Decisión bloqueante abierta: B1 (primera consulta con especialista, §6.1).** Cardiología y nutrición no se activan hasta resolverla.
- Fecha: 2026-09-13
- Rama: `main`, commits `3aa846f` → `d040d6f`
- Contexto de referencia: `docs/plan-integracion-notas-clinicas.md` (especificación), memoria de producto sobre la frontera de dispositivo médico (COFEPRIS)
- Alcance: fundaciones técnicas de la nota configurable por especialidad y contexto. **No** aprueba reglas clínicas: las deja como datos revisables y apagados.

---

## 1. Verificación del estado real

La especificación describía el sistema de partida. Antes de diseñar se verificó contra el código; cinco hallazgos cambiaron el plan.

| Afirmación / supuesto | Realidad verificada |
|---|---|
| "Una nota cerrada es inmutable" | **Sólo en la entidad.** El autosave leía la nota, comprobaba el estatus en memoria y hacía `UPDATE … SET contenido, estatus, cerrado_en WHERE id` sin condición. Un autosave que leyera justo antes del cierre **regresaba la nota firmada a borrador** con el contenido previo. Ver D1. |
| "Firma estampada al cierre" | **Con respaldo genérico.** Sin fila de usuario se firmaba como `Médico` con cédula nula, y firmaba quien cerraba aunque la nota fuera de otro médico. Ver D1. |
| "El backend valida el cierre" | **Con datos del cliente.** El validador usaba `tipoNota` del contenido recibido: mandar `nota_evolucion` en una historia clínica permitía cerrarla **sin los antecedentes de NOM-004**. Ver D2. |
| "El catálogo `PERFILES` gobierna campos y validación" | **También en el navegador.** La pantalla recalculaba visibilidad y progreso (`camposDeNota`, `computeProgress`): dos implementaciones de la misma regla. Ver D10. |
| "Primera nota del expediente ⇒ historia clínica" | **Correcto, y es el problema** que la especificación señala: no distingue especialidad. Ver D5. |

---

## 2. Requisitos

### Funcionales

1. La nota pide lo pertinente según especialidad, contexto y motivo, sin volverse un formulario universal.
2. "No aplica / no valorado / rechazado" es una **decisión escrita con motivo**, nunca un campo vacío.
3. La API decide qué se pide y qué falta; modificar el navegador no permite saltarlo.
4. Primera valoración por especialidad sin recapturar la historia general.
5. Notas existentes legibles y sin mutación.
6. Ninguna regla clínica se activa sin aprobación clínico-legal explícita.

### No funcionales

| Dimensión | Objetivo |
|---|---|
| Integridad | Cero modificaciones a notas cerradas, garantizado por PostgreSQL y no sólo por la aplicación. |
| Compatibilidad | Notas previas se interpretan como `legacy-v0` con exactamente el comportamiento anterior. |
| Privacidad | Errores, auditoría y logs llevan rutas y códigos, nunca valores clínicos. |
| Regulatorio | Sin inferencias diagnósticas ni cálculo de riesgo (frontera COFEPRIS). |
| Escala | La de la clínica piloto; sin infraestructura nueva. |

---

## 3. Diseño de alto nivel

```
Start ─► ¿notas_v2 activo para (clínica, especialidad)?
          ├─ no ─► borrador legacy (columnas NULL, como antes)
          └─ sí ─► decidirContexto(historial CERRADO) ─► borrador v1
                   estampa tipo_nota, especialidad, contexto_nota, plantilla_version

GET nota ─► perfilDe(especialidad, plantilla)   ← catálogo sólo si APROBADO
         ─► evaluarEsquema ─► { contenido, esquema, pendientes, referenciaAntecedentes }

PUT autosave ─► sellar (servidor decide tipo/especialidad/plantilla/contexto; valida forma)
             ─► UPDATE … WHERE estatus='borrador'  (0 filas ⇒ 409)
             ─► { esquema, pendientes } recalculados

POST finish ─► SELECT … FOR UPDATE ─► autor = quien firma, nombre+cédula
            ─► validarCierre ─► 422 {errores[codigo,ruta]} | cerrar + esquemaAlCierre

PostgreSQL: trigger inmutable (0052) + trigger de sello v1 (0053)
```

---

## 4. Decisiones

### D1. La inmutabilidad vive también en PostgreSQL (0052)

Trigger `BEFORE UPDATE OR DELETE` sobre `clinical_notes`: si la fila está cerrada, cualquier `UPDATE` que la altere se rechaza **comparando la fila completa** (una columna nueva queda protegida sin tocar el trigger). El `DELETE` se rechaza cuando `session_user` es el rol de la app o del worker: se usa `session_user` y no `current_user` porque un `ON DELETE CASCADE` corre como dueño de la tabla, y así tampoco se borra una nota firmada borrando a su paciente; el rol admin (seed, limpieza de pruebas) sí puede. Se revocan `TRUNCATE` y `TRIGGER`; ninguno de los dos roles es dueño, así que no pueden deshabilitarlo.

En el código: autosave con `UPDATE` condicionado, cierre con `FOR UPDATE`, firma sin respaldo genérico (`FirmaIncompleta`, 422) y sólo el médico de la nota firma (`NotaDeOtroMedico`, 403).

**Trade-off:** un médico no puede cerrar la consulta de un colega. Es deliberado: la firma debe corresponder al autor. Si una clínica lo necesita, se modela como delegación explícita, no relajando la regla.

### D2. El servidor sella lo que el cliente no decide

La entidad impone `tipoNota`, `especialidad`, `plantillaVersion` y `contextoNota` desde lo guardado, descarta `firma` y `esquemaAlCierre` enviados por el cliente, y valida la **forma** del contenido (`validarEstructuraNota`: tipos, catálogos y límites; responde sólo rutas, 422). El motivo de consulta sólo se acepta si pertenece al catálogo **activo** de la nota.

### D3. Motor de reglas puro, con `legacy-v0` exacto

`evaluarEsquema` (qué se pide) y `validarCierre` (si se cumple) son funciones puras sin base de datos ni IA. Reglas deterministas por tipo de nota, contexto, motivo de catálogo o prefijo CIE-10 capturado; la primera regla que aplica decide y deja su id. Códigos estables: `CAMPO_REQUERIDO`, `MOTIVO_REQUERIDO`, `ESTADO_NO_PERMITIDO`, `FUERA_DE_RANGO`.

Una nota `legacy-v0` ignora reglas y reproduce el validador anterior: sus specs pasan **sin cambiar ninguna expectativa**. El esquema evaluado se congela al firmar (`esquemaAlCierre`) y la lectura de una nota cerrada usa ése.

### D4. Contexto en columnas y contenido; sin tercer `tipo_nota`; sin backfill (0053)

Se conserva `tipo_nota` y se agregan `especialidad`, `contexto_nota` (`general | inicial_especialidad | seguimiento`) y `plantilla_version`. NULL = legacy. Un trigger impide cambiar el sello de un borrador v1 y "subir" una legacy a v1.

**Sin backfill:** en las cerradas exigiría desactivar la inmutabilidad sobre documentos firmados sin ganancia (su especialidad se lee del jsonb), y el contexto de una nota vieja no se puede deducir sin inferir. Verificado: hash del contenido de las notas existentes idéntico antes y después de migrar.

**Alternativa descartada:** un tercer `tipo_nota` visible. Tocaba el `CHECK`, reportes, IA, PDF y pantalla para expresar algo que el contexto ya expresa.

### D5. Primera valoración por especialidad

```
sin historia general CERRADA                         → historia_clinica / general
sin valoración inicial CERRADA en la especialidad   → historia_clinica / inicial_especialidad
en otro caso                                         → nota_evolucion / seguimiento
```

Los borradores abandonados no cuentan. Una historia legacy firmada cuenta como general y como inicial de la especialidad en que se firmó. En medicina general, la historia general ya es la inicial.

> **Limitación conocida, bloqueante para cardiología y nutrición — ver B1 (§6.1).** Si la primera consulta del paciente en el expediente es con un especialista, hoy se abre sólo la historia general y la valoración inicial de la especialidad queda para una consulta posterior. Eso obligaría al paciente a volver únicamente para completar un requisito documental.

### D6. Antecedentes en la primera valoración de especialidad (decisión del producto, 2026-09-13)

Con historia general firmada **no se recapturan** los tres antecedentes. Se muestran como referencia (los de la nota firmada más reciente que los capturó) y se exige declarar: *verificados sin cambios*, *actualizados en esta consulta* (lo nuevo escrito en la nota) o *no fue posible verificar* (con motivo). La referencia no se precarga al elegir "actualizados", porque entonces la regla se cumpliría sin escribir nada. En una nota cerrada no se muestra la referencia actual.

### D7. Activación `notas_v2` separada de los módulos comerciales

Tabla `notas_v2_rollout (clínica, especialidad)`; sin fila = apagado. La aplicación sólo tiene `SELECT`. Se escribe con `pnpm db:notas-v2`, que exige `--nota` con la referencia de aprobación, audita el cambio y **se niega a encender si el catálogo de la especialidad no está aprobado** (D8). Apagar sólo afecta a consultas nuevas.

**Por qué no `tenant_feature_flags`:** ahí aparecería en Ajustes y en los planes, y el titular de la clínica podría encender reglas clínicas por su cuenta.

### D8. Catálogos como datos versionados, con aprobación en el código

`CATALOGO_NOTAS_V1` (shared-types) define por especialidad: estado, aprobación, campos retirados, campos nuevos, bloques, motivos y reglas. Cada regla: **id estable, escenario, objetivo, requisito, estados de no captura, motivo requerido y ayuda**.

- `perfilDe(especialidad, plantilla)` aplica el catálogo **sólo** si `estado: 'aprobado'` **y** la aprobación trae responsable clínico, responsable legal, fecha válida y referencia. Un borrador no expone nada; una nota legacy nunca recibe catálogo.
- Aprobar es un commit revisado (queda en el historial quién aprobó qué y con qué referencia). No existe bandera de línea de comandos para forzarlo.
- Estado actual: **general, cardiología y nutrición en borrador**, `aprobacion: null`.

**Trade-off:** aprobar requiere un despliegue. Se acepta: es un cambio de lo que se exige al firmar un documento médico-legal, y debe tener la misma trazabilidad que el código.

### D9. Riesgo cardiovascular: sólo registro

El bloque `riesgoCv` guarda algoritmo, versión, fecha, entradas, resultado y unidad capturados por el profesional. HealthFlow **no calcula**: calcular riesgo tiene finalidad de prevención y cruzaría la frontera de software como dispositivo médico. Elegir y actualizar la calculadora es responsabilidad clínica documentada fuera del sistema.

### D10. La pantalla consume el esquema; no reimplementa reglas

La nota llega con `esquema` y `pendientes`; el autosave los devuelve recalculados; el cierre rechazado trae `errores`. Visibilidad, obligatoriedad, omisión de T/A, bloques y "no capturado" salen del esquema; el catálogo sólo aporta presentación (etiquetas, tipos, opciones). Se eliminaron `computeProgress` y el uso de `camposDeNota` en la página.

E2E (Playwright, `apps/e2e`): flag apagado, v1 activo, error de cierre hasta firmar, reingreso al borrador.

---

## 5. Contratos

| Endpoint | Cambio |
|---|---|
| `GET /consultations/:id/note` | `ConsultationNoteView`: `+esquema`, `+pendientes`, `+referenciaAntecedentes` |
| `PUT /consultations/:id/note` | `GuardarBorradorResponse { ok, esquema, pendientes }`; 409 si ya cerrada; 422 `EstructuraNotaInvalida { rutas }` |
| `POST /consultations/:id/finish` | 422 `IncompleteClinicalNote { missing, errores }`, 422 `FirmaIncompleta`, 403 `NotaDeOtroMedico` |

Migraciones: `0052_notas_clinicas_inmutables.sql`, `0053_notas_clinicas_contexto.sql`, ambas con compensatoria en `rollback/`.

---

## 6. Pendiente de aprobación clínico-legal

Nada de esta sección está activo. Para cada especialidad, revisar la lista de reglas por id en `CATALOGO_NOTAS_V1`.

**Medicina general** — `v1.general.toda_nota.problemas`, `v1.general.primera_valoracion.medicamentos`, `v1.general.toda_nota.seguimiento`.
**Cardiología** — primera valoración (antecedente CV, factores de riesgo, síntomas, exploración, medicamentos, alergias); insuficiencia cardiaca por I50 (NYHA, congestión, FEVI o motivo, tratamiento, seguimiento); signos de alarma por motivo (acción tomada, seguimiento); prevención por motivo (registro de riesgo o no valorado con motivo).
**Nutrición** — primera valoración: fuentes de evaluación, PES, prescripción y monitoreo, cada uno con "no aplica" + motivo.

### 6.1 Decisión bloqueante B1 — primera consulta con especialista

**Problema.** Con la regla actual (D5), un paciente cuya primera consulta en la clínica es con cardiología o nutrición recibe una historia clínica *general*; la valoración inicial de la especialidad no se pide en esa nota y queda para la siguiente. **No se quiere obligar al paciente a regresar sólo para completar la valoración de especialidad.**

**Bloquea:** la aprobación y activación de `cardiologia` y `nutricion`. No bloquea `general` (su valoración inicial ya es la historia general).

**Propuesta (no implementada, requiere aprobación clínica): una sola primera nota combinada.**

Cuando el expediente no tiene historia general cerrada y quien atiende es un especialista con catálogo, la primera nota incluye en el mismo documento:

- la historia clínica general completa: los tres antecedentes, como hoy;
- los requisitos de "primera valoración" de la especialidad: antecedente CV, factores de riesgo, síntomas, exploración, medicamentos y alergias en cardiología; fuentes, PES, prescripción y monitoreo en nutrición;
- sin paso de verificación de antecedentes (D6), porque se están capturando por primera vez.

Al firmarla cuenta a la vez como historia general y como valoración inicial de esa especialidad. La siguiente consulta con el mismo especialista es seguimiento; una con otra especialidad es su inicial, con antecedentes como referencia (D6).

Esbozo técnico, para dimensionar y sin compromiso de forma final:

| Pieza | Cambio propuesto |
|---|---|
| Contexto | Opción A: conservar `contexto_nota = 'general'` y que, en una especialidad distinta de `general`, las reglas de primera valoración apliquen a `['general', 'inicial_especialidad']`. Opción B: nuevo valor explícito `general_con_inicial_especialidad` (cambia el `CHECK` de 0053 y `CONTEXTOS_NOTA`). Recomendación preliminar: **B**, porque la nota combinada queda autodescrita y la auditoría la distingue sin deducirla de la especialidad. |
| `decidirContexto` | Sin historia general cerrada **y** especialidad con catálogo activo ≠ `general` → contexto combinado. Sin catálogo activo, se conserva el comportamiento actual. |
| `historialContexto` | Una nota combinada cerrada cuenta como historia general **y** como inicial de su especialidad. |
| Catálogo | Las reglas `v1.cardiologia.primera_valoracion.*` y `v1.nutricion.primera_valoracion.*` incluyen el contexto combinado. Los ids no cambian si el escenario aprobado es el mismo. |
| Notas existentes | Ninguna afectada: legacy no tiene contexto y en producción no existen notas v1 porque el flag no puede encenderse sin aprobación (D7, D8). |
| Pruebas | Dominio del motor y del contexto; integración del recorrido "primera consulta con cardiología → seguimiento"; E2E de una primera nota combinada. |

Preguntas para la aprobación clínica:

1. ¿Es aceptable la carga de una primera nota combinada en tiempo de consulta, o se prefiere permitir firmar la historia general y dejar la valoración de especialidad en borrador dentro de la misma atención?
2. Si el especialista no puede completar su parte ese día, ¿se admite "no valorado" con motivo en esos requisitos, o la nota no debe firmarse?
3. ¿Aplica igual a nutrición que a cardiología?

### 6.2 Otras preguntas abiertas

Preguntas que el catálogo **no** resuelve por su cuenta:

1. *(Movida a B1, §6.1.)*
2. **"Al modificar tratamiento"** no se detecta por regla; lo cubre la razón obligatoria por cada cambio de fármaco. ¿Suficiente?
3. **NYHA y congestión en I50** no ofrecen "no valorado". ¿Es correcto no dar alternativa?
4. **Alergias en primera cardiología** aceptan "no valorado" con motivo. ¿Correcto?
5. **Tamizajes** por edad, sexo y antecedentes: deliberadamente fuera del catálogo hasta definir guía y responsable de actualización.
6. **Calculadora de riesgo** apta para la población objetivo: por definir fuera del sistema (D9).
7. **T/A no universal:** validar con asesoría local el uso de NOM-004-SSA3-2012 antes de liberar "no rutinaria" para signos vitales (hoy la T/A sigue exigida salvo en perfiles que ya permitían declarar la omisión).
8. **Excepción de firma** para cuentas que no emiten nota profesional.

### Procedimiento para aprobar y activar una especialidad

0. Para `cardiologia` y `nutricion`: resolver B1 (§6.1) e implementar lo aprobado **antes** de aprobar su catálogo.
1. Revisión clínico-legal de sus reglas por id; cambios al catálogo en un commit.
2. Commit de aprobación: `estado: 'aprobado'` y `aprobacion` completa (responsables, fecha, referencia del acta).
3. Revisión de muestras impresas/PDF y del lenguaje de ayudas.
4. Despliegue; `pnpm db:notas-v2 --tenant <piloto> --especialidad <x> --on --nota "<acta>"`.
5. Piloto con métricas (§8) y reversión con `--off`.

---

## 7. Seguridad y auditoría: qué quedó y qué no

| Requisito de la especificación | Estado |
|---|---|
| Nombre y cédula antes de cerrar | **Hecho** (D1). Excepción para roles no profesionales: pendiente (§6.8). |
| Trigger de inmutabilidad y permisos SQL | **Hecho** (0052, 0053). |
| RLS y sin contenido clínico en errores | **Hecho**: errores y auditoría llevan rutas, códigos y metadatos de plantilla. |
| Auditoría de apertura con versión de plantilla | **Hecho**. |
| Auditoría de guardado de borrador e intento de cierre fallido | **Pendiente.** |
| Sanitización del HTML enriquecido en servidor | **Pendiente.** Hoy se valida forma y tamaño, no el HTML. |
| IA: no marcar revisado ni cerrar | Se mantiene lo existente (la IA no cierra; marca en sesión lo que llenó). Los bloques estructurados no los llena todavía la IA. |

---

## 8. Escala, operación y lo que revisaría al crecer

- Costo por inicio de consulta con flag activo: una lectura del rollout y una agregación por expediente sobre índice parcial de notas cerradas. Irrelevante a escala piloto.
- Métricas del piloto (por definir su captura): tasa de cierre al primer intento, pendientes más frecuentes por código y ruta, uso de "no capturado" por regla, tiempo de consulta.
- **Al crecer:** si el catálogo lo mantiene personal clínico con frecuencia, pasar de datos en código a un catálogo versionado en base con flujo de aprobación firmado; interoperabilidad FHIR una vez estable el modelo; revisar si la instantánea `esquemaAlCierre` debe comprimirse o referenciar versiones inmutables del catálogo.

---

## 9. Riesgos abiertos

1. **E2E en CI** no se ha visto correr todavía en GitHub Actions (instala Chromium y levanta API/web).
2. **Editores de bloques** no están ejercitados por E2E: ningún perfil activo los expone hasta aprobar un catálogo.
3. **Borradores v1 creados en entornos de prueba** (flag encendido por SQL) se evaluarían con el catálogo si éste se aprueba antes de cerrarlos. En producción no ocurre porque el script no enciende sin aprobación.
4. **Aprobar el catálogo de una especialidad cambia notas v1 en borrador de esa especialidad**; conviene aprobar con el flag apagado y encender después.
5. **B1 sin resolver**: activar cardiología o nutrición con la regla actual haría que un paciente nuevo tuviera que volver para completar su valoración de especialidad. Por eso es bloqueante (§6.1).
