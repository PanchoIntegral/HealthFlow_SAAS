import { Injectable } from '@nestjs/common';
import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';
import type { AuthenticatedUser } from '../authenticated-user';

export type Action =
  | 'manage'
  | 'read'
  | 'create'
  | 'write'
  | 'checkin'
  | 'cancel'
  | 'start'
  | 'finish'
  /** Registrar un abono: es cobrar, no cotizar — por eso es su propia acción. */
  | 'abonar'
  | 'delete';
export type Subject =
  | 'Appointment'
  | 'WaitingRoom'
  | 'Patient'
  | 'Consultation'
  | 'Dashboard'
  | 'Reports'
  | 'Factura'
  | 'Finanzas'
  | 'Presupuesto'
  | 'Consentimiento'
  | 'Radiografia'
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
    can('read', 'Reports');

    switch (user.rol) {
      case 'admin':
        can('manage', 'all');
        break;
      case 'asistente':
        // El asistente agenda/cancela citas, gestiona llegadas (check-in) y da
        // de alta pacientes, pero NO accede al contenido clínico (Consultation).
        can('checkin', 'Appointment');
        can('create', 'Appointment');
        can('cancel', 'Appointment');
        can('create', 'Patient');
        // Alergias y antecedentes: sí, aunque el asistente no toque el
        // contenido clínico. Es el dato que se captura en recepción al llenar
        // la ficha, y que llegue completo importa más que quién lo teclea —
        // una alergia sin registrar es un riesgo, no un tema de permisos.
        can('write', 'Patient');
        // Facturar es trabajo de recepción: crea y consulta facturas, pero la
        // cancelación (acto fiscal ante el SAT) queda en médico/admin.
        can('create', 'Factura');
        can('read', 'Factura');
        // Cobranza: el asistente recibe el dinero en recepción, así que puede
        // consultar el presupuesto y registrar abonos. NO puede cotizar ni
        // cambiar precios — eso es una decisión clínica y comercial del médico.
        can('read', 'Presupuesto');
        can('abonar', 'Presupuesto');
        // Documentar riesgos/alternativas es juicio clínico del médico; el
        // asistente puede consultarlos, no crearlos (mismo criterio que Presupuesto).
        can('read', 'Consentimiento');
        // Tomar una radiografía es operar el equipo, no un juicio clínico —
        // tarea típica del asistente dental. Borrar sí se reserva a
        // médico/admin: ahí el riesgo es accidental/malicioso, no de criterio.
        can('read', 'Radiografia');
        can('create', 'Radiografia');
        break;
      case 'medico':
        // El médico agenda/cancela citas, marca llegada, da de alta pacientes
        // y maneja la consulta clínica completa (iniciar, editar la nota,
        // cerrar y leer expediente).
        can('checkin', 'Appointment');
        can('create', 'Appointment');
        can('cancel', 'Appointment');
        can('create', 'Patient');
        can('write', 'Patient');
        can('start', 'Consultation');
        can('write', 'Consultation');
        can('finish', 'Consultation');
        can('read', 'Consultation');
        can('create', 'Factura');
        can('read', 'Factura');
        can('cancel', 'Factura');
        // El médico cotiza el tratamiento y también puede cobrarlo.
        can('read', 'Presupuesto');
        can('create', 'Presupuesto');
        can('write', 'Presupuesto');
        can('abonar', 'Presupuesto');
        can('read', 'Consentimiento');
        can('create', 'Consentimiento');
        can('read', 'Radiografia');
        can('create', 'Radiografia');
        can('delete', 'Radiografia');
        // Finanzas (ingresos del consultorio): SOLO médico (y admin vía manage
        // all). El asistente factura pero no ve las ganancias.
        can('read', 'Finanzas');
        break;
    }

    return build();
  }
}
