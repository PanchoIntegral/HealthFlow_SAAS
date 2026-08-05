import { IsBoolean } from 'class-validator';

/** Alta/baja de una cuenta existente. El resto del perfil lo edita su dueño. */
export class ActualizarCuentaDto {
  @IsBoolean()
  activo!: boolean;
}
