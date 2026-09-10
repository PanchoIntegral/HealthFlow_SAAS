import { BadRequestException } from '@nestjs/common';
import { isRealCalendarDate, normalizeEmail, normalizeMxPhone, validateBirthDate } from '@healthflow/shared-types';
import { validatePublicContact } from './booking.service';

const today = new Date('2026-09-10T12:00:00Z');

describe('validación estricta de datos públicos (P0.5)', () => {
  it('rechaza fechas que no existen en el calendario', () => {
    expect(isRealCalendarDate('2026-02-31')).toBe(false);
    expect(isRealCalendarDate('2026-04-31')).toBe(false);
    expect(isRealCalendarDate('2025-02-29')).toBe(false);
    expect(isRealCalendarDate('2024-02-29')).toBe(true);
    expect(isRealCalendarDate('2026-13-01')).toBe(false);
    expect(isRealCalendarDate('2026-1-01')).toBe(false);
    expect(isRealCalendarDate(' 2026-01-01')).toBe(false);
  });

  it('rechaza fecha de nacimiento futura y edades imposibles, acepta casos legítimos', () => {
    expect(validateBirthDate('2026-09-11', today)).toBe('futura');
    expect(validateBirthDate('2026-09-10', today)).toBeNull();
    expect(validateBirthDate('1896-09-09', today)).toBe('demasiado_antigua');
    expect(validateBirthDate('1896-09-10', today)).toBeNull(); // 130 años exactos
    expect(validateBirthDate('1920-05-05', today)).toBeNull();
    expect(validateBirthDate('2026-02-31', today)).toBe('formato');
  });

  it('normaliza correo con trim y minúsculas; vacío es null', () => {
    expect(normalizeEmail('  Ana.Lopez@Example.MX ')).toBe('ana.lopez@example.mx');
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });

  it.each([
    ['(664) 123-45-67', '+526641234567'],
    ['664 123 4567', '+526641234567'],
    ['+52 664 123 4567', '+526641234567'],
    ['52 664 123 4567', '+526641234567'],
    ['044 664 123 4567', '+526641234567'],
    ['045 664 123 4567', '+526641234567'],
    ['01 664 123 4567', '+526641234567'],
    ['+521 664 123 4567', '+526641234567'],
    ['+1 (619) 555-0100', '+16195550100'],
    ['+34 600 000 000', '+34600000000'],
  ])('normaliza %s como %s', (input, expected) => {
    expect(normalizeMxPhone(input)).toBe(expected);
  });

  it.each(['123', '66412345', '6641234567890123', '1 619 555 0100', '', '   '])('rechaza el teléfono %j', (input) => {
    expect(normalizeMxPhone(input)).toBeNull();
  });

  const base = { fechaNacimiento: '1990-01-01', telefono: '664 123 4567', email: ' Ana@Example.mx ', canalPreferido: 'whatsapp' as const, whatsappOptIn: true };

  it('exige correo cuando el canal es correo', () => {
    expect(() => validatePublicContact({ ...base, canalPreferido: 'email', email: '  ' }, today)).toThrow(BadRequestException);
    expect(validatePublicContact({ ...base, canalPreferido: 'email' }, today)).toMatchObject({ email: 'ana@example.mx', whatsappOptIn: false });
  });

  it('exige consentimiento cuando el canal es WhatsApp', () => {
    expect(() => validatePublicContact({ ...base, whatsappOptIn: false }, today)).toThrow(/autorizarlo/);
    expect(validatePublicContact(base, today)).toMatchObject({ phone: '+526641234567', whatsappOptIn: true });
  });

  it('fuerza whatsappOptIn=false cuando el canal no es WhatsApp', () => {
    expect(validatePublicContact({ ...base, canalPreferido: 'ninguno', whatsappOptIn: true }, today).whatsappOptIn).toBe(false);
    expect(validatePublicContact({ ...base, canalPreferido: 'email', whatsappOptIn: true }, today).whatsappOptIn).toBe(false);
  });

  it('rechaza fechas imposibles y futuras con mensajes distintos', () => {
    expect(() => validatePublicContact({ ...base, fechaNacimiento: '2026-02-31' }, today)).toThrow(/no existe/);
    expect(() => validatePublicContact({ ...base, fechaNacimiento: '2030-01-01' }, today)).toThrow(/futura/);
  });
});
