# Plan de integración: notas clínicas por especialidad

## Propósito

Convertir la nota clínica actual en un sistema configurable por especialidad,
motivo de consulta y contexto clínico. El resultado debe mantener la nota base
exigible para consulta ambulatoria, pero pedir los datos clínicamente pertinentes
sin convertir cada visita en un formulario universal.

Este documento es una especificación de implementación para un agente de
desarrollo. No autoriza generar diagnósticos, recomendaciones terapéuticas ni
reglas clínicas nuevas por cuenta propia: los catálogos, umbrales y textos de
ayuda deben ser aprobados por responsables clínicos y legales de la clínica.

## Estado de partida

La solución existente ya cuenta con:

- Notas `historia_clinica` y `nota_evolucion` en `clinical_notes`.
- Firma estampada al cierre, bitácora de auditoría y correcciones como adendas.
- Un catálogo central de perfiles (`PERFILES`) que gobierna campos y validación.
- Editor de consulta reutilizable y guardado automático de borrador.

Rutas y módulos principales:

| Área | Ubicación |
|---|---|
| Tipos, perfiles y campos | `packages/shared-types/src/index.ts` |
| Validación de cierre base | `apps/api/src/modules/clinical-records/domain/nom004-validator.ts` |
| Validación de especialidad | `apps/api/src/modules/clinical-records/domain/especialidad-validator.ts` |
| Entidad y cierre de nota | `apps/api/src/modules/clinical-records/domain/clinical-note.entity.ts` |
| Persistencia | `apps/api/src/modules/clinical-records/infrastructure/clinical-record.drizzle-repo.ts` |
| Inicio de consulta | `apps/api/src/modules/clinical-records/application/start-consultation.use-case.ts` |
| Pantalla de consulta | `apps/web/app/consulta/[appointmentId]/page.tsx` |
| Campos extra genéricos | `apps/web/components/campos-especialidad.tsx` |

## Decisiones obligatorias antes de programar

1. Nombrar un responsable clínico y uno legal que aprueben el catálogo de cada
   especialidad y los criterios de obligatoriedad.
2. Definir los escenarios de uso de la primera entrega: medicina general,
   cardiología y nutrición. No ampliar al resto hasta validar estos tres flujos.
3. Validar el uso de la NOM-004-SSA3-2012 con asesoría local. La aplicación debe
   documentar campos relevantes, no declarar que un dato es legalmente obligatorio
   si la norma sólo lo hace necesario según juicio clínico.
4. Elegir la calculadora de riesgo cardiovascular apta para la población objetivo.
   Guardar algoritmo, versión, fecha, entradas, resultado y unidad de riesgo; no
   almacenar sólo el texto “riesgo calculado”.

## Diseño funcional

### 1. Estructura fija de toda nota

Conservar como bloque común:

- Motivo de atención y evolución.
- Hallazgos/exploración pertinente.
- Signos vitales pertinentes o declaración de omisión con motivo.
- Problemas/diagnósticos.
- Estudios revisados o solicitados, si aplica.
- Pronóstico cuando corresponda.
- Plan, indicaciones, seguimiento, signos de alarma y referencias cuando apliquen.
- Autor, cédula, fecha/hora, versión de plantilla y firma de cierre.

No exigir tensión arterial de forma universal. Para cada perfil, cada medición
debe ser `requerida`, `condicional` o `no rutinaria`. Cuando un dato condicional
no se registra, guardar `no_aplica` o `no_valorado` y un motivo breve; nunca
interpretar una cadena vacía como decisión clínica.

### 2. Reglas condicionales

Extender `CampoExtra` o introducir una estructura equivalente con:

```ts
type NivelRequisito = 'opcional' | 'requerido' | 'condicional';
type EstadoNoCapturado = 'no_aplica' | 'no_valorado' | 'rechazado_por_paciente';

interface ReglaCampo {
  cuando: {
    tiposNota?: ClinicalNoteType[];
    motivos?: string[];          // catálogo interno, no texto libre
    diagnosticosCie10?: string[]; // prefijos o rangos explícitos
    etiquetasProblema?: string[];
    primeraValoracionEspecialidad?: boolean;
  };
  requisito: NivelRequisito;
}

interface CampoClinico extends CampoExtra {
  reglas?: readonly ReglaCampo[];
  permiteNoCapturado?: boolean;
  requiereMotivoNoCapturado?: boolean;
}
```

