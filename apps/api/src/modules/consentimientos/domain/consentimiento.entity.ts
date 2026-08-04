import { ConsentimientoInvalidoError } from './consentimiento.errors';

export interface NewConsentimientoInput {
  patientId: string;
  presupuestoId: string | null;
  doctorId: string;
  procedimiento: string;
  contenido: string;
}

export interface ConsentimientoProps {
  patientId: string;
  presupuestoId: string | null;
  doctorId: string;
  procedimiento: string;
  contenido: string;
}

/**
 * Entidad de dominio del consentimiento informado. A diferencia de
 * Presupuesto/Factura, no tiene máquina de estados ni método de mutación: se
 * crea una sola vez, ya completo. La inmutabilidad es estructural (no existe
 * un `editar()` que llamar), reforzada además por el REVOKE UPDATE/DELETE de
 * la migración — no es una regla que el dominio tenga que hacer cumplir.
 */
export class Consentimiento {
  private constructor(private readonly props: ConsentimientoProps) {}

  static crear(input: NewConsentimientoInput): Consentimiento {
    const procedimiento = input.procedimiento.trim();
    if (!procedimiento) {
      throw new ConsentimientoInvalidoError('El procedimiento no puede estar vacío');
    }
    const contenido = input.contenido.trim();
    if (!contenido) {
      throw new ConsentimientoInvalidoError(
        'Debe describirse qué se explicó al paciente (riesgos, alternativas, indicaciones)',
      );
    }

    return new Consentimiento({
      patientId: input.patientId,
      presupuestoId: input.presupuestoId,
      doctorId: input.doctorId,
      procedimiento,
      contenido,
    });
  }

  toProps(): ConsentimientoProps {
    return { ...this.props };
  }
}
