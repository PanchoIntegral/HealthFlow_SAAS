import {
  CONFIG_RECETA_DEFAULT,
  nombreConTitulo,
  type EmisorReceta,
  type MedicamentoRecetado,
  type PacienteReceta,
} from '@healthflow/shared-types';
import type { ContextoEmision } from './receta.repository';
import { emisorDe } from '../application/emitir-receta.use-case';
import { Receta } from './receta.entity';
import { RecetaValidator } from './receta-validator';
import {
  MedicamentoControladoNoEmisibleError,
  RecetaIncompletaError,
} from './receta.errors';

const emisor = (over: Partial<EmisorReceta> = {}): EmisorReceta => ({
  medicoNombre: 'Dra. Ana Ruiz',
  cedulaProfesional: '1234567',
  cedulaEspecialidad: '7654321',
  especialidad: 'Medicina interna',
  institucionTitulo: 'Universidad Nacional Autónoma de México',
  nombreClinica: 'Clínica Norte',
  domicilioEstablecimiento: 'Av. Reforma 100, CDMX',
  telefonoClinica: '5555555555',
  logoStorageKey: null,
  leyendaPie: null,
  ...over,
});

const paciente = (over: Partial<PacienteReceta> = {}): PacienteReceta => ({
  nombre: 'Juan Pérez',
  edad: 42,
  sexo: 'masculino',
  ...over,
});

const medicamento = (over: Partial<MedicamentoRecetado> = {}): MedicamentoRecetado => ({
  clave: 'amoxicilina-cap-500',
  denominacionGenerica: 'Amoxicilina',
  denominacionDistintiva: null,
  presentacion: 'Caja con 12 cápsulas de 500 mg',
  dosis: '500 mg',
  via: 'Oral',
  frecuencia: 'cada 8 horas',
  duracion: 'por 7 días',
  indicaciones: null,
  fraccion: 4,
  ...over,
});

const emitir = (over: Partial<Parameters<typeof Receta.emitir>[0]> = {}) =>
  Receta.emitir({
    emisor: emisor(),
    paciente: paciente(),
    diagnosticos: [{ cie10: 'J02.9', descripcion: 'Faringitis aguda' }],
    medicamentos: [medicamento()],
    indicacionesGenerales: null,
    alergiasSnapshot: [],
    ...over,
  });

