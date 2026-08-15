import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  NOTAS_PAGE_SIZE,
  NOTAS_PAGE_SIZE_MAX,
  type ClinicalRecordView,
} from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  CLINICAL_RECORD_REPOSITORY,
  type ClinicalRecordRepository,
} from '../domain/clinical-record.repository';

/**
 * Expediente de un paciente con una página de su historial (de la nota más
 * reciente hacia atrás). Sin cursor devuelve la primera página.
 *
 * El endpoint lo puede llamar cualquier rol (ver el `RequirePolicy('read',
 * 'Patient')` del controller): el asistente tiene acceso COMPLETO al
 * expediente, contenido clínico de cada nota incluido — decisión explícita
 * del titular de la cuenta, distinta de otras secciones (Cuenta, Finanzas)
 * que siguen siendo exclusivas de médico/admin. Si en el futuro se vuelve a
 * pedir acotar esto, la redacción va AQUÍ (derivada de `ctx.get().rol`, como
 * ya hace `perfilDe` con la especialidad) y no en el guard del controller.
 */
@Injectable()
export class GetClinicalRecordUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(CLINICAL_RECORD_REPOSITORY) private readonly records: ClinicalRecordRepository,
  ) {}

  async execute(
    patientId: string,
    page: { limit?: number; cursor?: string } = {},
  ): Promise<ClinicalRecordView> {
    // El tope se aplica aquí y no solo en el DTO: cualquier otro llamador del
    // caso de uso queda igual de acotado sin tener que acordarse.
    const limit = Math.min(page.limit ?? NOTAS_PAGE_SIZE, NOTAS_PAGE_SIZE_MAX);
    const view = await this.tenantDb.run((tx) =>
      this.records.getRecordView(tx, patientId, { limit, cursor: page.cursor ?? null }),
    );
    if (!view) throw new NotFoundException('El paciente aún no tiene expediente');
    return view;
  }
}
