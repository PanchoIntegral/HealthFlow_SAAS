# Anexo — Evaluación de riesgo y cumplimiento (HealthFlow)

Complemento de [terminos-y-condiciones.md](terminos-y-condiciones.md). No es asesoría legal; requiere validación por abogado con cédula en México.

## 1. Marco normativo aplicable

| Norma | Por qué aplica a HealthFlow | Quién cumple |
|---|---|---|
| **LFPDPPP** (ley vigente y su normativa secundaria) | Se tratan datos personales **sensibles** (salud). El régimen mexicano de protección de datos fue reformado en 2025 y la autoridad cambió de adscripción: **verificar con abogado el marco y la autoridad vigentes** antes de publicar. | Cliente = Responsable · HealthFlow = Encargado |
| **NOM-004-SSA3-2012** (expediente clínico) | Contenido mínimo de notas, identificación del médico, conservación ≥ 5 años, no alteración. | Cliente (la plataforma habilita) |
| **NOM-024-SSA3-2012** | Sistemas de información de registro electrónico para la salud, interoperabilidad. | HealthFlow (diseño) + Cliente |
| **Ley General de Salud y reglamentos** | Ejercicio profesional, consentimiento informado, secreto médico. | Cliente |
| **NOM-035 / uso de radiografías** | Módulo de radiografías: manejo y resguardo de imágenes diagnósticas. | Cliente |
| **CFF + Resolución Miscelánea (CFDI 4.0)** | Módulo de facturación y timbrado vía PAC. | Cliente (emisor) · HealthFlow (herramienta) |
| **Código de Comercio / firma electrónica** | Aceptación electrónica de los Términos; valor probatorio de logs. | HealthFlow |
| **LFPC (Profeco)** | Riesgo bajo pero real: un médico persona física podría ser considerado consumidor. Evitar cláusulas abusivas (renovación sin aviso, cargos ocultos). | HealthFlow |

## 2. Riesgos priorizados

**Tier 1 — resolver antes de publicar**

1. **Faltan dos documentos obligatorios.** Los T&C por sí solos no bastan: se necesita el **Aviso de Privacidad** de HealthFlow y el **Convenio de Encargado** con cada Cliente. Sin el segundo, HealthFlow trata datos sensibles de terceros sin instrumento que lo respalde. *Exposición: multas de la autoridad de datos + responsabilidad solidaria frente a los Pacientes.*
2. **Marco de datos posreforma sin verificar.** El texto habla de "Legislación de Datos" y "autoridad competente" en abstracto justamente por esto. Un abogado debe fijar las referencias exactas (nombre de la ley, plazos de ARCO, autoridad, plazo de notificación de vulneraciones).
3. **Borrado de expedientes vs. conservación de 5 años.** La cláusula 12.3 (30 días de recuperación + supresión) choca con la obligación del médico de conservar el expediente. Está mitigada con la advertencia expresa 12.4, pero conviene ofrecer **exportación automática al cancelar** — es la mitigación técnica que elimina el reclamo.

**Tier 2 — negociar / decidir**

4. **Tope de responsabilidad (16.2).** 12 meses de fees es estándar de mercado, pero con datos de salud un cliente grande (plan Clínica) pedirá excepción por brecha de seguridad. Ya está prevista como decisión abierta en 16.3(iv): recomiendo **tope ampliado 2x** para confidencialidad/seguridad, y no aceptar responsabilidad ilimitada.
5. **Sin SLA definido.** Un consultorio que no puede documentar una consulta tiene un problema operativo real. Definir 99.5% con crédito en servicio (no reembolso en efectivo) como único remedio.
6. **Renovación automática (5.2) y aumento de precio (5.4).** Con avisos de 60 días y salida sin penalidad queda defendible frente a Profeco; sin ellos, no.
7. **Ubicación de datos (8.6).** Si el hosting queda fuera de México, debe declararse. Hoy el proyecto corre local; al elegir nube, actualizar la cláusula y la lista de subencargados.

**Tier 3 — aceptable como está**

8. Jurisdicción de tribunales en lugar de arbitraje: correcto para el ticket promedio.
9. Datos agregados y anonimizados (13.4): redactado de forma conservadora, sin venta de datos.
10. Bajas lógicas de usuarios (4.4): la restricción técnica ya está justificada normativamente en el propio texto.

## 3. Pendientes concretos

- [ ] Completar razón social, RFC, domicilio, ciudad de jurisdicción, correos y URLs.
- [ ] Redactar **Aviso de Privacidad** (integral + simplificado) y **Convenio de Encargado**.
- [ ] Decidir: precio, periodicidad, duración de prueba, % de interés moratorio, SLA.
- [ ] Implementar en producto: pantalla de aceptación con registro de versión/fecha/IP, exportación completa de datos, aviso previo a la supresión.
- [ ] Revisión por abogado mexicano especializado en datos personales y salud digital.
