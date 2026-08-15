# ADR-0001: Instrumentos gráficos por especialidad (podograma, odontograma) y órdenes a laboratorio

**Estado:** Propuesto
**Fecha:** 2026-08-14
**Deciden:** Jorge (arquitectura) · Dra. Villa Angulo (validación clínica)
**Detona:** alta de podología en el catálogo + historia clínica en papel de Unidad Médica Pisada Sana (págs. 1–4)

---

## Contexto

El catálogo de especialidades (`PERFILES` en `packages/shared-types/src/index.ts`) promete en su
encabezado:

> Agregar una especialidad = agregar una entrada a PERFILES. Cero código nuevo.

**Esa promesa es cierta solo para campos escalares.** El contenedor donde viven los campos propios
de cada especialidad es:

```ts
extension?: Record<string, string | number | null>;
```

Un mapa plano de escalares. Alcanza para "IMC", "monofilamento pie izquierdo" o "riesgo de pie
diabético" — que es justo lo que se acaba de dar de alta para podología, y por eso ese alta no
costó una línea de código nuevo. **No alcanza para un dibujo con zonas marcadas.**

### Lo que ya pasó una vez: el odontograma

Cuando odontología necesitó un instrumento visual, no cupo en `extension` y se salió del catálogo:

| Pieza | Ubicación |
|---|---|
| Tipo `Odontograma` (lista de marcas) | `shared-types` líneas 134–224 |
| Campo propio en la nota, **fuera** de `extension` | `NotaEvolucionContent.odontograma` |
| Componente dedicado | `apps/web/components/odontograma.tsx` (457 líneas) |
| Bandera de tenant | `UserProfile.clinicaDental` + `ClinicaDentalReader` |
| Rama en el prompt de IA | `prompt-builder.ts:130` |
| Puente a lo comercial | `partidasDesdeOdontograma()` |

Y **cuatro `if` cableados por nombre de especialidad**:

```
apps/api/src/modules/ai-scribe/application/prompt-builder.ts:130
apps/web/app/consulta/[appointmentId]/page.tsx:69   (qué NOM se cita en pantalla)
apps/web/app/consulta/[appointmentId]/page.tsx:322  (acceso al presupuesto)
apps/web/app/consulta/[appointmentId]/page.tsx:567  (render del odontograma)
```

El comentario sobre el último es sintomático:

> `{/* Solo donde tiene sentido: el odontograma lo dibuja el catálogo de la especialidad, no un if suelto en la página. */}`
> `{perfil.key === 'odontologia' && (`

El comentario describe la intención; la línea de abajo es exactamente el `if` suelto que niega.
No es un reproche al código —era la salida razonable para el primer caso— sino el dato que
importa: **el patrón no se generalizó porque nunca hubo un segundo caso. Podología es el segundo.**

### Lo que pide podología

De la historia clínica en papel (págs. 1–2) y de la orden de plantillas (págs. 3–4):

1. **Mapa podológico.** La pág. 2 lista ~32 hallazgos (hiperqueratosis, heloma, onicomicosis,
   onicocriptosis, úlceras, verrugas…) con casilla IZQ./DER., más una silueta de ambos pies para
   marcar dónde. La pág. 5 es esa silueta en blanco, tamaño carta: es el instrumento que la
   doctora ya usa a mano.
2. **Orden de plantillas** (págs. 3–4, "Microrthopedic Solutions"). ~90 casillas: línea correctiva,
   deportiva, de vestir, acomodativa; modificaciones de casting, postings, materiales, espesores,
   acomodaciones. Con nombre del laboratorio, `Account #`, `Date required` y a dónde se envía.

Si se clona el patrón del odontograma para las dos, los `if` cableados pasan de 4 a ~12 y aparece
una segunda bandera de tenant (`clinicaPodologica`). Con la tercera especialidad visual
(dermatología ya quiere mapa corporal de lesiones) el patrón se vuelve inmanejable.

### Restricción que no se negocia

Una nota cerrada es **inmutable** por NOM-004 y debe poder leerse para siempre. `odontograma` ya
está escrito en el `jsonb` de notas firmadas. **Cualquier diseño que exija migrar notas históricas
está descartado de entrada.** El catálogo ya razona así, y con razón (`perfilDe` nunca lanza).

---

## Decisión

Tres decisiones separadas, porque son tres problemas distintos que la conversación mezcló:

