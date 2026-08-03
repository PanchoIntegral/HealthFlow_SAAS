import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import type {
  BillingPeriod,
  CreateCheckoutSessionResponse,
  SelfServePlan,
} from '@healthflow/shared-types';
import { DB } from '../../../db/drizzle.module';
import type { Database } from '../../../db/drizzle';
import { env } from '../../../config/env';
import { StripeService } from '../infrastructure/stripe.service';
import type { CreateCheckoutSessionDto } from '../infrastructure/dto/create-checkout-session.dto';

function priceIdForPlan(plan: SelfServePlan, periodo: BillingPeriod): string {
  if (periodo === 'anual') {
    return plan === 'individual'
      ? env.stripePriceIdIndividualAnual
      : env.stripePriceIdConsultorioAnual;
  }
  return plan === 'individual' ? env.stripePriceIdIndividual : env.stripePriceIdConsultorio;
}

@Injectable()
export class CreateCheckoutSessionUseCase {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly stripe: StripeService,
  ) {}

  async execute(dto: CreateCheckoutSessionDto): Promise<CreateCheckoutSessionResponse> {
    // Lectura cross-tenant vía la misma función SECURITY DEFINER que usa login
    // (0002_auth_login.sql) — evita crear una sesión de Stripe para un correo
    // que ya tiene cuenta.
    const existing = await this.db.execute(
      sql`SELECT id FROM auth_find_user_by_email(${dto.email})`,
    );
    if (existing.rows.length > 0) {
      throw new ConflictException('Ese correo ya tiene una cuenta');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const session = await this.stripe.client.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceIdForPlan(dto.plan, dto.periodo), quantity: 1 }],
      subscription_data: { trial_period_days: 14 },
      customer_email: dto.email,
      // El password viaja hasheado — nunca en texto plano fuera del browser.
      metadata: {
        nombreClinica: dto.nombreClinica,
        ownerNombre: dto.ownerNombre,
        ownerEmail: dto.email,
        passwordHash,
        plan: dto.plan,
        periodo: dto.periodo,
        especialidad: dto.especialidad ?? 'general',
      },
      success_url: `${env.appUrl}/bienvenida?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.marketingUrl}/#precios`,
    });

    if (!session.url) {
      throw new Error('Stripe no devolvió una URL de checkout');
    }
    return { url: session.url };
  }
}
