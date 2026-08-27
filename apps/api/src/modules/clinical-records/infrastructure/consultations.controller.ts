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
  CorreccionNota,
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
import { CorregirNotaUseCase } from '../application/corregir-nota.use-case';
import { NoteContentDto } from './dto/note-content.dto';
import { CrearCorreccionDto } from './dto/correccion.dto';
import { ClinicalRecordQueryDto } from './dto/clinical-record-query.dto';

/**
 * Endpoints de la consulta y el expediente. Todos exigen JWT.
 *
 * Editar la nota EN VIVO (abrir el editor de una consulta en curso, guardar
 * el borrador, firmar y cerrar) sigue detrás de la política `Consultation` —
 * solo médico/admin. `start` es la única acción de `Consultation` que el
 * asistente también tiene: mueve la cita a "en consulta" (trabajo de
 * recepción/agenda) sin abrir la nota.
 *
 * El EXPEDIENTE (`record`, abajo) es distinto a propósito: usa `Patient` y no
 * `Consultation`, y el asistente tiene acceso completo —incluido el
 * contenido de cada nota ya cerrada— por decisión explícita del titular de
 * la cuenta. No es una incoherencia con lo anterior: una cosa es escribir en
 * una consulta que está pasando ahora mismo, y otra es consultar el
 * historial ya cerrado de un paciente.
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
    private readonly corregirNota: CorregirNotaUseCase,
  ) {}

  /**
   * Agrega una corrección (adenda) a una nota ya cerrada. La nota original NO
   * se toca: la NOM-004 prohíbe enmendaduras, y rectificar es agregar.
   *
   * Va bajo la política `write` de `Consultation` —médico/admin— y no bajo
   * `Patient`: aunque se hace desde el expediente, escribir una aclaración
   * clínica firmada es un acto médico, no captura de recepción. El asistente
   * lee el expediente completo pero no firma nada dentro de él.
   */
  @Post('notas/:noteId/correcciones')
  @RequirePolicy('write', 'Consultation')
  corregir(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: CrearCorreccionDto,
  ): Promise<CorreccionNota> {
    return this.corregirNota.execute(noteId, dto.texto);
  }

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
   * con `read Consultation`: el asistente tiene acceso completo, contenido
   * clínico de cada nota incluido.
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