describe('Receta.emitir', () => {
  it('emite una receta completa y congela el snapshot', () => {
    const receta = emitir();
    expect(receta.contenido.emisor.institucionTitulo).toBe(
      'Universidad Nacional Autónoma de México',
    );
    expect(receta.contenido.paciente.edad).toBe(42);
    expect(receta.contenido.medicamentos).toHaveLength(1);
  });

  it('recorta el ruido de captura', () => {
    const receta = emitir({
      medicamentos: [medicamento({ dosis: '  500 mg  ', denominacionDistintiva: '   ' })],
      indicacionesGenerales: '   ',
    });
    expect(receta.contenido.medicamentos[0]!.dosis).toBe('500 mg');
    // Cadena en blanco ⇒ null, no ''; la hoja impresa omite la línea entera.
    expect(receta.contenido.medicamentos[0]!.denominacionDistintiva).toBeNull();
    expect(receta.contenido.indicacionesGenerales).toBeNull();
  });

  // ── Datos del emisor (RIS art. 64) ─────────────────────────────
  it.each([
    ['emisor.cedulaProfesional', { cedulaProfesional: '' }],
    ['emisor.institucionTitulo', { institucionTitulo: '' }],
    ['emisor.domicilioEstablecimiento', { domicilioEstablecimiento: '' }],
    ['emisor.medicoNombre', { medicoNombre: '' }],
  ])('exige %s', (campo, over) => {
    expect(() => emitir({ emisor: emisor(over) })).toThrow(RecetaIncompletaError);
    try {
      emitir({ emisor: emisor(over) });
    } catch (e) {
      expect((e as RecetaIncompletaError).campos).toContain(campo);
    }
  });

  it('NO exige cédula de especialidad: el art. 65 solo la pide a especialistas', () => {
    expect(() => emitir({ emisor: emisor({ cedulaEspecialidad: null }) })).not.toThrow();
  });

  // ── Datos del paciente (RIS art. 65) ───────────────────────────
  it('exige el sexo del paciente', () => {
    expect(() =>
      emitir({ paciente: paciente({ sexo: null as unknown as PacienteReceta['sexo'] }) }),
    ).toThrow(RecetaIncompletaError);
  });

  it("acepta 'no_especificado' como sexo: se preguntó y el paciente no lo declaró", () => {
    expect(() => emitir({ paciente: paciente({ sexo: 'no_especificado' }) })).not.toThrow();
  });

  // ── Prescripción (RIS arts. 28 y 29) ───────────────────────────
  it.each([
    ['denominacionGenerica'],
    ['presentacion'],
    ['dosis'],
    ['via'],
    ['frecuencia'],
    ['duracion'],
  ])('exige %s en cada medicamento, con su índice', (campo) => {
    try {
      emitir({ medicamentos: [medicamento(), medicamento({ [campo]: '' })] });
      fail('debió lanzar');
    } catch (e) {
      expect((e as RecetaIncompletaError).campos).toContain(`medicamentos[1].${campo}`);
    }
  });

  it('no exige la denominación distintiva: es opcional por diseño de la norma', () => {
    expect(() =>
      emitir({ medicamentos: [medicamento({ denominacionDistintiva: null })] }),
    ).not.toThrow();
  });

  it('exige al menos un medicamento', () => {
    try {
      emitir({ medicamentos: [] });
      fail('debió lanzar');
    } catch (e) {
      expect((e as RecetaIncompletaError).campos).toContain('medicamentos');
    }
  });

  // ── Fracciones del art. 226 LGS ────────────────────────────────
  it.each([[1], [2]])('bloquea la fracción %i (recetario COFEPRIS)', (fraccion) => {
    expect(() => emitir({ medicamentos: [medicamento({ fraccion })] })).toThrow(
      MedicamentoControladoNoEmisibleError,
    );
  });

  it.each([[3], [4], [5], [6]])('permite emitir la fracción %i', (fraccion) => {
    expect(() => emitir({ medicamentos: [medicamento({ fraccion })] })).not.toThrow();
  });

  it('bloquea aunque solo UNO de los medicamentos sea controlado', () => {
    expect(() =>
      emitir({
        medicamentos: [medicamento(), medicamento({ denominacionGenerica: 'Clonazepam', fraccion: 2 })],
      }),
    ).toThrow(MedicamentoControladoNoEmisibleError);
  });

  it('el error de fracción nombra los medicamentos bloqueados', () => {
    try {
      emitir({ medicamentos: [medicamento({ denominacionGenerica: 'Morfina', fraccion: 1 })] });
      fail('debió lanzar');
    } catch (e) {
      const detalle = (e as MedicamentoControladoNoEmisibleError).details();
      expect(detalle.medicamentos).toEqual([{ denominacionGenerica: 'Morfina', fraccion: 1 }]);
      expect((e as Error).message).toContain('COFEPRIS');
    }
  });

  it('permite el texto libre: el sistema no puede afirmar la fracción de una cadena tecleada', () => {
    expect(() =>
      emitir({ medicamentos: [medicamento({ clave: null, fraccion: null })] }),
    ).not.toThrow();
  });

  /**
   * El orden importa para la UX: si la receta trae un controlado Y le faltan
   * campos, decirle primero "te falta la dosis" manda al médico a llenar
   * campos de algo que nunca se va a poder emitir.
   */
  it('el bloqueo por fracción tiene prioridad sobre los campos faltantes', () => {
    expect(() =>
      emitir({ medicamentos: [medicamento({ fraccion: 1, dosis: '', via: '' })] }),
    ).toThrow(MedicamentoControladoNoEmisibleError);
  });
});

