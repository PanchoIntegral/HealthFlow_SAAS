import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  ClinicalRecordView,
  FinishConsultationResponse,
  StartConsultationResponse,
} from '@healthflow/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../../auth/casl/policies.guard';
import type { ClinicalNoteView } from '@healthflow/shared-types';
import { StartConsultationUseCase } from '../application/start-consultation.use-case';
import { SaveNoteDraftUseCase } from '../application/save-note-draft.use-case';
import { FinishConsultationUseCase } from '../application/finish-consultation.use-case';
import { GetClinicalRecordUseCase } from '../application/get-clinical-record.use-case';
import { GetConsultationNoteUseCase } from '../application/get-consultation-note.use-case';
import { NoteContentDto } from './dto/note-content.dto';
import { ClinicalRecordQueryDto } from './dto/clinical-record-query.dto';

/**
 * Endpoints de la consulta y el expediente. Todos exigen JWT.
 *
 * El contenido clínico (leer/editar/cerrar la nota) sigue detrás de la
 * política `Consultation` — solo médico/admin, requisito de RBAC del prompt.
 * `start` es la única acción de `Consultation` que el asistente también tiene:
 * mueve la cita a "en consulta" (trabajo de recepción/agenda) sin abrir la
 * nota. El expediente (`record`, abajo) usa `Patient` y no `Consultation` a
 * propósito — ver su comentario.
 */
@Controller()
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ConsultationsController {
  constructor(
    private readonly startConsultation: StartConsultationUseCase,
    private readonly saveNoteDraft: SaveNoteDraftUseCase,
    private readonly finishConsultation: FinishConsultationUseCase,
    private readonly getClinicalRecord: GetClinicalRecordUseCase,
    private readonly getConsultationNote: GetConsultationNoteUseCase,
  ) {}

  /** Nota (borrador o cerrada) de una consulta, para hidratar el editor. */
  @Get('consultations/:appointmentId/note')
  @RequirePolicy('read', 'Consultation')
  note(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
  ): Promise<ClinicalNoteView> {
    return this.getConsultationNote.execute(appointmentId);
  }

  /** Inicia la consulta: en_espera → en_consulta, crea el borrador de nota. */
  @Post('appointments/:id/start-consultation')
  @RequirePolicy('start', 'Consultation')
  start(@Param('id', ParseUUIDPipe) id: string): Promise<StartConsultationResponse> {
    return this.startConsultation.execute(id);
  }

  /** Autosave del borrador de la nota. */
  @Put('consultations/:appointmentId/note')
  @RequirePolicy('write', 'Consultation')
  async saveDraft(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: NoteContentDto,
  ): Promise<{ ok: true }> {
    await this.saveNoteDraft.execute(appointmentId, dto.contenido);
    return { ok: true };
  }

  /** Firma y cierre: valida NOM-004, cierra la nota (inmutable), finaliza la cita. */
  @Post('consultations/:appointmentId/finish')
  @RequirePolicy('finish', 'Consultation')
  finish(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: NoteContentDto,
  ): Promise<FinishConsultationResponse> {
    return this.finishConsultation.execute(appointmentId, dto.contenido);
  }

  /**
   * Expediente de un paciente, con el historial paginado por cursor (de la
   * nota más reciente hacia atrás). Sin parámetros devuelve la primera página.
   *
   * Gateado con `read Patient` (que ya tiene cualquier rol autenticado) y NO
   * con `read Consultation`: abrir la ficha del paciente es trabajo de
   * recepción (alergias, documentos, presupuestos), y el asistente lo
   * necesita. El contenido clínico de cada nota (diagnósticos, tratamiento,
   * signos vitales) sigue vedado para ese rol — se redacta DENTRO del caso de
   * uso (`GetClinicalRecordUseCase`), no aquí: la barrera real está en qué
   * datos vienen en la respuesta, no en si la petición pasa el guard.
   */
  @Get('patients/:patientId/clinical-record')
  @RequirePolicy('read', 'Patient')
  record(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: ClinicalRecordQueryDto,
  ): Promise<ClinicalRecordView> {
    return this.getClinicalRecord.execute(patientId, query);
  }
}