Reglas de evaluación:

1. La API determina qué campos son visibles y requeridos a partir de la nota,
   no el navegador.
2. El frontend usa esa respuesta para pintar el formulario y los errores.
3. Un campo requerido condicionalmente admite un estado explícito autorizado;
   si éste requiere motivo, el motivo también se valida.
4. Las reglas deben ser deterministas, sin IA y sin inferir un diagnóstico.
5. Cada nota cerrada conserva una instantánea de `plantillaVersion` y de las
   reglas/campos renderizados para poder interpretarse correctamente en el futuro.

### 3. Primera valoración por especialidad

No usar sólo “primera nota del expediente” para decidir la historia clínica.
Una persona puede tener una historia de medicina general y requerir después una
primera valoración completa en cardiología o nutrición.

Implementar `primera_valoracion_especialidad` por paciente + especialidad, sin
eliminar la historia clínica general existente. Al iniciar una consulta, calcular:

```text
tipo de nota =
  historia_clinica_general, si no existe historia general cerrada;
  valoracion_inicial_especialidad, si no existe una cerrada para la especialidad;
  nota_evolucion, en cualquier otro caso.
```

Si se decide no agregar un tercer tipo visible, conservar `historia_clinica` y
añadir `contextoNota: 'general' | 'inicial_especialidad' | 'seguimiento'` dentro
del contenido. La decisión debe aplicarse tanto al backend como a la UI.

## Catálogos de primera entrega

### Medicina general

Agregar bloques estructurados y condicionales:

- Revisión por sistemas y exploración por sistemas.
- Lista de problemas: problema, estado, evidencia, objetivo y plan.
- Conciliación farmacológica: medicamento, dosis, vía, frecuencia, adherencia,
  cambio y razón. No dejar este dato sólo como HTML libre.
- Alergias verificadas y fecha de última verificación; reutilizar el historial
  persistente del paciente, sin duplicarlo en cada nota.
- Factores de riesgo y prevención: tabaco/nicotina, alcohol, otras sustancias,
  actividad física, alimentación, vacunas/tamizajes pertinentes y antecedentes
  familiares relevantes.
- Estudios: tipo, fecha, resultado, unidad, interpretación y acción.
- Seguimiento: fecha/plazo, signos de alarma y referencia/interconsulta.

Reglas iniciales sugeridas:

- Requerir lista de problemas o un estado explícito `sin_problemas_activos`.
- Requerir conciliación o `no_fue_posible_conciliar` con motivo en primera
  valoración y al modificar tratamiento.
- Requerir plan de seguimiento o `seguimiento_no_requerido` con justificación.
- Hacer los tamizajes dependientes de edad, sexo, antecedentes y motivo sólo
  después de aprobación clínica; no codificar guías médicas como constantes sin
  configuración ni revisión.

### Cardiología

Conservar los campos existentes y reemplazar texto libre donde requiera trazabilidad.

Bloques necesarios:

- Antecedente cardiovascular: enfermedad previa, eventos, hospitalizaciones,
  procedimientos, dispositivos, valvulopatía y antecedente familiar prematuro.
- Síntomas cardiovasculares estructurados: dolor torácico, disnea, ortopnea,
  edema, síncope/presíncope y palpitaciones, con estado `niega` o `no_valorado`.
- Capacidad funcional y NYHA cuando se valore insuficiencia cardiaca.
- Factores de riesgo: presión, diabetes, lípidos, tabaquismo, enfermedad renal,
  peso/cintura y actividad física.
- Exploración cardiovascular: ritmo, soplos, yugulares, pulsos, edema y
  hallazgos periféricos; usar `no_aplica` cuando el contexto lo justifique.
- Estudios seriables: ECG, ecocardiograma, Holter, prueba de esfuerzo,
  cateterismo y laboratorios. Cada registro debe incluir fecha, fuente,
  resultado/medida, unidad, interpretación y archivo o referencia si existe.
