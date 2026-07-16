import { Rfc } from './rfc.value-object';

export interface ReceptorFiscalInput {
  patientId: string | null;
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  codigoPostal: string;
  usoCfdi: string;
}

export interface ReceptorFiscalProps {
  id: string | null; // null hasta persistir
  patientId: string | null;
  rfc: Rfc;
  razonSocial: string;
  regimenFiscal: string;
  codigoPostal: string;
  usoCfdi: string;
}

/**
 * Datos fiscales del receptor (paciente o público en general). Contiene datos
 * personales bajo LFPDPPP (rfc, razón social) — cuidar en logs y exportaciones.
 */
export class ReceptorFiscal {
  private constructor(private readonly props: ReceptorFiscalProps) {}

  /** Valida el RFC (formato SAT) al construir desde input del cliente. */
  static crear(input: ReceptorFiscalInput): ReceptorFiscal {
    return new ReceptorFiscal({
      id: null,
      patientId: input.patientId,
      rfc: Rfc.create(input.rfc),
      razonSocial: input.razonSocial.trim(),
      regimenFiscal: input.regimenFiscal,
      codigoPostal: input.codigoPostal,
      usoCfdi: input.usoCfdi,
    });
  }

  static fromState(props: ReceptorFiscalProps): ReceptorFiscal {
    return new ReceptorFiscal({ ...props });
  }

  get id(): string | null {
    return this.props.id;
  }
  get patientId(): string | null {
    return this.props.patientId;
  }
  get rfc(): Rfc {
    return this.props.rfc;
  }
  get razonSocial(): string {
    return this.props.razonSocial;
  }
  get regimenFiscal(): string {
    return this.props.regimenFiscal;
  }
  get codigoPostal(): string {
    return this.props.codigoPostal;
  }
  get usoCfdi(): string {
    return this.props.usoCfdi;
  }
}
