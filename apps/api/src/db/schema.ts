import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  jsonb,
  numeric,
  boolean,
  integer,
  bigint,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * `tenant_id` con el mismo DEFAULT que tiene la columna en Postgres. Declararlo
 * aquí es lo que permite insertar con el constructor tipado sin pasar el tenant
 * a mano: lo pone la base a partir del tenant fijado en la transacción, que es
 * justo lo que hace imposible escribir en la clínica equivocada.
 */
const tenantIdConDefault = () =>
  uuid('tenant_id')
    .notNull()
    .default(sql`current_tenant_id()`);

/**
 * Subconjunto del modelo de datos necesario para el slice de sala de espera.
 * El resto de tablas (clinical_records, clinical_notes, note_amendments) se
 * agregan en iteraciones posteriores siguiendo el mismo patrón.
 *
 * NOTA: las políticas RLS y los índices no se declaran aquí — viven en las
 * migraciones SQL (src/db/migrations/*.sql), que son la fuente de verdad del
 * esquema físico. Drizzle se usa como query builder tipado sobre ese esquema.
 */

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  nombreClinica: text('nombre_clinica').notNull(),
  rfc: text('rfc'),
  plan: text('plan').notNull().default('free'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  subscriptionStatus: text('subscription_status').notNull().default('none'),
  /** 'mensual' | 'anual' — qué Price de Stripe se está cobrando. */
  billingPeriod: text('billing_period').notNull().default('mensual'),
  /** Fin del periodo ya pagado, según Stripe. Informativo para la UI. */
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  /**
   * Hasta cuándo se tolera el impago antes de dejar la cuenta en solo lectura
   * (ver 0020 y common/subscription/). NULL = no hay impago pendiente.
   */
  graceUntil: timestamp('grace_until', { withTimezone: true }),
  /**
   * Último cobro exitoso. Su ausencia significa "nunca pagó" (trial vencido),
   * y esos no reciben días de gracia.
   */
  ultimoPagoAt: timestamp('ultimo_pago_at', { withTimezone: true }),
  /**
   * Asistente de transcripción con IA (ver 0019). Apagado por omisión: mandar
   * el audio de una consulta a un tercero es una decisión de cada clínica.
   */
  asistenteIaActivo: boolean('asistente_ia_activo').notNull().default(false),
  /** Membrete para documentos impresos (ver 0024_datos_clinica.sql). */
  direccion: text('direccion'),
  telefono: text('telefono'),
  /**
   * Logo de la clínica para el membrete de la receta impresa (ver
   * 0031_logo_clinica.sql). Clave de storage, NO url: se resuelve a una URL
   * firmada de corta duración en cada lectura (ver ALMACENAMIENTO_PORT).
   */
  logoStorageKey: text('logo_storage_key'),
  /** Texto libre para el pie de la receta impresa. */
  leyendaPie: text('leyenda_pie'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  // Con DEFAULT desde 0018: dar de alta a un compañero corre con el tenant ya
  // fijado, así que el insert no necesita nombrar la clínica.
  tenantId: tenantIdConDefault(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  nombre: text('nombre').notNull(),
  rol: text('rol').notNull(), // 'medico' | 'asistente' | 'admin'
  /**
   * Capacidad clínica, independiente del rol (permisos): el dueño de una
   * cuenta self-serve es 'admin' y a la vez el médico que atiende, así que
   * debe poder aparecer en la agenda sin degradar sus permisos.
   */
  esMedico: boolean('es_medico').notNull().default(false),
  cedulaProfesional: text('cedula_profesional'),
  /** Distinta de la profesional: certifica la especialidad, no el ejercicio general. */
  cedulaEspecialidad: text('cedula_especialidad'),
  /**
   * Institución que expidió el título (RIS art. 64, ver 0026). Del médico y no
   * de la clínica: dos médicos del mismo consultorio pueden venir de
   * universidades distintas. Nullable; lo exige RecetaValidator al emitir.
   */
  institucionTitulo: text('institucion_titulo'),
  /** Etiqueta editable que se muestra en el selector de agenda. */
  especialidad: text('especialidad'),
  /**
   * Clave controlada del catálogo (ver PERFILES en shared-types): dirige qué
   * campos tiene su nota y qué diagnósticos se le priorizan. Distinta de
   * `especialidad`, que es texto libre para mostrar (ver 0012_especialidad.sql).
   */
  especialidadKey: text('especialidad_key').notNull().default('general'),
  /**
   * '12h' | '24h' (ver 0030). Preferencia personal de cómo se muestra la
   * hora — calendario, dashboard, sala de espera, corte de caja.
   */
  formatoHora: text('formato_hora').notNull().default('24h'),
  /**
   * Baja lógica (ver 0018_cuentas_equipo.sql): una cuenta inactiva no puede
   * iniciar sesión y libera su cupo del plan, pero conserva su historial —
   * notas firmadas, citas y facturas siguen apuntando a un usuario real.
   */
  activo: boolean('activo').notNull().default(true),
  /** Titular que dio de alta esta cuenta (null para el dueño original). */
  creadoPor: uuid('creado_por'),
  /** Solo asistentes: médico al que asiste. */
  medicoTitularId: uuid('medico_titular_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const patients = pgTable('patients', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  /** Declaración explícita; distinta de "lista vacía" (ver 0013). */
  sinAlergiasConocidas: boolean('sin_alergias_conocidas').notNull().default(false),
  /** Alergia[] — ver shared-types. */
  alergias: jsonb('alergias').notNull().default([]),
  /** AntecedentesPaciente — banderas clínicas + texto libre. */
  antecedentes: jsonb('antecedentes').notNull().default({ banderas: [] }),
  nombre: text('nombre').notNull(),
  fechaNacimiento: date('fecha_nacimiento').notNull(),
  /**
   * SexoPaciente (ver 0026). NULL = no capturado, distinto de
   * 'no_especificado'; solo el primero bloquea emitir una receta.
   */
  sexo: text('sexo'),
  curp: text('curp'),
  telefono: text('telefono'),
  /**
   * Baja lógica (ver 0029). NULL = activo. No se borra el expediente: la
   * NOM-004 obliga a conservarlo cinco años desde el último acto médico.
   */
  archivadoEn: timestamp('archivado_en', { withTimezone: true }),
  archivadoPor: uuid('archivado_por'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const appointments = pgTable('appointments', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  doctorId: uuid('doctor_id').notNull(),
  motivo: text('motivo'),
  inicioProgramado: timestamp('inicio_programado', { withTimezone: true }).notNull(),
  finProgramado: timestamp('fin_programado', { withTimezone: true }).notNull(),
  estatus: text('estatus').notNull().default('agendada'),
  checkinAt: timestamp('checkin_at', { withTimezone: true }),
  inicioReal: timestamp('inicio_real', { withTimezone: true }),
  finReal: timestamp('fin_real', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id'),
  entidad: text('entidad').notNull(),
  entidadId: uuid('entidad_id'),
  accion: text('accion').notNull(),
  detalle: jsonb('detalle'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const clinicalRecords = pgTable('clinical_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  patientId: uuid('patient_id').notNull(),
  abiertoEn: timestamp('abierto_en', { withTimezone: true }).defaultNow().notNull(),
});

export const clinicalNotes = pgTable('clinical_notes', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  clinicalRecordId: uuid('clinical_record_id').notNull(),
  appointmentId: uuid('appointment_id').notNull(),
  doctorId: uuid('doctor_id').notNull(),
  tipoNota: text('tipo_nota').notNull().default('nota_evolucion'),
  contenidoNom004: jsonb('contenido_nom004').notNull().default({}),
  estatus: text('estatus').notNull().default('borrador'), // 'borrador' | 'cerrada'
  cerradoEn: timestamp('cerrado_en', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const noteAmendments = pgTable('note_amendments', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  clinicalNoteId: uuid('clinical_note_id').notNull(),
  doctorId: uuid('doctor_id').notNull(),
  textoCorreccion: text('texto_correccion').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const emisoresFiscales = pgTable('emisores_fiscales', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  rfc: text('rfc').notNull(),
  razonSocial: text('razon_social').notNull(),
  regimenFiscal: text('regimen_fiscal').notNull(),
  codigoPostal: text('codigo_postal').notNull(),
  facturapiOrgId: text('facturapi_org_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const receptoresFiscales = pgTable('receptores_fiscales', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  patientId: uuid('patient_id'),
  rfc: text('rfc').notNull(),
  razonSocial: text('razon_social').notNull(),
  regimenFiscal: text('regimen_fiscal').notNull(),
  codigoPostal: text('codigo_postal').notNull(),
  usoCfdi: text('uso_cfdi').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const facturas = pgTable('facturas', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  appointmentId: uuid('appointment_id').notNull(),
  emisorId: uuid('emisor_id').notNull(),
  receptorId: uuid('receptor_id').notNull(),
  estatus: text('estatus').notNull().default('PENDIENTE'), // 'PENDIENTE' | 'TIMBRADA' | 'CANCELADA' | 'ERROR'
  uuidFiscal: text('uuid_fiscal'),
  subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull(),
  iva: numeric('iva', { precision: 12, scale: 2 }).notNull(),
  total: numeric('total', { precision: 12, scale: 2 }).notNull(),
  pacRawId: text('pac_raw_id'),
  errorCode: text('error_code'),
  motivoCancelacion: text('motivo_cancelacion'),
  timbradaEn: timestamp('timbrada_en', { withTimezone: true }),
  canceladaEn: timestamp('cancelada_en', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const conceptosFactura = pgTable('conceptos_factura', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  facturaId: uuid('factura_id').notNull(),
  claveProdServ: text('clave_prod_serv').notNull(),
  claveUnidad: text('clave_unidad').notNull(),
  descripcion: text('descripcion').notNull(),
  cantidad: numeric('cantidad', { precision: 12, scale: 2 }).notNull(),
  valorUnitario: numeric('valor_unitario', { precision: 12, scale: 2 }).notNull(),
  importe: numeric('importe', { precision: 12, scale: 2 }).notNull(),
  tratamientoIva: text('tratamiento_iva').notNull().default('EXENTO'), // 'EXENTO' | 'TASA_16' | 'TASA_0'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  appointmentId: uuid('appointment_id'),
  tipo: text('tipo').notNull(), // 'cita_proxima' | 'cita_cancelada' | 'checkin' | 'factura_error'
  titulo: text('titulo').notNull(),
  mensaje: text('mensaje').notNull(),
  leidaAt: timestamp('leida_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Catálogo CIE-10 (fuente: DGIS/Secretaría de Salud). Sin tenant_id: es
 * referencia global compartida, no dato propiedad de una clínica. */
export const cie10Diagnosticos = pgTable('cie10_diagnosticos', {
  code: text('code').primaryKey(),
  descripcion: text('descripcion').notNull(),
  capitulo: text('capitulo').notNull(),
});

/**
 * Presupuestos (ver 0014_presupuestos.sql). Cuelgan del PACIENTE, no de la
 * cita. Sin columnas de total ni saldo: se derivan de partidas y abonos.
 */
export const presupuestos = pgTable('presupuestos', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: tenantIdConDefault(),
  patientId: uuid('patient_id').notNull(),
  doctorId: uuid('doctor_id').notNull(),
  titulo: text('titulo').notNull(),
  estatus: text('estatus').notNull().default('borrador'),
  notas: text('notas'),
  vigenciaHasta: date('vigencia_hasta'),
  aceptadoEn: timestamp('aceptado_en', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const presupuestoPartidas = pgTable('presupuesto_partidas', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: tenantIdConDefault(),
  presupuestoId: uuid('presupuesto_id').notNull(),
  descripcion: text('descripcion').notNull(),
  /** Notación FDI; conecta la partida con el odontograma. */
  piezas: text('piezas').array().notNull(),
  fase: integer('fase').notNull().default(1),
  cantidad: numeric('cantidad').notNull(),
  /** Centavos enteros, igual que el dominio de facturación. */
  valorUnitarioCentavos: bigint('valor_unitario_centavos', { mode: 'number' }).notNull(),
  estatus: text('estatus').notNull().default('pendiente'),
  appointmentId: uuid('appointment_id'),
  orden: integer('orden').notNull().default(0),
});

export const presupuestoAbonos = pgTable('presupuesto_abonos', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: tenantIdConDefault(),
  presupuestoId: uuid('presupuesto_id').notNull(),
  montoCentavos: bigint('monto_centavos', { mode: 'number' }).notNull(),
  metodo: text('metodo').notNull(),
  fecha: date('fecha').notNull(),
  referencia: text('referencia'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Turnos de caja (ver 0022_caja.sql). Un solo turno abierto a la vez por
 * clínica, garantizado por un índice único parcial en la migración. Sin
 * columnas de totales: se derivan de los movimientos.
 */
export const cajaTurnos = pgTable('caja_turnos', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: tenantIdConDefault(),
  abiertaPor: uuid('abierta_por').notNull(),
  fondoInicialCentavos: bigint('fondo_inicial_centavos', { mode: 'number' }).notNull(),
  abiertaEn: timestamp('abierta_en', { withTimezone: true }).defaultNow().notNull(),
  notasApertura: text('notas_apertura'),
  cerradaPor: uuid('cerrada_por'),
  cerradaEn: timestamp('cerrada_en', { withTimezone: true }),
  efectivoContadoCentavos: bigint('efectivo_contado_centavos', { mode: 'number' }),
  notasCierre: text('notas_cierre'),
});

/** Entradas y salidas de dinero del turno. Nunca se borran: se cancelan. */
export const cajaMovimientos = pgTable('caja_movimientos', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: tenantIdConDefault(),
  turnoId: uuid('turno_id').notNull(),
  tipo: text('tipo').notNull(),
  concepto: text('concepto').notNull(),
  montoCentavos: bigint('monto_centavos', { mode: 'number' }).notNull(),
  metodo: text('metodo').notNull(),
  patientId: uuid('patient_id'),
  appointmentId: uuid('appointment_id'),
  presupuestoId: uuid('presupuesto_id'),
  /** Abono generado en el presupuesto por este cobro; amarra caja con cobranza. */
  abonoId: uuid('abono_id'),
  referencia: text('referencia'),
  registradoPor: uuid('registrado_por').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  canceladoEn: timestamp('cancelado_en', { withTimezone: true }),
  canceladoPor: uuid('cancelado_por'),
  motivoCancelacion: text('motivo_cancelacion'),
});

/**
 * Consentimiento informado (ver 0015_consentimientos.sql). Insert-only: sin
 * estatus ni columnas de edición, porque no las hay — el GRANT de la
 * migración ni siquiera permite UPDATE/DELETE al rol de la app.
 */
export const consentimientos = pgTable('consentimientos', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: tenantIdConDefault(),
  patientId: uuid('patient_id').notNull(),
  presupuestoId: uuid('presupuesto_id'),
  doctorId: uuid('doctor_id').notNull(),
  procedimiento: text('procedimiento').notNull(),
  contenido: text('contenido').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Metadata de imágenes clínicas (ver 0016_radiografias.sql). El archivo vive en storage S3-compatible, no aquí. */
export const radiografias = pgTable('radiografias', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: tenantIdConDefault(),
  patientId: uuid('patient_id').notNull(),
  appointmentId: uuid('appointment_id'),
  storageKey: text('storage_key').notNull(),
  mimeType: text('mime_type').notNull(),
  subidoPor: uuid('subido_por').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Orden de plantillas ortopédicas al laboratorio (ver 0023_orden_plantillas.sql).
 * Vive FUERA de `clinical_notes` a propósito: la nota firmada es inmutable por
 * NOM-004, y esta orden no lo es — el laboratorio puede pedir una corrección
 * días después de cerrada la consulta.
 */
export const ordenesPlantillas = pgTable('ordenes_plantillas', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: tenantIdConDefault(),
  patientId: uuid('patient_id').notNull(),
  doctorId: uuid('doctor_id').notNull(),
  appointmentId: uuid('appointment_id'),
  estatus: text('estatus').notNull().default('borrador'), // 'borrador' | 'completada' | 'cancelada'
  contenido: jsonb('contenido').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Contadores de login fallido para el bloqueo progresivo (ver
 * 0011_login_security.sql). Sin tenant_id ni RLS: se consulta ANTES de saber
 * quién es el usuario. Clave compuesta (scope, key).
 */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    scope: text('scope').notNull(), // 'email' | 'ip'
    key: text('key').notNull(),
    attempts: integer('attempts').notNull().default(0),
    firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.scope, t.key] }) }),
);

/** Idempotencia de webhooks de Stripe. Sin tenant_id: registro global. */
export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  /** NULL = se reclamó el evento pero el handler no terminó (ver 0020). */
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

/** Token de un solo uso para el auto-login tras pagar (ver 0009_subscriptions.sql). */
export const onboardingTickets = pgTable('onboarding_tickets', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  stripeCheckoutSessionId: text('stripe_checkout_session_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Token de un solo uso para "olvidé mi contraseña" (ver 0017_password_reset.sql). */
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Catálogo global de medicamentos (0027). Sin tenant_id ni RLS, igual que
 * `cie10Diagnosticos`: un principio activo no tiene dueño.
 */
export const medicamentos = pgTable('medicamentos', {
  clave: text('clave').primaryKey(),
  claveCnis: text('clave_cnis'),
  denominacionGenerica: text('denominacion_generica').notNull(),
  formaFarmaceutica: text('forma_farmaceutica').notNull(),
  presentacion: text('presentacion').notNull(),
  viaSugerida: text('via_sugerida').notNull(),
  grupoTerapeutico: text('grupo_terapeutico').notNull(),
  /** Fracción del art. 226 LGS. I y II no son emisibles desde HealthFlow. */
  fraccion: integer('fraccion').notNull(),
});

/**
 * Receta médica emitida (0028). Insert-only en la base: sin UPDATE ni DELETE
 * concedidos al rol de la app.
 */
export const recetas = pgTable('recetas', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: tenantIdConDefault(),
  patientId: uuid('patient_id').notNull(),
  doctorId: uuid('doctor_id').notNull(),
  appointmentId: uuid('appointment_id'),
  /** Consecutivo por clínica, legible: 'RX-2026-000123'. */
  folio: text('folio').notNull(),
  folioAnio: integer('folio_anio').notNull(),
  folioNumero: integer('folio_numero').notNull(),
  /** RecetaContent — snapshot del emisor, el paciente y la prescripción. */
  contenido: jsonb('contenido').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Cancelación de una receta. Tabla aparte para no conceder UPDATE sobre `recetas`. */
export const recetasCancelaciones = pgTable('recetas_cancelaciones', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: tenantIdConDefault(),
  recetaId: uuid('receta_id').notNull(),
  canceladoPor: uuid('cancelado_por').notNull(),
  motivo: text('motivo').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Contador de folios por clínica, serie y año (0028). Se incrementa con un
 * upsert atómico; es la única tabla del sistema que necesita UPDATE para
 * funcionar y no para corregir.
 */
export const folioContadores = pgTable(
  'folio_contadores',
  {
    tenantId: tenantIdConDefault(),
    serie: text('serie').notNull(),
    anio: integer('anio').notNull(),
    ultimo: integer('ultimo').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.serie, t.anio] }) }),
);

export const schema = {
  tenants,
  users,
  patients,
  appointments,
  auditLog,
  clinicalRecords,
  clinicalNotes,
  noteAmendments,
  emisoresFiscales,
  receptoresFiscales,
  facturas,
  conceptosFactura,
  notifications,
  cie10Diagnosticos,
  stripeEvents,
  onboardingTickets,
  passwordResetTokens,
  loginAttempts,
  presupuestos,
  presupuestoPartidas,
  presupuestoAbonos,
  cajaTurnos,
  cajaMovimientos,
  consentimientos,
  radiografias,
  medicamentos,
  recetas,
  recetasCancelaciones,
  folioContadores,
};
export type DbSchema = typeof schema;
