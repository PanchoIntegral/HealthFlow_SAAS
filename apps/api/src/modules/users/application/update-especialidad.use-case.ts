import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { UpdateEspecialidadRequest, UserProfile } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import { USER_PROFILE_REPOSITORY, type UserProfileRepository } from '../domain/user-profile.repository';

/**
 * Cambia la especialidad del propio usuario autenticado. Es seguro de hacer
 * en caliente: la nota clínica resuelve el perfil (PERFILES en shared-types)
 * leyendo `users.especialidad_key` en cada consulta, no lo congela al crearla
 * — así que esto solo afecta notas futuras, nunca reinterpreta una ya cerrada.
 */
@Injectable()
export class UpdateEspecialidadUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    @Inject(USER_PROFILE_REPOSITORY) private readonly users: UserProfileRepository,
  ) {}

  async execute(userId: string, input: UpdateEspecialidadRequest): Promise<UserProfile> {
    return this.tenantDb.run(async (tx) => {
      const anterior = await this.users.getById(tx, userId);
      if (!anterior) throw new NotFoundException('Usuario no encontrado');

      const actualizado = await this.users.updateEspecialidad(tx, userId, {
        especialidadKey: input.especialidadKey,
        especialidad: input.especialidad?.trim() || null,
      });
      if (!actualizado) throw new NotFoundException('Usuario no encontrado');

      await this.audit.record(tx, {
        entidad: 'user',
        entidadId: userId,
        accion: 'update_especialidad',
        detalle: {
          especialidadKeyAnterior: anterior.especialidadKey,
          especialidadKeyNueva: actualizado.especialidadKey,
        },
      });

      return actualizado;
    });
  }
}
