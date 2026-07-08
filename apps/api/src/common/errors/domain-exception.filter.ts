import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { DomainError } from './domain.error';

/** Interfaz mínima de la respuesta HTTP — evita depender de los tipos de express. */
interface HttpResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Traduce cualquier error de DOMINIO a su respuesta HTTP, sin acoplar el
 * dominio a Nest/HTTP. Cada DomainError declara su `httpStatus` y `code`.
 */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(error: DomainError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<HttpResponse>();
    this.logger.warn(`${error.code}: ${error.message}`);
    res.status(error.httpStatus).json({
      statusCode: error.httpStatus,
      error: error.code,
      message: error.message,
      ...error.details(),
    });
  }
}
