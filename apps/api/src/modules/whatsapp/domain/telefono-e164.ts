/**
 * Normalización de celulares mexicanos a E.164 (`+52##########`).
 *
 * La implementación vive en `@healthflow/shared-types` y se reexporta aquí
 * para que el módulo la consuma por su propio dominio. Está compartida a
 * propósito: si el formulario del navegador aceptara un número que el API
 * rechaza, el paciente quedaría dado de alta sin canal de aviso.
 *
 * `patients.telefono` es texto libre y contiene de todo: `'555-123'`,
 * `'(664) 123 45 67'`, `'044 55 1234 5678'`. WhatsApp rechaza cualquier cosa
 * que no sea E.164, así que el número de envío vive en una columna aparte y
 * solo se llena cuando esta función devuelve algo — nunca por backfill masivo
 * del campo viejo: un texto libre mal normalizado puede acabar siendo el
 * número de un tercero que jamás dio consentimiento.
 */
export { esE164, normalizarE164Mx } from '@healthflow/shared-types';