- Riesgo cardiovascular: algoritmo, versión, entradas, fecha y resultado.
- Tratamiento: fármaco, indicación, dosis, vía, frecuencia, tolerancia,
  adherencia, contraindicaciones y monitoreo.
- Seguimiento y triage: plazo, pruebas solicitadas, referencia y signos de
  alarma/atención urgente, según el cuadro.

Reglas iniciales sugeridas:

- Primera cardiología: requerir antecedentes cardiovasculares, factores de
  riesgo, síntomas, exploración pertinente y lista de medicamentos/alergias o
  una declaración explícita de no disponibilidad.
- Insuficiencia cardiaca: requerir NYHA, signos de congestión, FEVI si está
  disponible o motivo de no disponibilidad, tratamiento y seguimiento.
- Dolor torácico, síncope o palpitación: mostrar un bloque de triage y documentar
  acción tomada; no convertir el sistema en un motor que decida urgencias.
- Prevención/riesgo: pedir cálculo sólo si el clínico selecciona el escenario y
  si están disponibles las entradas requeridas por el algoritmo elegido.

### Nutrición

Formalizar una nota ADIME/PES sin obligar todos los datos en todos los casos:

- **A:** antropometría, ingesta, bioquímicos, clínica, actividad/conducta y
  factores sociales pertinentes.
- **D:** diagnóstico PES.
- **I:** prescripción/intervención, educación acordada y metas SMART.
- **M/E:** indicador, resultado esperado y fecha de reevaluación.

En primera valoración nutricional, requerir una fuente de evaluación, PES,
intervención/prescripción y plan de monitoreo, o un estado explícito documentado
que explique por qué no procede.

## Seguridad, integridad y auditoría

1. Exigir nombre y cédula profesional antes de cerrar; no usar un autor de
   respaldo genérico. Definir una excepción aprobada sólo para cuentas que no
   emiten nota profesional.
2. Añadir una migración posterior a `0051` que instale un trigger de PostgreSQL:
   una fila `clinical_notes.estatus = 'cerrada'` no puede cambiar en
   `contenido_nom004`, autor, cita, expediente, tipo ni fecha de cierre.
   Sólo permitir la creación de una fila de adenda en `notas_correccion`.
3. Restringir permisos SQL para que el rol de aplicación no pueda desactivar o
   saltar ese trigger.
4. Registrar en auditoría: apertura, guardado de borrador, intento de cierre
   fallido, cierre, creación de adenda y versión de plantilla.
5. Sanitizar el HTML enriquecido en servidor y conservar anexos mediante
   referencias inmutables, con autorización y auditoría de acceso.
6. Mantener RLS y no llevar contenido clínico a logs, eventos realtime ni
   mensajes de error.

## Plan de ejecución

### Fase 0 — Especificación y aprobación

- [ ] Taller clínico/legal para aprobar la matriz de campos y reglas.
- [ ] Definir catálogo de motivos, escenarios y estados `no capturado`.
- [ ] Definir calculadora cardiovascular y responsabilidad de actualización.
- [ ] Crear fixtures clínicos anonimizados para general, cardiología y nutrición.
- [ ] Convertir esta especificación en ADR con decisiones aprobadas.

**Salida:** matriz versionada de plantilla (`v1`) aprobada.

### Fase 1 — Modelo y compatibilidad

- [ ] Extender tipos compartidos con `plantillaVersion`, contexto de nota,
  reglas evaluables y estados explícitos de dato no capturado.
- [ ] Crear tipos estructurados para problemas, medicamentos, estudios y riesgo
  cardiovascular; usar `extension` sólo para datos de baja complejidad.
- [ ] Mantener lectura de notas antiguas: si no contienen versión, tratarlas
  como `legacy-v0`; nunca intentar reescribirlas.
- [ ] Crear migración `0052_notas_clinicas_v2.sql` y su rollback, incluyendo
  trigger de inmutabilidad y cualquier índice de consultas requerido.
- [ ] Añadir una tabla de primera valoración por especialidad o una consulta
  indexada que determine ese estado sin ambigüedad.

