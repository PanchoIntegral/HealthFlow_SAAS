import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { GlobalThrottlerGuard } from './common/security/global-throttler.guard';
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
import { CatalogosModule } from './modules/catalogos/catalogos.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { PresupuestosModule } from './modules/presupuestos/presupuestos.module';
import { UsersModule } from './modules/users/users.module';
import { ConsentimientosModule } from './modules/consentimientos/consentimientos.module';
import { RadiografiasModule } from './modules/radiografias/radiografias.module';
import { AccountsModule } from './modules/accounts/accounts.module';

@Module({
  imports: [
    /**
     * Rate limiting por IP, aplicado a TODA la API vía APP_GUARD (abajo).
     * Los dos niveles se evalúan a la vez y se necesita pasar ambos:
     *
     *  - 'burst' corta el pico instantáneo (un bot que dispara en paralelo);
     *  - el nivel sin nombre ('default') acota el volumen sostenido por minuto,
     *    y es el que los controllers afinan con @Throttle({ default: ... })
     *    cuando la operación es cara (timbrado del PAC, Checkout de Stripe).
     *
     * Los límites están holgados para un uso humano normal de la app (una
     * consulta abre varias peticiones a la vez) y muy por debajo de lo que
     * cuesta hacer daño.
     */
    ThrottlerModule.forRoot([
      { name: 'burst', ttl: 1_000, limit: 60 },
      { ttl: 60_000, limit: 600 },
    ]),
    DrizzleModule,
    TenantContextModule,
    AuditModule,
    AuthModule,
    NotificationsModule,
    CatalogosModule,
    AppointmentsModule,
    PatientsModule,
    ClinicalRecordsModule,
    DashboardModule,
    ReportsModule,
    BillingModule,
    SubscriptionsModule,
    PresupuestosModule,
    UsersModule,
    ConsentimientosModule,
    RadiografiasModule,
    AccountsModule,
  ],
  providers: [
    // Global: primera línea de defensa, antes de tocar la base de datos.
    { provide: APP_GUARD, useClass: GlobalThrottlerGuard },
    // Global: tras autenticar, corre cada request dentro del AsyncLocalStorage
    // con el tenant activo (para RLS) y el usuario (para auditoría).
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule {}
