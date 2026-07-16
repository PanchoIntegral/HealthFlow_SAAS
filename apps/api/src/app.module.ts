import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DrizzleModule } from './db/drizzle.module';
import { TenantContextModule } from './common/tenant-context/tenant-context.module';
import { RequestContextInterceptor } from './common/tenant-context/request-context.interceptor';
import { DomainExceptionFilter } from './common/errors/domain-exception.filter';
import { AuditModule } from './common/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { PatientsModule } from './modules/patients/patients.module';
import { ClinicalRecordsModule } from './modules/clinical-records/clinical-records.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { BillingModule } from './modules/billing/billing.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    // Rate limiting: se aplica solo donde el controller monta ThrottlerGuard
    // (p.ej. el timbrado, que consume cuota/costo del PAC).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
    DrizzleModule,
    TenantContextModule,
    AuditModule,
    AuthModule,
    NotificationsModule,
    AppointmentsModule,
    PatientsModule,
    ClinicalRecordsModule,
    DashboardModule,
    ReportsModule,
    BillingModule,
  ],
  providers: [
    // Global: tras autenticar, corre cada request dentro del AsyncLocalStorage
    // con el tenant activo (para RLS) y el usuario (para auditoría).
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule {}
