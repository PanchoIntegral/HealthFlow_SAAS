import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { GlobalThrottlerGuard } from './common/security/global-throttler.guard';
import { DrizzleModule } from './db/drizzle.module';
import { TenantContextModule } from './common/tenant-context/tenant-context.module';
import { RequestContextInterceptor } from './common/tenant-context/request-context.interceptor';
import { SubscriptionModule } from './common/subscription/subscription.module';
import { SuscripcionInterceptor } from './common/subscription/suscripcion.interceptor';
import { DomainExceptionFilter } from './common/errors/domain-exception.filter';
import { AuditModule } from './common/audit/audit.module';
import { CapacidadModule } from './common/capacidad/capacidad.module';
import { CapacidadInterceptor } from './common/capacidad/capacidad.interceptor';
import { AppEventsModule } from './common/events/app-events.module';
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
import { CajaModule } from './modules/caja/caja.module';
import { UsersModule } from './modules/users/users.module';
import { ConsentimientosModule } from './modules/consentimientos/consentimientos.module';
import { RecetasModule } from './modules/recetas/recetas.module';
import { RadiografiasModule } from './modules/radiografias/radiografias.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AiScribeModule } from './modules/ai-scribe/ai-scribe.module';
import { PlantillasModule } from './modules/plantillas/plantillas.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { PublicBookingModule } from './modules/public-booking/public-booking.module';
import { ModulosModule } from './modules/modulos/modulos.module';
import { RecallsModule } from './modules/recalls/recalls.module';

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
    SubscriptionModule,
    AuditModule,
    CapacidadModule,
    AppEventsModule,
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
    CajaModule,
    UsersModule,
    ConsentimientosModule,
    RecetasModule,
    RadiografiasModule,
    AccountsModule,
    AiScribeModule,
    PlantillasModule,
    MessagingModule,
    PublicBookingModule,
    ModulosModule,
    RecallsModule,
  ],
  providers: [
    // Global: primera línea de defensa, antes de tocar la base de datos.
    { provide: APP_GUARD, useClass: GlobalThrottlerGuard },
    // Global: tras autenticar, corre cada request dentro del AsyncLocalStorage
    // con el tenant activo (para RLS) y el usuario (para auditoría).
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    /**
     * Global: deja la cuenta en solo lectura si la suscripción está vencida.
     *
     * EL ORDEN IMPORTA y es parte del diseño: los interceptores globales se
     * anidan en orden de registro, así que este corre DENTRO del
     * AsyncLocalStorage que abre RequestContextInterceptor — que es lo que le
     * permite consultar el estado de pago con el tenant ya fijado para RLS.
     * Invertirlos rompe el gating con "No hay contexto de petición".
     */
    { provide: APP_INTERCEPTOR, useClass: SuscripcionInterceptor },
    /**
     * Global: 404 en los módulos que la clínica no tiene contratados,
     * liberados o activados (@RequiereModulo). Va DESPUÉS de los dos
     * anteriores por la misma razón de anidamiento: necesita el
     * AsyncLocalStorage con el tenant fijado para resolver la capacidad. Y va
     * al final porque una suscripción vencida es una respuesta más útil que
     * un "este módulo no existe" — por eso este interceptor deja pasar
     * explícitamente la razón 'suscripcion'.
     */
    { provide: APP_INTERCEPTOR, useClass: CapacidadInterceptor },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule {}