**D1 — Los instrumentos gráficos se declaran como DATOS en el perfil, igual que `camposExtra`.**
Se agrega un registro `INSTRUMENTOS` y un campo `instrumentos` al perfil. La página de consulta
recorre `perfil.instrumentos` y renderiza; deja de preguntar por el nombre de la especialidad.

**D2 — El podograma se modela como LISTA DE MARCAS, no como matriz.** Copia deliberada de la
decisión ya tomada y ya validada en el odontograma.

**D3 — La orden de plantillas NO va dentro de la nota clínica.** Es un módulo aparte, hermano de
`presupuestos`. Justificación abajo; es la parte de este ADR que más fácil se hace mal.

---

## Opciones consideradas

### Opción A — Solo campos planos: un `texto-rico` "exploración visual"

Es lo que quedó implementado hoy como puente (`pod_exploracion_visual`).

| Dimensión | Evaluación |
|---|---|
| Complejidad | Nula — ya está |
| Costo | 0 |
| Fidelidad clínica | **Mala** |
| Explotable en datos | No |

**Pros:** ya funciona; la doctora puede empezar a usar el sistema mañana.
**Contras:** pierde justo lo que hace útil el instrumento. "Hiperqueratosis en cabeza del 1er
metatarsiano izquierdo" en prosa no se puede comparar entre consultas, no se puede graficar la
evolución de una úlcera, y no alimenta la orden de plantillas. La doctora seguiría imprimiendo la
silueta y engrapándola — que es exactamente el trabajo que el sistema viene a quitar.

**Veredicto:** insuficiente como destino. Sirve como puente, y por eso quedó puesto.

### Opción B — Clonar el patrón del odontograma

Campo propio `podograma` en la nota, componente dedicado, bandera `clinicaPodologica`, sus `if`.

| Dimensión | Evaluación |
|---|---|
| Complejidad | Media (camino conocido) |
| Costo | ~2 semanas |
| Escalabilidad | **Mala** — lineal en especialidades × puntos de integración |
| Familiaridad | Alta |

**Pros:** riesgo bajo por consulta, es un camino ya recorrido; nada que rediseñar.
**Contras:** los `if` cableados pasan de 4 a ~12. Cada punto de integración nuevo (exportar la nota
a PDF, el timeline del paciente, el prompt de IA) hay que acordarse de tocarlo en N lugares, y
olvidarse de uno es un bug silencioso: el instrumento simplemente no aparece. Segunda bandera de
tenant con su reader, su query y su test.

**Veredicto:** funciona y es tentador. Es deuda que se paga con interés en la tercera especialidad.

### Opción C — Registro de instrumentos declarado en el perfil ← **RECOMENDADA**

```ts
// shared-types
export const INSTRUMENTOS = ['odontograma', 'podograma'] as const;
export type InstrumentoKey = (typeof INSTRUMENTOS)[number];

export interface PerfilEspecialidad {
  // …lo existente…
  /** Instrumentos gráficos que esta especialidad captura. Vacío = ninguno. */
  instrumentos?: readonly InstrumentoKey[];
}
```

En la nota, los instrumentos nuevos viven bajo una llave común:

```ts
export interface NotaEvolucionContent {
  // …
  /**
   * LEGADO: el odontograma se quedó donde ya estaba escrito en notas firmadas.
   * No se migra — NOM-004: una nota cerrada es inmutable.
   */
  odontograma?: Odontograma;
  /** Instrumentos gráficos posteriores a este ADR. */
  instrumentos?: Partial<Record<InstrumentoKey, unknown>>;
}
```

El registro declara dónde lee y escribe cada instrumento, con lo que el odontograma entra al
patrón **sin tocar un solo byte de las notas ya firmadas**:

```ts
interface DefinicionInstrumento {
  key: InstrumentoKey;
  titulo: string;
  /** Si viene, el valor vive en esa llave de primer nivel (compatibilidad). */
  campoLegado?: 'odontograma';
}
```

| Dimensión | Evaluación |
|---|---|
| Complejidad | Media-alta al inicio, **constante** después |
| Costo | ~3 semanas (1 de generalización + 2 de podograma) |
| Escalabilidad | Buena — la 3ª especialidad visual cuesta un componente y una entrada |
| Familiaridad | Media — es el patrón que el equipo ya escribió, extraído |

