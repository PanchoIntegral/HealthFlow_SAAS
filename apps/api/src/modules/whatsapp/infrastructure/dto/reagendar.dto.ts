import { IsISO8601 } from 'class-validator';

export class ReagendarDto {
  /**
   * Inicio elegido, tomado de la lista de huecos. Se revalida contra la agenda
   * del médico en el caso de uso: la lista pudo quedar obsoleta mientras el
   * paciente decidía, y nada impide mandar aquí un instante que nunca se
   * ofreció.
   */
  @IsISO8601()
  inicio!: string;
}
