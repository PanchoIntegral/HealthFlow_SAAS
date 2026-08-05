import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  ESPECIALIDADES,
  ROLES_ASIGNABLES,
  type EspecialidadKey,
  type RolAsignable,
} from '@healthflow/shared-types';

export class CrearCuentaDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  nombre!: string;

  @IsEmail({}, { message: 'El correo no tiene forma de correo válido' })
  @MaxLength(254)
  email!: string;

  /**
   * Mínimo 8: es la contraseña de una cuenta que abre expedientes clínicos, y
   * la fija otra persona (el titular). El mismo mínimo que exige la pantalla
   * de "cambiar contraseña" — no tendría sentido crear cuentas por debajo del
   * listón que luego se le va a exigir al usuario.
   */
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  /** 'admin' NO es asignable: el titular es uno y lo crea el alta de la clínica. */
  @IsIn(ROLES_ASIGNABLES)
  rol!: RolAsignable;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  cedulaProfesional?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  especialidad?: string;

  @IsOptional()
  @IsIn(ESPECIALIDADES)
  especialidadKey?: EspecialidadKey;

  @IsOptional()
  @IsUUID()
  medicoTitularId?: string;
}
