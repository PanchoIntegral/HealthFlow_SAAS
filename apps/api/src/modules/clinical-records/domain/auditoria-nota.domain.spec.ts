import { EMPTY_NOTA_EVOLUCION, type NotaEvolucionContent } from '@healthflow/shared-types';
import { asegurarDetalleAuditable } from '../../../common/privacidad/datos-sensibles';
import {
  VENTANA_AUDITORIA_AUTOSAVE_MS,
  debeAuditarAutosave,
  detalleCierreFallido,
  huellaContenido,
} from './auditoria-nota';
import {
  EstructuraNotaInvalidaError,
  FirmaIncompletaError,
  IncompleteClinicalNoteError,
  NotaDeOtroMedicoError,
} from './clinical-note.errors';

const LLAVE = 'llave-de-prueba';
const SECRETO_CLINICO = 'Dolor torácico opresivo irradiado a brazo izquierdo';

function nota(padecimiento: string): NotaEvolucionContent {
  return { ...EMPTY_NOTA_EVOLUCION, padecimientoActual: `<p>${padecimiento}</p>` };
}

describe('huellaContenido', () => {
  it('es estable para el mismo contenido y cambia con cualquier cambio', () => {
    expect(huellaContenido(nota(SECRETO_CLINICO), LLAVE)).toBe(huellaContenido(nota(SECRETO_CLINICO), LLAVE));
    expect(huellaContenido(nota(SECRETO_CLINICO), LLAVE)).not.toBe(huellaContenido(nota(`${SECRETO_CLINICO}.`), LLAVE));
  });

  it('depende de la llave del servidor: sin ella no se confirma un valor por diccionario', () => {
    expect(huellaContenido(nota('Negados'), LLAVE)).not.toBe(huellaContenido(nota('Negados'), 'otra-llave'));
  });

  it('es corta, no contiene texto clínico y pasa la clasificación de la bitácora', () => {
    const huella = huellaContenido(nota(SECRETO_CLINICO), LLAVE);
    expect(huella).toMatch(/^[0-9a-f]{16}$/);
    expect(() => asegurarDetalleAuditable({ huella })).not.toThrow();
  });
});

describe('debeAuditarAutosave', () => {
  const t0 = new Date('2026-09-13T10:00:00Z');
  const despues = (ms: number) => new Date(t0.getTime() + ms);

  it('registra el primer guardado', () => {
    expect(debeAuditarAutosave(null, 'a', t0)).toBe(true);
  });

  it('nunca repite un contenido idéntico, aunque pase la ventana', () => {
    expect(debeAuditarAutosave({ huella: 'a', registradaEn: t0 }, 'a', despues(3_600_000))).toBe(false);
  });

  it('un cambio dentro de la ventana no se registra; pasada la ventana, sí', () => {
    const ultima = { huella: 'a', registradaEn: t0 };
    expect(debeAuditarAutosave(ultima, 'b', despues(VENTANA_AUDITORIA_AUTOSAVE_MS - 1))).toBe(false);
    expect(debeAuditarAutosave(ultima, 'b', despues(VENTANA_AUDITORIA_AUTOSAVE_MS))).toBe(true);
  });
});

describe('detalleCierreFallido', () => {
  it('guarda códigos y rutas de los requisitos incumplidos, sin valores', () => {
    const detalle = detalleCierreFallido(
      new IncompleteClinicalNoteError([
        { codigo: 'CAMPO_REQUERIDO', ruta: 'padecimientoActual' },
        { codigo: 'MOTIVO_REQUERIDO', ruta: 'extension.car_fraccion_eyeccion', reglaId: 'v1.cardiologia.insuficiencia_cardiaca.fevi' },
      ]),
      'cita-1',
    );
    expect(detalle).toEqual({
      appointmentId: 'cita-1',
      motivo: 'IncompleteClinicalNote',
      errores: [
        { codigo: 'CAMPO_REQUERIDO', ruta: 'padecimientoActual' },
        { codigo: 'MOTIVO_REQUERIDO', ruta: 'extension.car_fraccion_eyeccion', reglaId: 'v1.cardiologia.insuficiencia_cardiaca.fevi' },
      ],
      totalErrores: 2,
    });
    expect(() => asegurarDetalleAuditable(detalle!)).not.toThrow();
  });

  it('cubre forma inválida, firma incompleta y firma ajena', () => {
    expect(detalleCierreFallido(new EstructuraNotaInvalidaError(['diagnosticos.0']), 'c')).toMatchObject({
      motivo: 'EstructuraNotaInvalida',
      rutas: ['diagnosticos.0'],
    });
    expect(detalleCierreFallido(new FirmaIncompletaError(['cedula']), 'c')).toMatchObject({
      motivo: 'FirmaIncompleta',
      faltantes: ['cedula'],
    });
    expect(detalleCierreFallido(new NotaDeOtroMedicoError(), 'c')).toEqual({ appointmentId: 'c', motivo: 'NotaDeOtroMedico' });
  });

  it('no audita errores que no son rechazos de la nota', () => {
    expect(detalleCierreFallido(new Error('conexión'), 'c')).toBeNull();
    expect(detalleCierreFallido('texto', 'c')).toBeNull();
  });

  it('acota la lista para no convertir la bitácora en un volcado', () => {
    const muchos = Array.from({ length: 80 }, (_, i) => ({ codigo: 'CAMPO_REQUERIDO' as const, ruta: `extension.c${i}` }));
    const detalle = detalleCierreFallido(new IncompleteClinicalNoteError(muchos), 'c')!;
    expect((detalle.errores as unknown[]).length).toBe(50);
    expect(detalle.totalErrores).toBe(80);
  });
});
