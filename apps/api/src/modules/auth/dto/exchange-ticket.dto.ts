import { IsString, MinLength } from 'class-validator';

export class ExchangeTicketDto {
  @IsString()
  @MinLength(1)
  stripeSessionId!: string;
}
