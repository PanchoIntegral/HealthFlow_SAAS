import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

/** Normaliza antes de validar: el paciente escribe con espacios y mayúsculas. */
const trimLower=()=>Transform(({value})=>typeof value==='string'?value.trim().toLowerCase():value);
const trim=()=>Transform(({value})=>typeof value==='string'?value.trim():value);

export class PublicPatientDto {
  @trim() @IsString() @MinLength(2) @MaxLength(160) nombre!:string;
  @trim() @Matches(/^\d{4}-\d{2}-\d{2}$/) fechaNacimiento!:string;
  @trim() @IsString() @MinLength(8) @MaxLength(24) telefono!:string;
  @trimLower() @IsOptional() @IsEmail() @MaxLength(254) email?:string;
  @IsIn(['whatsapp','email','ninguno']) canalPreferido!:'whatsapp'|'email'|'ninguno';
  @IsBoolean() whatsappOptIn!:boolean;
  @IsIn([true]) privacyNoticeAccepted!:true;
  @IsString() @MaxLength(40) privacyNoticeVersion!:string;
}

export class CreatePublicAppointmentDto {
  @IsUUID() serviceId!:string;
  @IsOptional() @IsUUID() doctorId?:string;
  @IsString() start!:string;
  @ValidateNested() @Type(()=>PublicPatientDto) patient!:PublicPatientDto;
}

export class ReschedulePublicAppointmentDto {
  @IsString() start!:string;
  @IsOptional() @IsUUID() doctorId?:string;
}

export class UpdateBookingSettingsDto {
  @IsString() @Matches(/^[a-z0-9][a-z0-9-]{2,62}$/) slug!:string;
  @IsBoolean() publicado!:boolean;
  @IsBoolean() directorioPublico!:boolean;
  @IsBoolean() featureActiva!:boolean;
  @IsString() @MaxLength(80) timezone!:string;
  @IsInt() @Min(0) @Max(720) anticipacionMinimaHoras!:number;
  @IsInt() @Min(1) @Max(365) horizonteDias!:number;
  @IsInt() @Min(0) @Max(720) limiteCancelacionHoras!:number;
  @IsArray() @ArrayMaxSize(6) @IsInt({each:true}) @Min(0,{each:true}) @Max(720,{each:true}) recordatoriosHoras!:number[];
  @IsString() @MaxLength(40) avisoPrivacidadVersion!:string;
}

export class PublicDirectoryQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?:string;
  @IsOptional() @IsString() @MaxLength(80) specialty?:string;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) page:number=1;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(24) pageSize:number=12;
}

export class UpsertBookingServiceDto {
  @IsString() @MinLength(2) @MaxLength(100) nombre!:string;
  @IsInt() @Min(10) @Max(480) duracionMinutos!:number;
  @IsOptional() @IsInt() @Min(0) precioCentavos?:number|null;
  @IsBoolean() publico!:boolean;
  @IsBoolean() activo!:boolean;
  @IsInt() orden!:number;
  @IsArray() @IsUUID('4',{each:true}) doctorIds!:string[];
}

export class AvailabilityRuleDto {
  @IsInt() @Min(0) @Max(6) weekday!:number;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) inicioLocal!:string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) finLocal!:string;
}

export class ReplaceAvailabilityDto {
  @IsArray() @ValidateNested({each:true}) @Type(()=>AvailabilityRuleDto) rules!:AvailabilityRuleDto[];
}

export class AvailabilityExceptionDto {
  @IsUUID() doctorId!:string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) fecha!:string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) inicioLocal?:string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) finLocal?:string;
  @IsBoolean() disponible!:boolean;
  @IsOptional() @IsString() @MaxLength(160) nota?:string;
}
