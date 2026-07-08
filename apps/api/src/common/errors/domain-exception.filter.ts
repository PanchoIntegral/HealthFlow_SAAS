import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { InvalidAppointmentTransitionError } from '../../modules/appointments/domain/appointment.errors';

/** Interfaz mínima de la respuesta HTTP — evita depender de los tipos de express. */
interface HttpResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Traduce errores de DOMINIO a respuestas HTTP apropiadas, sin acoplar el
 * dominio a Nest/HTTP. Una transición de estado inválida es un conflicto de
 * negocio legítimo (409), no un error interno del servidor (500).
 */
@Catch(InvalidAppointmentTransitionError)
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(error: InvalidAppointmentTransitionError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<HttpResponse>();
    this.logger.warn(error.message);
    res.status(HttpStatus.CONFLICT).json({
      statusCode: HttpStatus.CONFLICT,
      error: 'InvalidAppointmentTransition',
      message: error.message,
      from: error.from,
      to: error.to,
    });
  }
}
