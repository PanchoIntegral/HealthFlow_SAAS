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
 * Endpoints de la consulta y el expediente. Todos exigen JWT + política CASL
 * de `Consultation` (solo médico/admin — el asistente NO accede a contenido
 * clínico, requisito de RBAC del prompt).
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
   */
  @Get('patients/:patientId/clinical-record')
  @RequirePolicy('read', 'Consultation')
  record(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: ClinicalRecordQueryDto,
  ): Promise<ClinicalRecordView> {
    return this.getClinicalRecord.execute(patientId, query);
  }
}
