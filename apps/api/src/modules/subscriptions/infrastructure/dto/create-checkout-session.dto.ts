import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { SELF_SERVE_PLANS, type SelfServePlan } from '@healthflow/shared-types';

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
}
