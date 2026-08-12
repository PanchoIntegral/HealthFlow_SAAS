import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { WHATSAPP_MODOS, type WhatsappModo } from '@healthflow/shared-types';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class HorarioAtencionDto {
  /** 1 = lunes … 7 = domingo. */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  dias!: number[];

  @Matches(HH_MM, { message: 'desde debe tener formato HH:MM' })
  desde!: string;

  @Matches(HH_MM, { message: 'hasta debe tener formato HH:MM' })
  hasta!: string;
}

/**
 * Todo opcional: la pantalla guarda cambios parciales. `undefined` significa
 * "no lo toques" — importa sobre todo para `accessToken`, donde confundirlo con
 * "bórralo" dejaría a una clínica sin credenciales por guardar otra cosa.
 *
 * Las reglas de negocio (modo propio exige credenciales, activar exige nombre,
 * el horario debe terminar después de empezar) NO están aquí: viven en la
 * entidad, que es también quien las aplica cuando el cambio viene del
 * scheduler y no de este DTO.
 */
export class SaveWhatsappConfigDto {
  @IsOptional()
  @IsIn(WHATSAPP_MODOS)
  modo?: WhatsappModo;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  wabaId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  phoneNumberId?: string | null;

  /**
   * En claro y una sola vez: el backend lo cifra antes de guardarlo y no lo
   * devuelve jamás. Los tokens de larga duración de Meta rondan los 200-250
   * caracteres; el tope deja margen sin admitir un payload arbitrario.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  accessToken?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombreRemitente?: string | null;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  horasAnticipacion?: number;

  @IsOptional()
  @IsBoolean()
  enviarConfirmacion?: boolean;

  /** Zona IANA. Que exista de verdad lo comprueba la entidad con Intl. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  zonaHoraria?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  silencioDesde?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  silencioHasta?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => HorarioAtencionDto)
  horarioAtencion?: HorarioAtencionDto;
}
