import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  perfilDe,
  type NotaEvolucionContent,
  type PerfilEspecialidad,
  type TranscribirConsultaResponse,
} from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import {
  CLINICAL_RECORD_REPOSITORY,
  type ClinicalRecordRepository,
} from '../../clinical-records/domain/clinical-record.repository';
import {
  ASISTENTE_CLINICO_IA,
  type AsistenteClinicoIaPort,
} from '../domain/asistente-clinico-ia.port';
import { AsistenteIaNoActivadoError } from '../domain/asistente-ia.errors';
import { AsistenteIaActivoReader } from './asistente-ia-activo.reader';

/**
 * Convierte el audio de una consulta en un borrador de nota.
 *
 * Lo que este caso de uso NO hace, y es lo importante: no guarda el audio, no
 * escribe la nota y no la cierra. Devuelve una sugerencia al navegador, y es
 * el médico quien decide qué se queda y quién firma. La nota se persiste por
 * el camino de siempre (el autoguardado del borrador), así que si esta función
 * desapareciera mañana el expediente seguiría igual de completo.
 *
 * Tres fases, con la llamada al modelo FUERA de la transacción — mismo molde
 * que TimbrarFacturaUseCase con el PAC. Aquí la razón pesa todavía más: una
 * consulta de 20 minutos puede tardar más de un minuto en procesarse, y
 * mantener abierta una transacción de Postgres todo ese rato secuestra una
 * conexión del pool y arrastra un snapshot vivo por cada médico que firme.
 * Además hace que la bitácora del fallo sobreviva: si se auditara dentro de la
 * misma transacción que revienta, el rollback borraría justo el registro de
 * que algo salió mal.
 *
 * El buffer del audio entra por parámetro y sale de alcance al terminar: no se
 * escribe a disco, no se sube a storage y no entra en la bitácora.
 */
@Injectable()
export class TranscribirConsultaUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly flag: AsistenteIaActivoReader,
    @Inject(CLINICAL_RECORD_REPOSITORY) private readonly records: ClinicalRecordRepository,
    @Inject(ASISTENTE_CLINICO_IA) private readonly asistente: AsistenteClinicoIaPort,
  ) {}

  async execute(
    appointmentId: string,
    audio: Buffer,
    mimeType: string,
    camposYaLlenados: Partial<NotaEvolucionContent>,
  ): Promise<TranscribirConsultaResponse> {
    // Fase 1 (transacción corta): permiso y contexto clínico.
    const { noteId, perfil } = await this.tenantDb.run<{
      noteId: string;
      perfil: PerfilEspecialidad;
    }>(async (tx) => {
      if (!(await this.flag.leer(tx))) throw new AsistenteIaNoActivadoError();

      // RLS hace que una cita de otra clínica simplemente no exista aquí.
      const note = await this.records.findNoteByAppointment(tx, appointmentId);
      if (!note) throw new NotFoundException('Nota no encontrada');

      /**
       * El perfil sale de la NOTA, no del médico conectado — mismo criterio que
       * el editor: una nota abierta con odontología se llena con campos de
       * odontología aunque su autor haya cambiado de especialidad ayer.
       */
      return { noteId: note.id, perfil: perfilDe(note.contenido.especialidad) };
    });

    // Fase 2 (sin transacción abierta): el modelo.
    let resultado: TranscribirConsultaResponse | null = null;
    let error: unknown = null;
    try {
      resultado = await this.asistente.extraer({ audio, mimeType, perfil, camposYaLlenados });
    } catch (err) {
      error = err;
    }

    // Fase 3 (transacción corta): bitácora, pase lo que pase. Se registra QUÉ
    // campos propuso, nunca el contenido: la bitácora deja constancia del uso
    // de la herramienta, no una segunda copia del expediente en un lugar con
    // otras reglas de acceso.
    await this.tenantDb.run((tx) =>
      this.audit.record(tx, {
        entidad: 'clinical_note',
        entidadId: noteId,
        accion: 'ia_transcribir_nota',
        detalle: {
          ok: error === null,
          audioBytes: audio.byteLength,
          ...(resultado ? { camposSugeridos: Object.keys(resultado.contenido) } : {}),
        },
      }),
    );

    if (error !== null) throw error;
    return resultado!;
  }
}
