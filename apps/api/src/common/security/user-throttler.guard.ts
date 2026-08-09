import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { resolveClientIp, type IpBearingRequest } from './client-ip';
import type { AuthenticatedUser } from '../../modules/auth/authenticated-user';

/**
 * Rate limiting por USUARIO en vez de por IP.
 *
 * El guard global cuenta por IP, que es lo correcto para el login y para todo
 * lo anónimo: ahí la IP es lo único que hay. Pero en una operación cara y ya
 * autenticada, contar por IP castiga al consultorio entero — cinco médicos
 * detrás del mismo módem compartirían un solo cupo, y el segundo en terminar
 * su consulta se llevaría el 429 por algo que hizo su colega.
 *
 * Sin usuario en la petición cae a la IP: un endpoint mal configurado que
 * quede sin autenticar no debe terminar sin límite alguno.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: IpBearingRequest & { user?: AuthenticatedUser }): Promise<string> {
    return req.user?.userId ?? resolveClientIp(req);
  }
}
