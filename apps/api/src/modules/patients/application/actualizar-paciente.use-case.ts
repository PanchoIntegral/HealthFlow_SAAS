import { Inject, Injectable } from '@nestjs/common';
import type { PatientSummary, UpdatePatientRequest } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import { NombrePacienteInvalidoError, PacienteNoEncontradoError } from '../domain/patient.errors';
import { PATIENT_REPOSITORY, type PatientRepository } from '../domain/patient.repository';

/**
 * Corrige los datos de identificación del paciente: nombre y teléfono.
 *
 * Queda auditado, y no por formalismo: el nombre es cómo se identifica al
 * sujeto de un expediente clínico, y cambiarlo sin rastro permitiría reasignar
 * un historial completo a otra persona sin que quede constancia. Se registran
 * el valor anterior y el nuevo.
 *
 * Las recetas ya emitidas NO cambian: su contenido es un snapshot congelado a
 * propósito (ver 0028), porque deben reimprimirse igual que el papel que se
 * entregó. Corregir un dedazo aquí no reescribe documentos que ya circularon.
 */
@Injectable()
export class ActualizarPacienteUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    @Inject(PATIENT_REPOSITORY) private readonly repo: PatientRepository,
  ) {}

  async execute(patientId: string, input: UpdatePatientRequest): Promise<PatientSummary> {
    const nombre = input.nombre?.trim();
    if (nombre !== undefined && nombre.length < 2) {
      throw new NombrePacienteInvalidoError();
    }

    return this.tenantDb.run(async (tx) => {
      // El nombre anterior se lee ANTES del UPDATE: es lo que hace que la
      // bitácora sirva para reconstruir a quién pertenecía este expediente.
      const nombreAnterior = nombre === undefined ? null : await this.repo.nombreActual(tx, patientId);

      const actualizado = await this.repo.actualizarDatos(tx, patientId, {
        nombre,
        // Cadena vacía = borrar el teléfono, igual que las cédulas del perfil.
        // `undefined` = no se está editando ese campo.
        telefono: input.telefono === undefined ? undefined : input.telefono.trim() || null,
      });
      if (!actualizado) throw new PacienteNoEncontradoError();

      await this.audit.record(tx, {
        entidad: 'patient',
        entidadId: patientId,
        accion: 'actualizar_datos',
        detalle: {
          nombreAnterior,
          nombreNuevo: nombre === undefined ? null : actualizado.nombre,
          cambioTelefono: input.telefono !== undefined,
        },
      });

      return actualizado;
    });
  }
}