describe('RecetaValidator', () => {
  it('devuelve lista vacía cuando todo está completo', () => {
    expect(RecetaValidator.camposFaltantes(emisor(), paciente(), [medicamento()])).toEqual([]);
  });

  it('acumula todos los faltantes en vez de parar en el primero', () => {
    const campos = RecetaValidator.camposFaltantes(
      emisor({ cedulaProfesional: '', institucionTitulo: '' }),
      paciente({ nombre: '' }),
      [medicamento({ dosis: '' })],
    );
    expect(campos).toEqual(
      expect.arrayContaining([
        'emisor.cedulaProfesional',
        'emisor.institucionTitulo',
        'paciente.nombre',
        'medicamentos[0].dosis',
      ]),
    );
  });
});

describe('nombreConTitulo (membrete impreso)', () => {
  it('antepone el título cuando el nombre no lo trae', () => {
    expect(nombreConTitulo('Dra.', 'Guadalupe Villa')).toBe('Dra. Guadalupe Villa');
  });

  it('NO lo duplica si el nombre ya venía capturado con el título', () => {
    // Caso real de las cuentas existentes: durante mucho tiempo el único lugar
    // para el trato fue el campo de nombre.
    expect(nombreConTitulo('Dra.', 'Dra. Mariana Cervantes')).toBe('Dra. Mariana Cervantes');
    expect(nombreConTitulo('Dr.', 'dr. Carlos López')).toBe('dr. Carlos López');
  });

  it('sin título configurado devuelve el nombre tal cual', () => {
    expect(nombreConTitulo(null, 'Guadalupe Villa')).toBe('Guadalupe Villa');
    // Las recetas emitidas antes de que existiera el campo no lo traen.
    expect(nombreConTitulo(undefined, 'Guadalupe Villa')).toBe('Guadalupe Villa');
  });

  it('no confunde un nombre que empieza parecido', () => {
    expect(nombreConTitulo('Dr.', 'Draco Ramírez')).toBe('Dr. Draco Ramírez');
  });
});

describe('emisorDe (congelado del membrete)', () => {
  const contexto = (over: Partial<ContextoEmision> = {}): ContextoEmision => ({
    medicoNombre: 'Guadalupe Villa',
    cedulaProfesional: '1234567',
    cedulaEspecialidad: null,
    especialidad: 'Podiatría',
    institucionTitulo: 'Universidad Autónoma de Sinaloa',
    titulo: 'Dra.',
    configReceta: { ...CONFIG_RECETA_DEFAULT, colorAcento: '#1d4ed8', logoTamano: 'grande' },
    nombreClinica: 'Unidad Médica Pisada Sana',
    direccionClinica: 'Av. Francisco I. Madero #1327',
    telefonoClinica: '686 554 1920',
    logoStorageKey: 'tenant/x/logo/abc.png',
    leyendaPie: 'Horario: 9:00 a 18:00',
    pacienteNombre: 'Sonia Lara',
    pacienteFechaNacimiento: '1964-01-01',
    pacienteSexo: 'femenino',
    pacienteAlergias: [],
    ...over,
  });

  it('congela la apariencia vigente al emitir', () => {
    const emisor = emisorDe(contexto());

    // Si esto dejara de copiarse y se resolviera al leer, cambiar el diseño de
    // la clínica reescribiría el aspecto de todas las recetas ya firmadas.
    expect(emisor.config).toEqual(
      expect.objectContaining({ colorAcento: '#1d4ed8', logoTamano: 'grande' }),
    );
    expect(emisor.titulo).toBe('Dra.');
  });

  it('el snapshot no cambia si la clínica cambia su diseño después', () => {
    const emisor = emisorDe(contexto());
    const despues = contexto({
      configReceta: { ...CONFIG_RECETA_DEFAULT, colorAcento: '#9d174d', logoTamano: 'chico' },
    });
    const emisorNuevo = emisorDe(despues);

    expect(emisor.config?.colorAcento).toBe('#1d4ed8');
    expect(emisorNuevo.config?.colorAcento).toBe('#9d174d');
  });
});
