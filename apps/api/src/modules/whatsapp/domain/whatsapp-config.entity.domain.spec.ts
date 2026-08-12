import { WhatsappConfig, zonaHorariaValida } from './whatsapp-config.entity';
import {
  ConfigWhatsappIncompletaError,
  CredencialesWhatsappFaltantesError,
  ZonaHorariaInvalidaError,
} from './whatsapp.errors';

const TENANT = '11111111-1111-1111-1111-111111111111';
const base = () => WhatsappConfig.porDefecto(TENANT);

describe('WhatsappConfig.porDefecto', () => {
  it('nace apagada: nadie empieza a gastar mensajes sin decidirlo', () => {
    expect(base().activo).toBe(false);
  });

  it('nace en modo compartido, sin credenciales propias', () => {
    expect(base().modo).toBe('compartido');
    expect(base().accessTokenCifrado).toBeNull();
  });
});

describe('activar los recordatorios', () => {
  it('exige el nombre con el que se identifica la clínica', () => {
    // El remitente dice "HealthFlow": sin este nombre el paciente no sabría
    // de qué consultorio le están escribiendo.
    expect(() => base().actualizar({ activo: true })).toThrow(ConfigWhatsappIncompletaError);
  });

  it.each([[''], ['   ']])('rechaza un nombre en blanco (%p)', (nombre) => {
    expect(() => base().actualizar({ activo: true, nombreRemitente: nombre })).toThrow(
      ConfigWhatsappIncompletaError,
    );
  });

  it('se activa con el nombre puesto', () => {
    const config = base().actualizar({ activo: true, nombreRemitente: 'Clínica del Valle' });
    expect(config.activo).toBe(true);
  });

  it('no exige el nombre mientras siga apagada', () => {
    expect(() => base().actualizar({ horasAnticipacion: 48 })).not.toThrow();
  });
});

describe('modo propio', () => {
  it.each([
    ['sin nada', {}],
    ['solo con phone_number_id', { phoneNumberId: '123' }],
    ['solo con token', { accessTokenCifrado: 'v1.k1.a.b.c' }],
  ])('rechaza pasar a propio %s', (_caso, cambios) => {
    expect(() => base().actualizar({ modo: 'propio', ...cambios })).toThrow(
      CredencialesWhatsappFaltantesError,
    );
  });

  it('acepta propio con ambas credenciales', () => {
    const config = base().actualizar({
      modo: 'propio',
      phoneNumberId: '123',
      accessTokenCifrado: 'v1.k1.a.b.c',
    });
    expect(config.modo).toBe('propio');
  });
});

describe('horas de anticipación', () => {
  it.each([
    ['0 horas', 0],
    ['negativas', -5],
    ['más de una semana', 169],
    ['fraccionarias', 12.5],
  ])('rechaza %s', (_caso, horas) => {
    expect(() => base().actualizar({ horasAnticipacion: horas })).toThrow(
      ConfigWhatsappIncompletaError,
    );
  });

  it.each([[1], [24], [48], [168]])('acepta %s horas', (horas) => {
    expect(base().actualizar({ horasAnticipacion: horas }).horasAnticipacion).toBe(horas);
  });
});

describe('ventana de silencio', () => {
  it.each([
    ['hora 24', 24],
    ['hora negativa', -1],
    ['hora fraccionaria', 8.5],
  ])('rechaza %s', (_caso, hora) => {
    expect(() => base().actualizar({ silencioDesde: hora })).toThrow(ConfigWhatsappIncompletaError);
  });

  // desde === hasta significa "sin silencio", y es válido a propósito.
  it('acepta una franja vacía como forma de desactivar el silencio', () => {
    const config = base().actualizar({ silencioDesde: 0, silencioHasta: 0 });
    expect(config.silencioDesde).toBe(config.silencioHasta);
  });
});

describe('zona horaria', () => {
  it('rechaza una zona que Intl no conoce', () => {
    expect(() => base().actualizar({ zonaHoraria: 'America/Atlantis' })).toThrow(
      ZonaHorariaInvalidaError,
    );
  });

  it.each([
    ['America/Mexico_City', true],
    ['America/Tijuana', true],
    ['UTC', true],
    ['America/Atlantis', false],
    ['', false],
  ])('%s → %s', (zona, esperado) => {
    expect(zonaHorariaValida(zona)).toBe(esperado);
  });
});

describe('horario de atención', () => {
  it.each([
    ['sin días', { dias: [], desde: '09:00', hasta: '18:00' }],
    ['con día 0', { dias: [0], desde: '09:00', hasta: '18:00' }],
    ['con día 8', { dias: [8], desde: '09:00', hasta: '18:00' }],
    ['con hora inválida', { dias: [1], desde: '25:00', hasta: '18:00' }],
    ['sin ceros a la izquierda', { dias: [1], desde: '9:00', hasta: '18:00' }],
    ['que termina antes de empezar', { dias: [1], desde: '18:00', hasta: '09:00' }],
    ['de duración cero', { dias: [1], desde: '09:00', hasta: '09:00' }],
  ])('rechaza un horario %s', (_caso, horario) => {
    expect(() => base().actualizar({ horarioAtencion: horario })).toThrow(
      ConfigWhatsappIncompletaError,
    );
  });

  it('acepta un horario razonable', () => {
    const horario = { dias: [1, 2, 3, 4, 5, 6], desde: '08:30', hasta: '20:00' };
    expect(base().actualizar({ horarioAtencion: horario }).horarioAtencion).toEqual(horario);
  });
});

describe('actualizar', () => {
  // Devuelve instancia nueva para que un cambio rechazado no deje la anterior
  // a medio modificar.
  it('no muta la instancia original', () => {
    const original = base();
    original.actualizar({ horasAnticipacion: 48 });
    expect(original.horasAnticipacion).toBe(24);
  });

  it('deja intacta la original cuando el cambio es inválido', () => {
    const original = base().actualizar({ activo: true, nombreRemitente: 'Clínica' });
    expect(() => original.actualizar({ horasAnticipacion: 999 })).toThrow();
    expect(original.horasAnticipacion).toBe(24);
    expect(original.activo).toBe(true);
  });
});
