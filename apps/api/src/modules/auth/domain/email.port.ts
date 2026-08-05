export interface EmailInput {
  to: string;
  subject: string;
  html: string;
}

/**
 * Puerto de envío de correo. Genérico a propósito — la plantilla HTML de
 * "restablecer contraseña" vive en AuthService (dominio del negocio), no
 * aquí: este puerto solo sabe mandar un correo, sin saber para qué.
 */
export interface EmailPort {
  enviar(input: EmailInput): Promise<void>;
}

export const EMAIL_PORT = Symbol('EMAIL_PORT');
