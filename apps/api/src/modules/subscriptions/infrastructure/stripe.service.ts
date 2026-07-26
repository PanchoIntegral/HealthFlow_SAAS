import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { env } from '../../../config/env';

/** Wrapper delgado: un solo lugar que construye el cliente de Stripe. */
@Injectable()
export class StripeService {
  readonly client = new Stripe(env.stripeSecretKey);
}
