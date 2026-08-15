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
  /**
   * Caja del consultorio (turno + movimientos). `read` consulta el corte,
   * `create` registra cobros y salidas, `write` abre/cierra el turno y corrige
   * capturas, y `cancel` anula un movimiento — esta última separada a
   * propósito: quien cobra no debería poder borrar lo cobrado.
   */
  | 'Caja'
  | 'Consentimiento'
  | 'Radiografia'
  /**
   * Cuentas del equipo (alta de otros médicos y del asistente). Sin ningún
   * `can` explícito abajo: solo el titular llega, vía `manage all` de 'admin'.
   * Administrar la suscripción es del dueño de la cuenta, no de cada médico
   * que atiende en la clínica.
   */
  | 'Cuenta'
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

    // Todos los roles ven la sala de espera, el directorio de pacientes y el
    // dashboard. 'Reports' NO va aquí a propósito: es de médico/admin
    // solamente (ver el `case` de cada rol) — el asistente no ve reportes.
    can('read', 'WaitingRoom');
    can('read', 'Appointment');
    can('read', 'Patient');
    can('read', 'Dashboard');

    switch (user.rol) {
      case 'admin':
        can('manage', 'all');
        break;
      case 'asistente':
        // El asistente agenda/cancela citas, gestiona llegadas (check-in) y da
        // de alta pacientes. Sobre 'Consultation' SOLO tiene 'start': puede
        // pasar la cita de "en espera" a "en consulta" en la sala de espera
        // (avisarle al médico que ya puede pasar al paciente), pero no
        // 'read'/'write'/'finish' — no puede abrir, leer ni editar la nota
        // clínica. Esa distinción vive también en el frontend: al asistente
        // el botón de "pasar a consulta" NO lo manda a la pantalla de la
        // nota (ver sala-de-espera/page.tsx), porque ahí se toparía con un
        // 403 en cuanto intentara leerla.
        can('checkin', 'Appointment');
        can('start', 'Consultation');
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
        // Caja y Reportes: NADA. Decisión explícita del titular — a
        // diferencia de facturar/cobrar un presupuesto (que sí quedan
        // arriba), el corte de caja y los reportes del consultorio no son
        // trabajo de recepción en esta clínica.
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
        // En un consultorio sin asistente el médico hace todo, incluido el
        // corte; y la cancelación de movimientos es suya, no de recepción.
        can('read', 'Caja');
        can('create', 'Caja');
        can('write', 'Caja');
        can('cancel', 'Caja');
        can('read', 'Consentimiento');
        can('create', 'Consentimiento');
        can('read', 'Radiografia');
        can('create', 'Radiografia');
        can('delete', 'Radiografia');
        // Finanzas (ingresos del consultorio): SOLO médico (y admin vía manage
        // all). El asistente factura pero no ve las ganancias.
        can('read', 'Finanzas');
        can('read', 'Reports');
        break;
    }

    return build();
  }
}
