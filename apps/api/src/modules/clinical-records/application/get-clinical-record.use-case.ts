import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  NOTAS_PAGE_SIZE,
  NOTAS_PAGE_SIZE_MAX,
  type ClinicalRecordView,
} from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import {
  CLINICAL_RECORD_REPOSITORY,
  type ClinicalRecordRepository,
} from '../domain/clinical-record.repository';

/**
 * Expediente de un paciente con una página de su historial (de la nota más
 * reciente hacia atrás). Sin cursor devuelve la primera página.
 *
 * El endpoint lo puede llamar cualquier rol (ver el `RequirePolicy('read',
 * 'Patient')` del controller — abrir la ficha es trabajo de recepción), pero
 * el CONTENIDO clínico de cada nota (diagnósticos, tratamiento, signos
 * vitales) sigue siendo exclusivo de médico/admin. La barrera real vive AQUÍ
 * y no en el guard: al asistente se le sirve el mismo expediente —mismas
 * fechas, mismo `historial` de alergias, mismo conteo de notas— pero sin el
 * campo `contenido` de cada nota. Es la misma idea que ya usa `perfilDe` en
 * el catálogo de especialidades: la redacción es un dato derivado del rol, no
 * un camino de código aparte que alguien pueda olvidarse de mantener.
 */
@Injectable()
export class GetClinicalRecordUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
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

    if (this.ctx.get().rol === 'asistente') {
      return { ...view, notas: view.notas.map(({ contenido: _contenido, ...resto }) => resto) };
    }
    return view;
  }
}
