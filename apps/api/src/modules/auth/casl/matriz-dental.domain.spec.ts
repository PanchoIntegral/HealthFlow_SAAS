import { CaslAbilityFactory, type Action, type Subject } from './ability.factory';
import type { AuthenticatedUser } from '../authenticated-user';
import type { UserRole } from '@healthflow/shared-types';

/**
 * La matriz de permisos de los módulos dentales (§5.7 del plan), escrita como
 * tabla para que un cambio de criterio sea un cambio VISIBLE en esta tabla y
 * no un `can(...)` perdido en un switch de 200 líneas.
 */
const factory = new CaslAbilityFactory();
const usuario = (rol: UserRole): AuthenticatedUser => ({ userId: 'u1', tenantId: 't1', rol });
const puede = (rol: UserRole, action: Action, subject: Subject): boolean =>
  factory.createForUser(usuario(rol)).can(action, subject);

type Fila = [descripcion: string, action: Action, subject: Subject, medico: boolean, asistente: boolean];

const MATRIZ: Fila[] = [
  ['Configurar recall', 'write', 'Recall', true, false],
  ['Contactar recall', 'contactar', 'Recall', true, true],
  ['Consultar recall', 'read', 'Recall', true, true],
  ['Crear periodontograma', 'create', 'Periodontograma', true, false],
  ['Firmar periodontograma', 'firmar', 'Periodontograma', true, false],
  ['Consultar periodontograma', 'read', 'Periodontograma', true, false],
  ['Enviar invitación al portal', 'create', 'PortalPaciente', true, true],
  ['Crear/enviar formulario', 'create', 'FormularioPaciente', true, true],
  ['Revisar y aplicar respuesta clínica', 'write', 'FormularioPaciente', true, false],
  ['Gestionar laboratorio', 'write', 'LaboratorioDental', true, true],
  ['Ajustar inventario', 'write', 'Inventario', true, true],
  ['Ver costos de laboratorio', 'costear', 'LaboratorioDental', true, false],
  ['Ver costos de inventario', 'costear', 'Inventario', true, false],
  ['Generar cobro en línea', 'create', 'PagoPaciente', true, true],
  ['Configurar comisiones', 'write', 'Comisiones', false, false],
  ['Aprobar liquidaciones', 'aprobar', 'Comisiones', false, false],
];

describe('Matriz de permisos de módulos dentales (§5.7)', () => {
  it.each(MATRIZ)('médico — %s', (_d, action, subject, medico) => {
    expect(puede('medico', action, subject)).toBe(medico);
  });

  it.each(MATRIZ)('asistente — %s', (_d, action, subject, _m, asistente) => {
    expect(puede('asistente', action, subject)).toBe(asistente);
  });

  it('el titular (admin) puede todo, incluidas comisiones', () => {
    for (const [, action, subject] of MATRIZ) {
      expect(puede('admin', action, subject)).toBe(true);
    }
  });

  it('un periodontograma firmado no se borra desde ningún rol salvo el titular', () => {
    // Sin 'delete' sobre Periodontograma para médico ni asistente: una
    // corrección es una adenda (§5.5), no un borrado.
    expect(puede('medico', 'delete', 'Periodontograma')).toBe(false);
    expect(puede('asistente', 'delete', 'Periodontograma')).toBe(false);
  });

  it('el asistente no reembolsa un pago en línea, igual que no anula un movimiento de caja', () => {
    expect(puede('asistente', 'cancel', 'PagoPaciente')).toBe(false);
    expect(puede('asistente', 'cancel', 'Caja')).toBe(false);
  });

  it('los permisos ya existentes no cambiaron', () => {
    expect(puede('asistente', 'abonar', 'Presupuesto')).toBe(true);
    expect(puede('asistente', 'create', 'Presupuesto')).toBe(false);
    expect(puede('asistente', 'read', 'Reports')).toBe(false);
    expect(puede('medico', 'read', 'Finanzas')).toBe(true);
  });
});