**Pros:** los 4 `if` de odontología se borran. Agregar dermatología = componente + entrada en el
registro. El gating por tenant se generaliza a `especialidadesActivas: EspecialidadKey[]` en el
perfil de usuario, y `clinicaDental` pasa a derivarse (`incluye('odontologia')`) en vez de sumar
banderas.
**Contras:** una semana de refactor que no entrega funcionalidad visible. Riesgo real de tocar el
camino de firmar notas — se mitiga porque `odontograma` no se mueve de lugar.

---

## Análisis de trade-offs

**B vs. C es cuándo se paga, no cuánto.** B es más barata hoy y más cara cada vez. C cobra una
semana por adelantado y deja plano el costo. El desempate es que ya hay una tercera especialidad
visual a la vista (dermatología, mapa corporal) y una cuarta implícita (traumatología, que hoy
captura `tra_region` + `tra_lateralidad` como texto porque no tuvo mejor opción). Con una sola
especialidad visual en el horizonte, B sería la respuesta correcta.

**Por qué lista de marcas y no matriz (D2).** El razonamiento del odontograma se traslada intacto:
la inmensa mayoría de las zonas no tiene nada que registrar, y una lista pesa lo que el hallazgo
real. En podología aplica todavía más — un pie sano son cero marcas, y la consulta típica son dos
o tres.

El paralelo llega hasta el detalle: el odontograma distingue hallazgos de **cara** vs. de **pieza
completa** (`piezaCompleta`). Podología tiene la misma dicotomía con otros nombres — hallazgos
**ungueales** (onicomicosis, onicocriptosis, onicogrifosis: aplican a la uña de un dedo concreto)
vs. **cutáneos/zonales** (hiperqueratosis, heloma, úlcera: aplican a una región de la planta o el
dorso). Es la misma bandera con otro rótulo, y conviene nombrarla igual de explícito.

```ts
export interface MarcaPodologica {
  pie: 'izquierdo' | 'derecho';
  vista: 'plantar' | 'dorsal';
  /** Zona anatómica o dedo. Clave ESTABLE: nunca se renombra ni se reutiliza. */
  zona: string;
  hallazgo: string;
  nota?: string;
}
```

**Por qué las plantillas van fuera de la nota (D3).** Es la decisión menos obvia y la que más
cuesta revertir. El podograma y la orden de plantillas parecen lo mismo —los dos salen de la misma
consulta, los dos hablan de pies— pero tienen ciclos de vida incompatibles:

| | Podograma | Orden de plantillas |
|---|---|---|
| Qué es | Hallazgo clínico | Pedido a un proveedor externo |
| Ciclo de vida | Se **congela** al firmar la nota | Vive semanas: borrador → enviada → fabricando → recibida → entregada |
| Se corrige después | **No** (NOM-004) | Sí — el laboratorio rebota medidas |
| Destinatario | El expediente | Microrthopedic Solutions |
| Se factura | No | Sí |

Meter la orden dentro de la nota la volvería inmutable al firmar, y eso rompe el caso normal: la
doctora firma la nota el martes y el laboratorio pide corregir el espesor el jueves. Quedaría
atrapada, o habría que abrir un agujero en la inmutabilidad de la nota — que es precisamente lo
que protege el expediente.

El repositorio ya tiene el molde correcto: `presupuestos`, `radiografias`, `consentimientos` son
documentos con ciclo propio que **referencian** al paciente y a la nota. La orden de plantillas es
un cuarto hermano, y su catálogo de ~90 casillas se declara como datos —igual que `PERFILES`— para
que el día que el laboratorio cambie su formato sea editar una lista y no una migración.

Y hay un puente ya probado que se replica: así como `partidasDesdeOdontograma()` convierte caries
en partidas de presupuesto, `sugerenciasDesdePodograma()` puede pre-marcar la orden desde los
hallazgos (pie cavo → soporte de arco; heloma en cabeza metatarsal → met pad). Con el mismo
principio que allá: **sugerir, nunca decidir** — el precio y la indicación los pone quien firma.

---

## Consecuencias

**Más fácil**
- La 3ª y 4ª especialidad visual cuestan un componente y una entrada de registro.
- Los 4 `if` de `perfil.key === 'odontologia'` desaparecen; el prompt de IA arma la sección del
  instrumento desde el registro.
- El gating deja de sumar banderas por especialidad.

**Más difícil**
- Una semana de refactor sin entregable visible.
- Se toca el camino de firmar notas, que es el más delicado del sistema.
- El registro es una indirección más: leer "qué se dibuja aquí" pasa por un `INSTRUMENTOS`.

