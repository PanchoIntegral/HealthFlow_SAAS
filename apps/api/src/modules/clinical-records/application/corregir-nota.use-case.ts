import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CORRECCION_TEXTO_MAX,
  CORRECCION_TEXTO_MIN,
  type CorreccionNota,
} from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import { Inject } from '@nestjs/common';
import {
  CLINICAL_RECORD_REPOSITORY,
  type ClinicalRecordRepository,
} from '../domain/clinical-record.repository';

/**
 * Agrega una anotación aclaratoria a una nota YA CERRADA.
 *
 * Es la única forma de corregir una nota firmada, y no un atajo: la NOM-004
 * prohíbe enmendaduras y tachaduras, así que el texto original se conserva
 * intacto y la rectificación se guarda al lado, firmada y fechada por quien
 * la hace. Un expediente donde la nota original desapareció es indefendible
 * ante un perito; uno con la nota y su corrección visible, no.
 *
 * Sobre una nota en BORRADOR no aplica: esa todavía se edita normalmente,
 * porque aún no está firmada.
 */
@Injectable()
export class CorregirNotaUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    @Inject(CLINICAL_RECORD_REPOSITORY) private readonly repo: ClinicalRecordRepository,
  ) {}

  async execute(noteId: string, texto: string): Promise<CorreccionNota> {
    const limpio = texto.trim();
    if (limpio.length < CORRECCION_TEXTO_MIN) {
      throw new BadRequestException(
        `La corrección debe explicar qué se rectifica (mínimo ${CORRECCION_TEXTO_MIN} caracteres).`,
      );
    }
    if (limpio.length > CORRECCION_TEXTO_MAX) {
      throw new BadRequestException(
        `La corrección no puede exceder ${CORRECCION_TEXTO_MAX} caracteres.`,
      );
    }

    const { userId } = this.ctx.get();

    return this.tenantDb.run(async (tx) => {
      const nota = await this.repo.getNotaBasica(tx, noteId);
      if (!nota) throw new NotFoundException('Nota no encontrada');
      if (nota.estatus !== 'cerrada') {
        throw new BadRequestException(
          'Esta nota todavía es un borrador: edítala directamente en la consulta.',
        );
      }

      const correccion = await this.repo.crearCorreccion(tx, {
        clinicalNoteId: noteId,
        autorId: userId,
        texto: limpio,
      });

      await this.audit.record(tx, {
        entidad: 'nota_clinica',
        entidadId: noteId,
        accion: 'corregir_nota',
        detalle: { correccionId: correccion.id },
      });

      return correccion;
    });
  }
}
