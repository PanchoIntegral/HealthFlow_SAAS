import { Module } from '@nestjs/common';
import { CaslAbilityFactory } from './ability.factory';

/**
 * Solo las reglas de permisos, sin nada más.
 *
 * Existe para romper un ciclo: `AuthModule` importa `SubscriptionsModule`
 * (canje del ticket post-pago), así que `SubscriptionsModule` no puede
 * importar `AuthModule` de vuelta para conseguir el CaslAbilityFactory que
 * necesita `PoliciesGuard`. Un módulo aparte con la fábrica corta el nudo sin
 * `forwardRef`, que además esconde el ciclo en vez de eliminarlo.
 *
 * `AuthModule` lo importa y lo reexporta, de modo que todo el que ya importaba
 * `AuthModule` para usar `@RequirePolicy` sigue funcionando igual.
 */
@Module({
  providers: [CaslAbilityFactory],
  exports: [CaslAbilityFactory],
})
export class CaslModule {}
