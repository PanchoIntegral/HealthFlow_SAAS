import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { UserProfile } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { USER_PROFILE_REPOSITORY, type UserProfileRepository } from '../domain/user-profile.repository';

@Injectable()
export class GetUserProfileUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(USER_PROFILE_REPOSITORY) private readonly users: UserProfileRepository,
  ) {}

  async execute(userId: string): Promise<UserProfile> {
    return this.tenantDb.run(async (tx) => {
      const profile = await this.users.getById(tx, userId);
      if (!profile) throw new NotFoundException('Usuario no encontrado');
      return profile;
    });
  }
}
