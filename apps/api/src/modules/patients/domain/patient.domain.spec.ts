import { Patient } from './patient.entity';
import { InvalidCurpError, InvalidBirthDateError } from './patient.errors';

// CURP de ejemplo con estructura oficial válida.
const CURP_VALIDA = 'RAMJ650109HDFMRS08';

describe('Patient (dominio)', () => {
  describe('alta y validación', () => {
    it('registra un paciente válido y normaliza los campos', () => {
      const p = Patient.register({
        nombre: '  José Antonio Ramírez  ',
        fechaNacimiento: '1965-01-09',
        curp: 'ramj650109hdfmrs08',
        telefono: ' 555-123 ',
      });
      const props = p.toProps();
      expect(props.nombre).toBe('José Antonio Ramírez'); // trim
      expect(props.curp).toBe(CURP_VALIDA); // uppercase
      expect(props.telefono).toBe('555-123');
    });

    it('acepta CURP ausente (null)', () => {
      const p = Patient.register({ nombre: 'Ana', fechaNacimiento: '1990-05-05' });
      expect(p.toProps().curp).toBeNull();
    });

    it('convierte CURP vacía en null', () => {
      const p = Patient.register({ nombre: 'Ana', fechaNacimiento: '1990-05-05', curp: '   ' });
      expect(p.toProps().curp).toBeNull();
    });

    it('rechaza CURP con formato inválido', () => {
      expect(() =>
        Patient.register({ nombre: 'Ana', fechaNacimiento: '1990-05-05', curp: 'ABC123' }),
      ).toThrow(InvalidCurpError);
    });

    it('rechaza fecha de nacimiento mal formada', () => {
      expect(() =>
        Patient.register({ nombre: 'Ana', fechaNacimiento: '09/01/1965' }),
      ).toThrow(InvalidBirthDateError);
    });

    it('rechaza fecha de nacimiento en el futuro', () => {
      expect(() =>
        Patient.register({ nombre: 'Ana', fechaNacimiento: '2999-01-01' }),
      ).toThrow(InvalidBirthDateError);
    });
  });

  describe('cálculo de edad', () => {
    it('calcula la edad respecto a una fecha dada', () => {
      expect(Patient.edad('2000-07-04', new Date('2026-07-04T12:00:00Z'))).toBe(26);
    });

    it('resta un año si el cumpleaños aún no llega en el año en curso', () => {
      expect(Patient.edad('2000-12-31', new Date('2026-07-04T12:00:00Z'))).toBe(25);
    });
  });
});