**A revisar**
- Si a los 12 meses sigue habiendo solo 2 instrumentos, C fue sobre-ingeniería y B era lo correcto.
- El podograma en PDF/impresión de la nota: la silueta debe renderizarse en el expediente impreso,
  no solo en pantalla. **No está resuelto en este ADR** y es trabajo real (probablemente SVG
  embebido). Hay que dimensionarlo antes de comprometer las 3 semanas.
- Las coordenadas de las zonas del pie: hay que definir el mapa anatómico con la doctora antes de
  dibujar nada. Es la parte que ningún ingeniero puede decidir solo.

---

## Plan de acción

**Fase 0 — hecho ✅**
- [x] `podologia` en `ESPECIALIDADES` y su perfil en `PERFILES`, con el cribado de pie diabético
      (monofilamento y pulsos **por pie**, porque la asimetría es el hallazgo) y
      `pod_riesgo_pie_diabetico` obligatorio para cerrar.
- [x] `pod_exploracion_visual` como puente en texto rico hasta que exista el podograma.
- [x] Verificado: `tsc --noEmit` limpio en API y `shared-types`; 192 tests de dominio en verde.

**Fase 3 — podograma: hecho ✅** (se adelantó a la Fase 2 a petición del usuario)
- [x] `MarcaPodologica` / `Podograma`, 37 hallazgos en 4 familias y 31 zonas anatómicas.
- [x] `hallazgoAplicaEnZona()` — la regla ungueal vive en `shared-types` y la comparten pantalla
      y API, para que ni la IA ni otro cliente puedan guardar una onicomicosis en el talón.
- [x] Componente SVG con planta y dorso, ambos pies. Geometría escrita UNA vez y reflejada por
      XOR (`pie === 'izquierdo') !== (vista === 'dorsal')`), que evita dibujar dos pies derechos.
- [x] Precarga desde la última nota cerrada, compartiendo el SQL con el odontograma
      (`ultimoInstrumento`) en vez de duplicarlo.
- [x] `CampoExtra.soloHistoriaClinica` + `camposDeNota()`: la ficha de identificación se levanta
      una vez y no reaparece en cada nota de control.
- [x] 22 pruebas nuevas (214 en total, en verde), incluida la invariante de que ningún campo
      obligatorio puede quedar oculto en una subsecuente.

**Pendiente de la Fase 3**
- [ ] Podograma en la nota IMPRESA. `resumirPodograma()` ya da la versión en texto, que es lo que
      el PDF puede usar hoy; el dibujo embebido sigue sin dimensionarse.
- [ ] Dictado del podograma por el asistente de IA. **Se dejó fuera a propósito:** habría sido un
      quinto `if` cableado por especialidad, justo lo que este ADR propone eliminar. Entra solo
      después de la Fase 2.

**Fase 1 — validación clínica**
1. [ ] Revisar con la Dra. Villa Angulo el mapa de 31 zonas ya implementado: si falta alguna
       región o sobra otra, es editar una lista de datos.
2. [ ] Revisar los 37 hallazgos contra las ~32 casillas de la pág. 2 (se agregaron fisura, cianosis
       y edema, que su hoja no trae pero el cribado vascular usa).
3. [ ] Confirmar si la orden de plantillas es solo para Microrthopedic o si habrá más laboratorios
       (cambia si el catálogo de casillas es uno o varios).

**Fase 2 — generalización (~1 semana)**
4. [ ] `INSTRUMENTOS` + `PerfilEspecialidad.instrumentos` + `campoLegado` para odontograma.
5. [ ] Borrar los 4 `if` de `perfil.key === 'odontologia'`.
6. [ ] `especialidadesActivas` en el perfil; `clinicaDental` pasa a derivarse.
7. [ ] Test de regresión: una nota firmada **antes** del cambio sigue leyéndose y mostrando su
       odontograma. Es el test que no puede faltar.

**Fase 4 — orden de plantillas: hecho (MVP) ✅** (se adelantó a la Fase 2, mismo criterio que el podograma)
- [x] Módulo `plantillas` siguiendo `presupuestos`/`radiografias`: tabla propia
      (`ordenes_plantillas`, migración 0023), RLS, repo, 3 casos de uso (get-or-create,
      autosave, marcar-enviada), controlador bajo `/consultations/:appointmentId/orden-plantillas`.
