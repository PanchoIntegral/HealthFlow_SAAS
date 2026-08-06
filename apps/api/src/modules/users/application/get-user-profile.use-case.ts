import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { UserProfile } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AsistenteIaActivoReader } from '../../ai-scribe/application/asistente-ia-activo.reader';
import { USER_PROFILE_REPOSITORY, type UserProfileRepository } from '../domain/user-profile.repository';

@Injectable()
export class GetUserProfileUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly asistenteIa: AsistenteIaActivoReader,
    @Inject(USER_PROFILE_REPOSITORY) private readonly users: UserProfileRepository,
  ) {}

  async execute(userId: string): Promise<UserProfile> {
    return this.tenantDb.run(async (tx) => {
      const profile = await this.users.getById(tx, userId);
      if (!profile) throw new NotFoundException('Usuario no encontrado');

      // El flag del asistente vive en el tenant, no en el usuario, pero viaja
      // con el perfil: la pantalla de consulta ya lee este endpoint al montar,
      // así que el botón de grabar aparece sin una petición extra.
      return { ...profile, asistenteIaActivo: await this.asistenteIa.leer(tx) };
    });
  }
}
