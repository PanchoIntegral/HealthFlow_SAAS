import { Injectable } from '@nestjs/common';
import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';
import type { AuthenticatedUser } from '../authenticated-user';

export type Action = 'manage' | 'read' | 'checkin' | 'start' | 'finish';
export type Subject = 'Appointment' | 'WaitingRoom' | 'all';
export type AppAbility = MongoAbility<[Action, Subject]>;

/**
 * Define QUÉ puede hacer cada rol. Centraliza el RBAC en un solo lugar
 * (CASL), en vez de dispersar checks de `if (rol === ...)` por los controllers.
 */
@Injectable()
export class CaslAbilityFactory {
  createForUser(user: AuthenticatedUser): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    // Todos los roles ven la sala de espera de su clínica.
    can('read', 'WaitingRoom');
    can('read', 'Appointment');

    switch (user.rol) {
      case 'admin':
        can('manage', 'all');
        break;
      case 'asistente':
        // El asistente gestiona llegadas (check-in) pero no la consulta clínica.
        can('checkin', 'Appointment');
        break;
      case 'medico':
        // El médico marca llegada e inicia/cierra la consulta.
        can('checkin', 'Appointment');
        can('start', 'Appointment');
        can('finish', 'Appointment');
        break;
    }

    return build();
  }
}
