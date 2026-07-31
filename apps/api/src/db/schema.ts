import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  jsonb,
  numeric,
  boolean,
} from 'drizzle-orm/pg-core';

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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
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
  especialidad: text('especialidad'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const patients = pgTable('patients', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  nombre: text('nombre').notNull(),
  fechaNacimiento: date('fecha_nacimiento').notNull(),
  curp: text('curp'),
  telefono: text('telefono'),
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

/** Idempotencia de webhooks de Stripe. Sin tenant_id: registro global. */
export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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
};
export type DbSchema = typeof schema;
