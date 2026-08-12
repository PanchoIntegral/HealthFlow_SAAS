import { Injectable } from '@nestjs/common';
import { RequestContextService } from './request-context';

/**
 * Actor de las acciones que NO vienen de un usuario: el barrido de
 * recordatorios y las respuestas que el paciente manda por WhatsApp.
 *
 * Es el UUID nil, y existe solo dentro del proceso: `AuditService` lo traduce
 * a `user_id = NULL` antes de escribir la bitácora. Las alternativas eran
 * peores:
 *
 *  - un UUID inventado viola la FK de `audit_log.user_id` hacia `users`;
 *  - reusar al dueño de la clínica falsea la bitácora, y la NOM-004 pide
 *    justamente saber quién hizo cada cosa;
 *  - crear un usuario de sistema por tenant lo mete en `listDoctors`, en el
 *    conteo de cupos del plan y en CASL.
 *
 * Ningún token JWT puede producirlo: el `sub` siempre sale de una fila real de
 * `users`, y ninguna existe con este id.
 */
export const ACTOR_SISTEMA = '00000000-0000-0000-0000-000000000000';

/**
 * Corre un caso de uso como el sistema, con un tenant explícito.
 *
 * Esto es lo que permite reutilizar tal cual los casos de uso escritos para
 * peticiones HTTP (`CancelAppointmentUseCase` y compañía) desde el scheduler y
 * el webhook, sin duplicar su lógica ni relajar sus dependencias: dentro del
 * `run`, `TenantDbService`, `AuditService` y los notificadores encuentran el
 * contexto que esperan.
 *
 * El `tenantId` NUNCA debe salir de datos que controle quien llama desde
 * fuera: siempre de una función SECURITY DEFINER que lo resolvió contra la
 * base (ver 0022).
 */
@Injectable()
export class SystemContextRunner {
  constructor(private readonly ctx: RequestContextService) {}

  run<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return this.ctx.run({ tenantId, userId: ACTOR_SISTEMA, rol: 'admin' }, fn);
  }
}