- [x] Catálogo del laboratorio como datos: `OPCIONES_PLANTILLA` (99 casillas, agrupadas,
      con `porLado` para las que llevan columna R/L) + `VALORES_PLANTILLA` (18 campos libres:
      grados de posting, espesores, hasta dónde llega la cobertura).
- [x] Modal (`orden-plantillas-modal.tsx`) con botón en la consulta, gated a podología, junto
      al panel de Progreso — se monta/desmonta con el modal, así que nunca hay una instancia
      viva que pueda arrastrar estado de una cita a otra (mismo blindaje que el `key={appointmentId}`
      de la página de consulta, pero aquí gratis: el modal ya nace y muere con cada apertura).
  - Confirmado extremo a extremo contra la API real corriendo en local: GET crea el borrador,
    PUT lo persiste, un segundo GET devuelve exactamente lo guardado, y `marcar-enviada` cambia
    el estatus. `tsc --noEmit` limpio en los tres paquetes; 233 pruebas de dominio en verde.
- [x] **Impresión/exportación y visibilidad en el expediente.** Dos endpoints de solo lectura
      nuevos —`GET /ordenes-plantillas/:id` (con nombres de paciente/médico/clínica, para
      imprimir) y `GET /ordenes-plantillas?patientId=` (para el expediente)— y una ruta propia
      `/ordenes-plantillas/[id]`, SIN `AppShell`, que solo muestra lo que el médico marcó
      (una hoja con las 99 casillas casi todas vacías no le sirve al laboratorio). "Exportar a
      PDF" es el diálogo de impresión del navegador (`window.print()` + `@media print` para
      esconder los botones de la propia app) — no se generó PDF en el servidor: ninguna otra
      pieza de HealthFlow lo hace hoy (ni facturas, ni consentimientos), así que agregar esa
      infraestructura solo para esto habría sido desproporcionado.
      La sección del expediente (`OrdenesPlantillasPanel`) NO usa un flag de tenant nuevo al
      estilo `clinicaDental`: se dibuja a sí misma y devuelve `null` si el paciente no tiene
      ninguna orden, así que es invisible para el 100% de los pacientes de una clínica que no
      hace podología sin necesitar una columna ni una query nuevas.
      Verificado en el navegador (con una sesión inyectada manualmente, sin poder iniciar sesión
      como la cuenta real de la clínica): la sección aparece en el expediente con el diagnóstico
      y el estatus, y el enlace "Imprimir" abre la hoja completa y correctamente agrupada.

**Pendiente de la Fase 4**
- [ ] `sugerenciasDesdePodograma()` — precargar la orden desde los hallazgos del mapa podológico
      (pie cavo → soporte de arco; heloma en cabeza metatarsal → met pad). Sugiere, no decide.
- [ ] Confirmar con la Dra. Villa Angulo si el catálogo transcrito (99 casillas) coincide exacto
      con lo que su laboratorio espera recibir — es una transcripción del PDF, no un documento
      validado por el laboratorio.
- [ ] Vista de solo lectura de la orden desde el expediente del paciente (hoy solo se ve desde
      la consulta que la originó).
- [ ] Exportar/imprimir la orden en un formato que se pueda enviar tal cual al laboratorio.

> **Nota sobre el orden.** El podograma y la orden de plantillas se construyeron antes que la
> generalización de la Fase 2, así que hoy hay DOS instrumentos con sus `if` cableados (5 en
> total) en vez de uno — la orden de plantillas no suma a ese conteo porque vive fuera del
> catálogo de instrumentos de la nota (es su propio módulo), pero SÍ tiene un `perfil.key ===
> 'podologia'` propio en la página de consulta para mostrar el botón. Sigue siendo la decisión
> correcta: la médica necesita la herramienta, no el refactor primero. El argumento de la Fase 2
> queda igual de vigente.

---

## Nota sobre el nombre visible

La clave `podologia` es **permanente**: queda escrita en el `jsonb` de cada nota que se firme, y
renombrarla rompería notas históricas. El rótulo en pantalla sí es libre, y clave y rótulo no
tienen por qué coincidir — solo el rótulo se lee.

**Resuelto (14-ago-2026):** en pantalla dice **"Podiatría"**, como se anuncia la Dra. Villa Angulo
("Médico Podiatra"). La clave se queda en `podologia`. Si algún día se quiere cambiar el rótulo
otra vez, es una cadena y no tiene consecuencias.
