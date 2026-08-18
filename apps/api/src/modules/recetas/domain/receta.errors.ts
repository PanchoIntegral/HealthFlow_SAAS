import type { MedicamentoRecetado } from '@healthflow/shared-types';
import { DomainError } from '../../../common/errors/domain.error';

/**
 * Faltan datos que la ley exige en la receta (RIS arts. 28, 29, 64 y 65).
 * Espejo de `IncompleteClinicalNoteError`: devuelve QUÉ falta, no solo que
 * algo falta, para que la UI pueda señalar el campo exacto.
 */
export class RecetaIncompletaError extends DomainError {
  readonly code = 'RecetaIncompleta';
  readonly httpStatus = 422;

  constructor(readonly campos: string[]) {
    super(
      'La receta no cumple los datos que exige el Reglamento de Insumos para la Salud: ' +
        campos.join(', '),
    );
  }

  override details(): Record<string, unknown> {
    return { campos: this.campos };
  }
}

/**
 * La receta incluye medicamentos de las fracciones I o II del art. 226 LGS.
 *
 * No es una limitación técnica ni un permiso que un administrador pueda
 * levantar: esos medicamentos solo pueden prescribirse en el recetario
 * especial con código de barras que COFEPRIS expide al médico a su nombre
 * (trámite COFEPRIS-03-006-A). Una hoja impresa desde HealthFlow NO es ese
 * recetario, y emitirla produciría un documento que la farmacia no puede
 * surtir y que expone al médico que lo firmó.
 *
 * El mensaje EXPLICA todo eso a propósito: el médico tiene que entender que no
 * es un error del sistema ni un campo que le falte llenar, o va a seguir
 * intentándolo.
 */
export class MedicamentoControladoNoEmisibleError extends DomainError {
  readonly code = 'MedicamentoControladoNoEmisible';
  readonly httpStatus = 422;

  constructor(readonly bloqueados: MedicamentoRecetado[]) {
    super(
      'Esta receta incluye medicamentos de las fracciones I o II del artículo 226 de la Ley ' +
        'General de Salud (estupefacientes y psicotrópicos del grupo II): ' +
        bloqueados.map((m) => m.denominacionGenerica).join(', ') +
        '. Solo pueden prescribirse en el recetario especial con código de barras que COFEPRIS ' +
        'expide a nombre del médico; HealthFlow no puede emitir ese formato. Prescríbelos en tu ' +
        'recetario oficial y, si lo necesitas, deja constancia en el plan terapéutico de la nota.',
    );
  }

  override details(): Record<string, unknown> {
    return {
      medicamentos: this.bloqueados.map((m) => ({
        denominacionGenerica: m.denominacionGenerica,
        fraccion: m.fraccion,
      })),
    };
  }
}

export class RecetaNoEncontradaError extends DomainError {
  readonly code = 'RecetaNoEncontrada';
  readonly httpStatus = 404;

  constructor() {
    super('Receta no encontrada');
  }
}

/** Cancelar dos veces no significa nada; la base además lo impide con un UNIQUE. */
export class RecetaYaCanceladaError extends DomainError {
  readonly code = 'RecetaYaCancelada';
  readonly httpStatus = 409;

  constructor() {
    super('La receta ya está cancelada');
  }
}
