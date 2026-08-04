import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { UpdateEspecialidadRequest, UserProfile } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import { USER_PROFILE_REPOSITORY, type UserProfileRepository } from '../domain/user-profile.repository';

/**
 * Cambia la especialidad del propio usuario autenticado. Es seguro de hacer
 * en caliente: GetConsultationNoteUseCase relee `users.especialidad_key` cada
 * vez que la nota sigue en borrador (ver get-consultation-note.use-case.ts),
 * así que este cambio se refleja de inmediato en cualquier consulta abierta.
 * Una nota ya CERRADA nunca se reinterpreta — queda congelada con la
 * especialidad que tenía al firmarse (NOM-004).
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
