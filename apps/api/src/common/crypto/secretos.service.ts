import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import {
  cargarKeyring,
  cifrarSecreto,
  descifrarSecreto,
  SecretoCifradoError,
  type Keyring,
} from './secreto-cifrado';

/**
 * Envoltura Nest del cifrado de secretos. La lógica vive en `secreto-cifrado.ts`
 * como funciones puras y testeables; aquí solo se resuelve el llavero desde
 * env.
 *
 * El llavero se carga PEREZOSAMENTE, igual que los demás getters de `env`: una
 * instalación donde todas las clínicas usan el número compartido no tiene
 * secretos que cifrar y no debe fallar al arrancar por no haber configurado
 * unas llaves que no va a usar.
 */
@Injectable()
export class SecretosService {
  private readonly logger = new Logger(SecretosService.name);
  private keyring: Keyring | null = null;

  /**
   * @param aad Dato asociado que ata el ciphertext a su dueño. Para la config
   *   de WhatsApp es el `tenantId`: una fila copiada a otra clínica no
   *   descifra.
   */
  cifrar(plano: string, aad: string): string {
    return cifrarSecreto(plano, aad, this.getKeyring());
  }

  descifrar(cifrado: string, aad: string): string {
    return descifrarSecreto(cifrado, aad, this.getKeyring());
  }

  /**
   * ¿Está el cifrado utilizable? Lo consulta la pantalla de configuración para
   * poder decir "falta configurar las llaves" en vez de reventar cuando el
   * titular pega su token.
   */
  disponible(): boolean {
    try {
      this.getKeyring();
      return true;
    } catch (error) {
      this.logger.warn(
        `Cifrado de secretos no disponible: ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }

  private getKeyring(): Keyring {
    if (!this.keyring) {
      let llaves: string;
      try {
        llaves = env.whatsappTokenKeys;
      } catch {
        // Mensaje propio: el de `required()` habla de una variable de entorno
        // y quien lo va a leer es quien configura una clínica, no quien
        // despliega.
        throw new SecretoCifradoError(
          'No hay llaves de cifrado configuradas (WHATSAPP_TOKEN_KEYS): ' +
            'no se puede guardar el token de una clínica con número propio',
        );
      }
      this.keyring = cargarKeyring(llaves, env.whatsappTokenKeyActive);
    }
    return this.keyring;
  }
}