**Salida:** esquema compatible hacia atrás y migraciones probadas en una copia
anonimizada de datos.

### Fase 2 — Motor de reglas en backend

- [ ] Extraer la validación actual a un motor puro que reciba contenido,
  perfil, contexto de consulta y versión de plantilla.
- [ ] Devolver errores con códigos estables, campo, regla incumplida y mensaje
  seguro para UI; no devolver detalles clínicos por excepción no controlada.
- [ ] Hacer que `StartConsultationUseCase` estampe versión, especialidad y
  contexto de nota al crear borrador.
- [ ] Hacer que `FinishConsultationUseCase` exija firma/cédula y ejecute el
  motor de reglas dentro de la transacción.
- [ ] Validar estructura y límites numéricos del servidor para cualquier campo
  estructurado, incluidos los que lleguen desde IA.

**Salida:** cierre validado por servidor, sin depender de la UI.

### Fase 3 — Interfaz y experiencia clínica

- [ ] Sustituir la pantalla monolítica por bloques reutilizables: problemas,
  medicamentos, estudios, seguimiento, riesgo y estados de no captura.
- [ ] Mostrar únicamente los campos activados por la regla actual y explicar
  por qué se solicitan cuando sea útil.
- [ ] Mostrar validación progresiva y resumen de campos pendientes antes de
  firmar; preservar el autosave actual.
- [ ] Agregar vistas de lectura claras para notas cerradas, con versión de
  plantilla, firma y adendas.
- [ ] No permitir que IA marque un campo como revisado ni cierre una nota;
  cualquier sugerencia debe quedar marcada hasta revisión humana.

**Salida:** una consulta de cada uno de los tres perfiles puede capturarse sin
campos irrelevantes ni ambigüedad entre vacío y no aplicable.

### Fase 4 — Pruebas, migración y liberación

- [ ] Pruebas unitarias del motor de reglas por escenario y especialidad.
- [ ] Pruebas de integración del cierre, firma, trigger de inmutabilidad, RLS
  y adendas.
- [ ] Pruebas E2E: inicio, autosave, reingreso, cierre, corrección y lectura
  histórica de una nota `legacy-v0`.
- [ ] Pruebas de regresión para odontología, podología, heridas y recetas.
- [ ] Revisión clínica de muestras PDF/impresas y aprobación de lenguaje.
- [ ] Feature flag por tenant/especialidad y despliegue piloto con métricas.

**Salida:** despliegue gradual, reversión de interfaz por feature flag y cero
modificaciones a notas cerradas.

## Criterios de aceptación

1. Una nota de medicina general no puede cerrarse con datos clínicamente
   requeridos por su escenario en blanco; sí puede cerrarse con `no aplica` o
   `no valorado` cuando la regla lo permita y exista justificación requerida.
2. Una primera cardiología solicita antecedentes, riesgo, síntomas, exploración
   y tratamiento/medicación de manera estructurada; una visita preventiva no
   obliga FEVI o ECG si no proceden.
3. El riesgo cardiovascular guarda modelo, versión, fecha, entradas y salida.
4. Una nota nutricional permite documentar ADIME/PES de punta a punta y exige
   sus componentes en una primera valoración definida por la clínica.
5. El backend rechaza cierre sin cédula y sin los requisitos que resulten de
   las reglas; modificar el navegador no permite saltarlos.
6. Una actualización SQL directa con el rol de aplicación no puede alterar una
   nota cerrada; una adenda sí puede añadirse y se muestra junto a la original.
7. Notas previas continúan visibles, legibles y sin mutación de contenido.
8. Todas las pruebas existentes y las nuevas pasan en CI.

## Fuera de alcance de esta entrega

- Diagnóstico automatizado, triage automático o recomendaciones clínicas de IA.
- Implementar guías clínicas como reglas rígidas sin revisión profesional.
- Interoperabilidad FHIR completa; puede planearse después de estabilizar el
  modelo interno.
- Rediseñar módulos de receta, agenda, facturación o mensajería salvo las
  integraciones estrictamente necesarias para la nota.

