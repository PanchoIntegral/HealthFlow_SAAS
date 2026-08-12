# Plantillas de WhatsApp

Las plantillas se registran en el panel de Meta (WhatsApp Manager → Plantillas de
mensajes) y hay que esperar su aprobación: entre tres días y dos semanas. Este
archivo es la fuente de verdad de **qué se mandó a aprobar**, para que el texto
del panel y el código no se separen.

El nombre de la plantilla en Meta debe coincidir **exactamente** con el valor de
`whatsapp_outbox.plantilla` (ver el CHECK de la migración 0022): el adaptador lo
usa tal cual como `template.name`.

---

## Regla que no se negocia: nada clínico

El mensaje viaja a un teléfono que puede estar desbloqueado sobre una mesa, con
las notificaciones a la vista, y puede ser un aparato compartido.

| Sí | No |
|---|---|
| Nombre de pila del paciente | Apellidos completos |
| Nombre de la clínica | Diagnóstico, estudio o tratamiento |
| Fecha y hora | **Motivo de la consulta** |
| Nombre del médico | Especialidad, si delata el padecimiento |
| | CURP, expediente, teléfono de terceros |

`variablesDeRecordatorio()`
(`application/materializar-recordatorios.use-case.ts`) es el único lugar que
arma estas variables, y no lee `appointments.motivo`. El test de integración
`whatsapp-scheduler.integration.spec.ts` comprueba que el motivo no aparezca.

---

## Categoría: **utility**, nunca *marketing*

Un recordatorio de una cita que el paciente ya agendó es una *utility*. Además
de ser lo correcto, marketing cuesta entre cuatro y cinco veces más.

Si Meta reclasifica la plantilla a marketing —suele pasar cuando el texto suena
promocional— hay que reescribirla, no discutirla: basta con quitar cualquier
invitación, oferta o adjetivo de venta.

---

## `recordatorio_cita`

- **Nombre en Meta:** `recordatorio_cita`
- **Idioma:** `es_MX`
- **Categoría:** utility
- **Componentes:** cuerpo + tres botones de respuesta rápida

### Cuerpo

```
Hola {{1}}, te recordamos tu cita en {{2}}.

📅 {{3}}
🕐 {{4}}
👤 {{5}}

¿Nos confirmas si podrás asistir?
```

| Variable | Contenido | Ejemplo |
|---|---|---|
| `{{1}}` | Nombre de pila del paciente | `Ana` |
| `{{2}}` | Nombre de la clínica | `Clínica Dental del Valle` |
| `{{3}}` | Fecha en palabras | `lunes 14 de septiembre` |
| `{{4}}` | Hora local de la clínica | `10:00 a.m.` |
| `{{5}}` | Médico que atiende | `Dr. Pérez` |

El nombre de la clínica va **dentro del cuerpo** y no como remitente: durante el
piloto todas las clínicas mandan desde el número compartido de HealthFlow, así
que el remitente que ve el paciente dice «HealthFlow». Sin `{{2}}` el aviso
llegaría sin decir de parte de quién es.

### Botones (respuesta rápida, en este orden)

| # | Texto | Payload que llega en el webhook |
|---|---|---|
| 1 | `Confirmar` | `confirmar` |
| 2 | `Cancelar` | `cancelar` |
| 3 | `Reagendar` | `reagendar` |

El orden importa: `BOTONES_RECORDATORIO`
(`application/despachar-outbox.use-case.ts`) los declara en esta secuencia.

Reagendar **no** se resuelve dentro de WhatsApp —solo caben tres botones y no
hay forma de mostrar un calendario—: el botón dispara un mensaje con un enlace a
una página de HealthFlow con los horarios libres.

---

## `confirmacion_cita`

Acuse que se manda cuando el paciente pulsa *Confirmar*, y **solo** si la
clínica tiene `enviar_confirmacion` encendido.

```
Listo {{1}}, tu cita del {{2}} quedó confirmada. ¡Te esperamos!
```

Va dentro de la ventana de 24 horas que abre la respuesta del paciente, así que
hoy sale como mensaje de servicio y **no se cobra**. A partir del **1 de octubre
de 2026** Meta empieza a cobrar los mensajes de servicio a la misma tarifa que
el recordatorio, y para una clínica con volumen ese acuse pasa a representar
alrededor del 40 % de la factura. De ahí que sea un interruptor por clínica y no
una constante.

*(La tarifa —~$0.0085 USD por mensaje utility en México, cobrada desde el
primero, sin cupo gratis— y esa fecha vienen de fuentes de terceros. Conviene
confirmarlas en la documentación oficial de Meta antes de fijar precios de
venta.)*

---

## `cancelacion_cita`

Acuse de la cancelación pedida desde el botón. Mismo criterio de costo que el
anterior.

```
{{1}}, cancelamos tu cita del {{2}}. Si quieres reagendar, comunícate con {{3}}.
```

---

## Al dar de alta las plantillas

1. Crearlas con estos nombres exactos y en `es_MX`.
2. Categoría **utility** en las tres.
3. En `recordatorio_cita`, los tres botones de respuesta rápida en el orden de
   arriba.
4. Mientras no estén aprobadas, dejar `WHATSAPP_PROVIDER=fake`: el barrido, la
   idempotencia y el ruteo del inbound se validan enteros sin Meta.
5. Al pasar a real, encender una sola clínica (`activo = true`) y revisar el
   outbox antes de encender el resto.
