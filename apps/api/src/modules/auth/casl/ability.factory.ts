import { Injectable } from '@nestjs/common';
import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';
import type { AuthenticatedUser } from '../authenticated-user';

export type Action = 'manage' | 'read' | 'create' | 'write' | 'checkin' | 'start' | 'finish';
export type Subject =
  | 'Appointment'
  | 'WaitingRoom'
  | 'Patient'
  | 'Consultation'
  | 'Dashboard'
  | 'all';
export type AppAbility = MongoAbility<[Action, Subject]>;

/**
 * Define QUÉ puede hacer cada rol. Centraliza el RBAC en un solo lugar
 * (CASL), en vez de dispersar checks de `if (rol === ...)` por los controllers.
 */
@Injectable()
export class CaslAbilityFactory {
  createForUser(user: AuthenticatedUser): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    // Todos los roles ven la sala de espera, el directorio de pacientes y el dashboard.
    can('read', 'WaitingRoom');
    can('read', 'Appointment');
    can('read', 'Patient');
    can('read', 'Dashboard');

    switch (user.rol) {
      case 'admin':
        can('manage', 'all');
        break;
      case 'asistente':
        // El asistente gestiona llegadas (check-in) y da de alta pacientes,
        // pero NO accede al contenido clínico (Consultation).
        can('checkin', 'Appointment');
        can('create', 'Patient');
        break;
      case 'medico':
        // El médico marca llegada, da de alta pacientes y maneja la consulta
        // clínica completa (iniciar, editar la nota, cerrar y leer expediente).
        can('checkin', 'Appointment');
        can('create', 'Patient');
        can('start', 'Consultation');
        can('write', 'Consultation');
        can('finish', 'Consultation');
        can('read', 'Consultation');
        break;
    }

    return build();
  }
}
