import { Global, Module } from '@nestjs/common';
import { SecretosService } from './secretos.service';

/**
 * Global como el resto de la infraestructura transversal (DrizzleModule,
 * TenantContextModule): el cifrado de secretos no pertenece a ningún módulo
 * de negocio en particular.
 */
@Global()
@Module({
  providers: [SecretosService],
  exports: [SecretosService],
})
export class CryptoModule {}
