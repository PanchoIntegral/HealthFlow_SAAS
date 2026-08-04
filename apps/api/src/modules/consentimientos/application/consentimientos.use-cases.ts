import { Inject, Injectable } from '@nestjs/common';
import type { ConsentimientoView, CrearConsentimientoRequest } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import { Consentimiento } from '../domain/consentimiento.entity';
import {
  CONSENTIMIENTO_REPOSITORY,
  type ConsentimientoRepository,
} from '../domain/consentimiento.repository';

@Injectable()
export class ConsentimientosUseCases {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    @Inject(CONSENTIMIENTO_REPOSITORY) private readonly repo: ConsentimientoRepository,
  ) {}

  crear(input: CrearConsentimientoRequest): Promise<ConsentimientoView> {
    return this.tenantDb.run(async (tx) => {
      const consentimiento = Consentimiento.crear({
        patientId: input.patientId,
        presupuestoId: input.presupuestoId ?? null,
        doctorId: this.ctx.get().userId,
        procedimiento: input.procedimiento,
        contenido: input.contenido,
      });

      const view = await this.repo.crear(tx, consentimiento);

      await this.audit.record(tx, {
        entidad: 'consentimiento',
        entidadId: view.id,
        accion: 'crear_consentimiento',
        detalle: { patientId: input.patientId, procedimiento: input.procedimiento },
      });

      return view;
    });
  }

  listarPorPaciente(patientId: string): Promise<ConsentimientoView[]> {
    return this.tenantDb.run((tx) => this.repo.listarPorPaciente(tx, patientId));
  }
}
