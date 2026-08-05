import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ChangePasswordRequest } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import { PasswordHasherService } from '../../auth/application/password-hasher.service';
import { USER_PROFILE_REPOSITORY, type UserProfileRepository } from '../domain/user-profile.repository';

/**
 * Cambia la contraseña del propio usuario autenticado, exigiendo la actual.
 * Reusa el mismo PasswordHasherService (y su semáforo anti-agotamiento de
 * CPU) que el login, en vez de llamar bcrypt directo.
 */
@Injectable()
export class ChangePasswordUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly hasher: PasswordHasherService,
    @Inject(USER_PROFILE_REPOSITORY) private readonly users: UserProfileRepository,
  ) {}

  async execute(userId: string, input: ChangePasswordRequest): Promise<{ ok: true }> {
    return this.tenantDb.run(async (tx) => {
      const hashActual = await this.users.getPasswordHash(tx, userId);
      if (!hashActual) throw new NotFoundException('Usuario no encontrado');

      const coincide = await this.hasher.compare(input.currentPassword, hashActual);
      if (!coincide) throw new UnauthorizedException('La contraseña actual no es correcta');

      const nuevoHash = await this.hasher.hash(input.newPassword);
      await this.users.updatePasswordHash(tx, userId, nuevoHash);

      // Sin contraseñas ni hashes en `detalle`: es un registro de auditoría,
      // no un lugar donde guardar credenciales.
      await this.audit.record(tx, {
        entidad: 'user',
        entidadId: userId,
        accion: 'change_password',
      });

      return { ok: true };
    });
  }
}
