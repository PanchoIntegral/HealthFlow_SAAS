import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  BILLING_PERIODS,
  ESPECIALIDADES,
  SELF_SERVE_PLANS,
  type BillingPeriod,
  type EspecialidadKey,
  type SelfServePlan,
} from '@healthflow/shared-types';

export class CreateCheckoutSessionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  nombreClinica!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  ownerNombre!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsIn(SELF_SERVE_PLANS)
  plan!: SelfServePlan;

  @IsIn(BILLING_PERIODS)
  periodo!: BillingPeriod;

  /** Opcional para no romper a clientes que aún no la mandan ⇒ 'general'. */
  @IsOptional()
  @IsIn(ESPECIALIDADES)
  especialidad?: EspecialidadKey;
}
