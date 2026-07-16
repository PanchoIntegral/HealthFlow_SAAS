import { RfcInvalidoError } from './factura.errors';

/**
 * RFC del SAT: 12 posiciones para persona moral, 13 para física. Acepta los
 * genéricos XAXX010101000 (público en general) y XEXX010101000 (extranjeros).
 *
 * OJO: valida solo FORMATO, no existencia real ante el SAT — esa validación la
 * hace el PAC al timbrar. Es integridad de dato, no control de acceso.
 */
export class Rfc {
  // 3-4 letras (incluye Ñ y &) + fecha AAMMDD + homoclave [A-Z0-9]{3}.
  private static readonly PATTERN = /^([A-ZÑ&]{3,4})(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])([A-Z\d]{3})$/;

  private constructor(readonly value: string) {}

  static create(raw: string): Rfc {
    const normalized = (raw ?? '').trim().toUpperCase();
    if (!Rfc.PATTERN.test(normalized)) {
      throw new RfcInvalidoError(normalized);
    }
    return new Rfc(normalized);
  }

  /** ¿Es persona física (13 posiciones)? Moral tiene 12. */
  get esPersonaFisica(): boolean {
    return this.value.length === 13;
  }
}
