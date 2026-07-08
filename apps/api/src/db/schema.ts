import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  jsonb,
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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  nombre: text('nombre').notNull(),
  rol: text('rol').notNull(), // 'medico' | 'asistente' | 'admin'
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

export const schema = { tenants, users, patients, appointments, auditLog };
export type DbSchema = typeof schema;
