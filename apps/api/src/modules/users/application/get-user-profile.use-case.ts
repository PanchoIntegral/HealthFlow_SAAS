import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { UserProfileMe } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { EstadoSuscripcionReader } from '../../../common/subscription/estado-suscripcion.reader';
import { avisoSuscripcion } from '../../../common/subscription/debe-restringir';
import { AsistenteIaActivoReader } from '../../ai-scribe/application/asistente-ia-activo.reader';
import { ClinicaDentalReader } from '../../presupuestos/application/clinica-dental.reader';
import { USER_PROFILE_REPOSITORY, type UserProfileRepository } from '../domain/user-profile.repository';

@Injectable()
export class GetUserProfileUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly asistenteIa: AsistenteIaActivoReader,
    private readonly clinicaDental: ClinicaDentalReader,
    private readonly suscripcion: EstadoSuscripcionReader,
    @Inject(USER_PROFILE_REPOSITORY) private readonly users: UserProfileRepository,
  ) {}

  async execute(userId: string): Promise<UserProfileMe> {
    const estado = await this.suscripcion.leer();
    const aviso = avisoSuscripcion(estado, new Date());

    return this.tenantDb.run(async (tx) => {
      const profile = await this.users.getById(tx, userId);
      if (!profile) throw new NotFoundException('Usuario no encontrado');

      // El flag del asistente vive en el tenant, no en el usuario, pero viaja
      // con el perfil: la pantalla de consulta ya lee este endpoint al montar,
      // así que el botón de grabar aparece sin una petición extra.
      return {
        ...profile,
        asistenteIaActivo: await this.asistenteIa.leer(tx),
        // Igual que el flag del asistente: es del tenant y viaja con el perfil
        // porque el AppShell decide con él qué secciones dibuja al montar.
        clinicaDental: await this.clinicaDental.leer(tx),
        // El estado de pago viaja aquí por el mismo motivo, y por uno más: es
        // la ÚNICA lectura que lo expone. Sin esto el frontend solo se entera
        // de que hay un problema cuando la API rechaza una escritura con 402,
        // o sea con la gracia ya agotada y el daño hecho.
        suscripcion: {
          aviso,
          // Solo tiene sentido mostrar la fecha límite mientras sirve de plazo.
          // Ya suspendida es ruido: lo que importa es que hay que pagar.
          graceUntil: aviso === 'advertencia' ? (estado.graceUntil?.toISOString() ?? null) : null,
          currentPeriodEnd: estado.currentPeriodEnd?.toISOString() ?? null,
        },
      };
    });
  }
}
