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
  /**
   * Firmar un documento clínico (periodontograma). Separada de 'write' a
   * propósito: firmar lo vuelve inmutable y es un acto de juicio profesional
   * indelegable — quien captura no necesariamente es quien firma.
   */
  | 'firmar'
  /**
   * Contactar al paciente por un recall. Separada de 'write' porque el
   * asistente SÍ llama y manda mensajes, pero no define cada cuánto debe
   * volver un paciente (eso es 'write' sobre Recall, criterio clínico).
   */
  | 'contactar'
  /**
   * Ver costos, márgenes y comisiones. Es una dimensión distinta de 'read':
   * el asistente lee un caso de laboratorio o un insumo del inventario, pero
   * no lo que cuesta ni lo que deja.
   */
  | 'costear'
  /** Aprobar una liquidación de comisiones: la congela. Solo el titular. */
  | 'aprobar'
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
  /**
   * Receta médica. `cancel` va separado de `write` a propósito —igual que en
   * `Caja`— porque una receta emitida no se edita nunca: se cancela y se
   * emite otra. No existe `write` para este subject por la misma razón.
   */
  | 'Receta'
  | 'Radiografia'
  /**
   * Cuentas del equipo (alta de otros médicos y del asistente). Sin ningún
   * `can` explícito abajo: solo el titular llega, vía `manage all` de 'admin'.
   * Administrar la suscripción es del dueño de la cuenta, no de cada médico
   * que atiende en la clínica.
   */
  | 'Cuenta'
  /**
   * ── Módulos dentales (§5.7 del plan de módulos prioritarios) ──
   * Todos liberados por feature flag: tener el permiso no basta, la clínica
   * además tiene que tener el módulo encendido (ver common/feature-flags).
   */
  /** Recall y reactivación. 'write' configura la periodicidad (criterio
   *  clínico), 'contactar' ejecuta el seguimiento (trabajo de recepción). */
  | 'Recall'
  /** Periodontograma. 'firmar' lo vuelve inmutable; no existe 'delete'. */
  | 'Periodontograma'
  /** Invitaciones y enlaces del portal del paciente. */
  | 'PortalPaciente'
  /** Plantillas, asignación y REVISIÓN de formularios previos a consulta.
   *  La revisión (aplicar respuestas al expediente) es acto clínico. */
  | 'FormularioPaciente'
  /** Casos de laboratorio dental. El costo va aparte, con 'costear'. */
  | 'LaboratorioDental'
  /** Inventario: existencias, lotes y movimientos. */
  | 'Inventario'
  /** Cobros y anticipos en línea del paciente. */
  | 'PagoPaciente'
  /** Reglas, cálculo y liquidación de comisiones por profesional. */
  | 'Comisiones'
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
        // Archivar y eliminar. Ojo con el nombre: `delete` sobre Patient NO
        // permite borrar un expediente. El caso de uso solo consiente el
        // borrado real cuando NUNCA hubo acto médico —un duplicado, un dedazo—
        // y con historial obliga a archivar, porque la NOM-004 exige conservar
        // el expediente cinco años. Se le da al asistente por el mismo motivo
        // que `write`: es quien captura las fichas, y por tanto quien genera y
        // quien detecta los duplicados.
        can('delete', 'Patient');
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
        // Solo lectura, mismo criterio que Consentimiento: el asistente puede
        // reimprimir o consultar una receta que el médico ya emitió, pero
        // prescribir es un acto médico indelegable — `create` es la línea que
        // no se cruza, y `cancel` tampoco, porque anular una receta que ya
        // circula es una decisión clínica.
        can('read', 'Receta');
        // Tomar una radiografía es operar el equipo, no un juicio clínico —
        // tarea típica del asistente dental. Borrar sí se reserva a
        // médico/admin: ahí el riesgo es accidental/malicioso, no de criterio.
        can('read', 'Radiografia');
        can('create', 'Radiografia');
        // ── Módulos dentales (matriz §5.7) ──
        // Recall: el asistente EJECUTA el seguimiento (llama, manda el
        // mensaje, registra el resultado) pero no CONFIGURA cada cuánto debe
        // volver un paciente — eso es criterio clínico ('write', del médico).
        can('read', 'Recall');
        can('contactar', 'Recall');
        // Periodontograma: nada. La tabla dice "según política clínica" para
        // la consulta; el default es negar, y abrirlo se decide por clínica
        // (será un ajuste, no un cambio de código). Crear y firmar jamás:
        // sondear y concluir es acto del odontólogo.
        // Portal y formularios: enviar la invitación y ver si el paciente
        // contestó es trabajo de recepción. Lo que NO puede es 'write' —
        // revisar la respuesta y volcarla al expediente (alergias,
        // medicamentos, antecedentes) exige juicio clínico (§9.3).
        can('read', 'PortalPaciente');
        can('create', 'PortalPaciente');
        can('read', 'FormularioPaciente');
        can('create', 'FormularioPaciente');
        // Laboratorio e inventario: operación pura de consultorio. El
        // asistente manda la corona al laboratorio y descuenta el insumo; lo
        // que NO ve es cuánto cuesta ni cuánto deja ('costear', abajo).
        can('read', 'LaboratorioDental');
        can('create', 'LaboratorioDental');
        can('write', 'LaboratorioDental');
        can('read', 'Inventario');
        can('create', 'Inventario');
        can('write', 'Inventario');
        // Pagos del paciente: genera el link de cobro, como ya registra
        // abonos en recepción. El reembolso NO (mismo criterio que 'cancel'
        // sobre Caja: quien cobra no devuelve).
        can('read', 'PagoPaciente');
        can('create', 'PagoPaciente');
        // Costos, márgenes y comisiones: nada, igual que Finanzas y Reports.
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
        // Archivar y eliminar. `delete` sobre Patient NO significa borrar un
        // expediente: el caso de uso solo permite el borrado real cuando nunca
        // hubo acto médico (duplicado o error de captura), y con historial
        // obliga a archivar. Lo tiene también el asistente porque es quien
        // captura las fichas y quien genera —y detecta— los duplicados.
        can('delete', 'Patient');
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
        can('read', 'Receta');
        can('create', 'Receta');
        can('cancel', 'Receta');
        can('read', 'Radiografia');
        can('create', 'Radiografia');
        can('delete', 'Radiografia');
        // Finanzas (ingresos del consultorio): SOLO médico (y admin vía manage
        // all). El asistente factura pero no ve las ganancias.
        can('read', 'Finanzas');
        can('read', 'Reports');
        // ── Módulos dentales (matriz §5.7) ──
        // Recall: configura la periodicidad y también contacta (en un
        // consultorio sin asistente el médico hace todo).
        can('read', 'Recall');
        can('write', 'Recall');
        can('contactar', 'Recall');
        // Periodontograma: capturar, corregir y firmar. Sin 'delete': un
        // examen firmado es inmutable y se corrige con una adenda (§5.5).
        can('read', 'Periodontograma');
        can('create', 'Periodontograma');
        can('write', 'Periodontograma');
        can('firmar', 'Periodontograma');
        can('read', 'PortalPaciente');
        can('create', 'PortalPaciente');
        // 'write' sobre el formulario = revisar la respuesta y aplicarla al
        // expediente. Es la línea que el asistente no cruza.
        can('read', 'FormularioPaciente');
        can('create', 'FormularioPaciente');
        can('write', 'FormularioPaciente');
        can('read', 'LaboratorioDental');
        can('create', 'LaboratorioDental');
        can('write', 'LaboratorioDental');
        can('read', 'Inventario');
        can('create', 'Inventario');
        can('write', 'Inventario');
        can('read', 'PagoPaciente');
        can('create', 'PagoPaciente');
        // Costos y márgenes sí (mismo criterio que Finanzas). Comisiones NO:
        // configurarlas y aprobar liquidaciones es del titular, incluso
        // cuando el médico es socio — quien cobra no se autoriza el pago.
        can('costear', 'LaboratorioDental');
        can('costear', 'Inventario');
        break;
    }

    return build();
  }
}
