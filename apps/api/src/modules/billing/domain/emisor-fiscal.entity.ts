import { Rfc } from './rfc.value-object';

export interface EmisorFiscalProps {
  id: string;
  rfc: Rfc;
  razonSocial: string;
  regimenFiscal: string;
  codigoPostal: string;
  facturapiOrgId: string | null;
}

/** Datos fiscales de la clínica emisora (uno por tenant en el MVP). */
export class EmisorFiscal {
  private constructor(private readonly props: EmisorFiscalProps) {}

  static fromState(props: EmisorFiscalProps): EmisorFiscal {
    return new EmisorFiscal({ ...props });
  }

  get id(): string {
    return this.props.id;
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
  get facturapiOrgId(): string | null {
    return this.props.facturapiOrgId;
  }
}
