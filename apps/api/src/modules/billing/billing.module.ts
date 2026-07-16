import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { CaslAbilityFactory } from '../auth/casl/ability.factory';
import { PoliciesGuard } from '../auth/casl/policies.guard';
import { FACTURA_REPOSITORY } from './domain/factura.repository';
import { FACTURACION_PAC } from './domain/facturacion-pac.port';
import { TimbrarFacturaUseCase } from './application/timbrar-factura.use-case';
import { CancelarFacturaUseCase } from './application/cancelar-factura.use-case';
import { ConsultarFacturaUseCase } from './application/consultar-factura.use-case';
import { ConsultarFacturaDeCitaUseCase } from './application/consultar-factura-de-cita.use-case';
import { DrizzleFacturaRepository } from './infrastructure/factura.drizzle-repo';
import { FacturapiAdapter } from './infrastructure/pac/facturapi.adapter';
import { FakePacAdapter } from './infrastructure/pac/fake-pac.adapter';
import { BillingController } from './infrastructure/billing.controller';

/**
 * Módulo de facturación CFDI 4.0. Importa AppointmentsModule para verificar
 * que la cita facturada pertenece al tenant (APPOINTMENT_REPOSITORY).
 *
 * El PAC se selecciona por entorno vía useClass — NUNCA con un `if` dentro del
 * adaptador real que "simule": eso es fácil de dejar prendido en producción.
 * Dev local sin timbrar: PAC_PROVIDER=fake (ya incluido en .env.example).
 */
const usarPacFake = process.env.NODE_ENV === 'test' || process.env.PAC_PROVIDER === 'fake';

@Module({
  imports: [AuthModule, AppointmentsModule],
  controllers: [BillingController],
  providers: [
    TimbrarFacturaUseCase,
    CancelarFacturaUseCase,
    ConsultarFacturaUseCase,
    ConsultarFacturaDeCitaUseCase,
    CaslAbilityFactory,
    PoliciesGuard,
    { provide: FACTURA_REPOSITORY, useClass: DrizzleFacturaRepository },
    { provide: FACTURACION_PAC, useClass: usarPacFake ? FakePacAdapter : FacturapiAdapter },
  ],
})
export class BillingModule {}
