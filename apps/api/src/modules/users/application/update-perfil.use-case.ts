import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { UpdatePerfilRequest, UserProfile } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AsistenteIaActivoReader } from '../../ai-scribe/application/asistente-ia-activo.reader';
import { ClinicaDentalReader } from '../../presupuestos/application/clinica-dental.reader';
import { DatosClinicaReader } from '../../accounts/application/datos-clinica.reader';
import { USER_PROFILE_REPOSITORY, type UserProfileRepository } from '../domain/user-profile.repository';

/**
 * Perfil profesional propio: especialidad y cédula.
 *
 * La especialidad es seguro cambiarla en caliente: GetConsultationNoteUseCase
 * relee `users.especialidad_key` cada vez que la nota sigue en borrador, así
 * que el cambio se refleja de inmediato en cualquier consulta abierta. Una nota
 * ya CERRADA nunca se reinterpreta — queda congelada con la especialidad y la
 * firma que tenía al cerrarse (NOM-004).
 *
 * La cédula sigue la misma regla, y por eso importa capturarla ANTES de firmar:
 * se estampa dentro de la nota en el momento del cierre (ver
 * finish-consultation.use-case.ts). Capturarla después no repara las notas que
 * ya se firmaron sin ella; esas quedaron así para siempre.
 */
@Injectable()
export class UpdatePerfilUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly asistenteIa: AsistenteIaActivoReader,
    private readonly clinicaDental: ClinicaDentalReader,
    private readonly datosClinica: DatosClinicaReader,
    @Inject(USER_PROFILE_REPOSITORY) private readonly users: UserProfileRepository,
  ) {}

  async execute(userId: string, input: UpdatePerfilRequest): Promise<UserProfile> {
    return this.tenantDb.run(async (tx) => {
      const anterior = await this.users.getById(tx, userId);
      if (!anterior) throw new NotFoundException('Usuario no encontrado');

      /**
       * Campo ausente ⇒ se CONSERVA lo que había; cadena vacía ⇒ se borra a
       * propósito. Es lo que se espera de un PATCH, y aquí además es crítico:
       * el diálogo que pide la cédula al firmar solo manda ese campo, y con la
       * semántica ingenua (`?.trim() || null`) le borraría al médico su
       * etiqueta de agenda sin que nadie lo pidiera.
       */
      const conservar = <T,>(enviado: string | undefined, actual: T) =>
        enviado === undefined ? actual : ((enviado.trim() || null) as T);

      const actualizado = await this.users.updatePerfil(tx, userId, {
        especialidadKey: input.especialidadKey,
        especialidad: conservar(input.especialidad, anterior.especialidad),
        cedulaProfesional: conservar(input.cedulaProfesional, anterior.cedulaProfesional),
        cedulaEspecialidad: conservar(input.cedulaEspecialidad, anterior.cedulaEspecialidad),
        institucionTitulo: conservar(input.institucionTitulo, anterior.institucionTitulo),
        // Sin semántica de "borrar" — siempre viene del <select> de Ajustes.
        formatoHora: input.formatoHora ?? anterior.formatoHora,
      });
      if (!actualizado) throw new NotFoundException('Usuario no encontrado');

      // Se audita el CAMBIO de cédula (no el valor viejo y nuevo en claro más
      // allá de lo necesario): es el dato con el que se firma un expediente, y
      // quién lo cambió y cuándo tiene que poder reconstruirse.
      await this.audit.record(tx, {
        entidad: 'user',
        entidadId: userId,
        accion: 'update_perfil',
        detalle: {
          especialidadKeyAnterior: anterior.especialidadKey,
          especialidadKeyNueva: actualizado.especialidadKey,
          cedulaCambio: anterior.cedulaProfesional !== actualizado.cedulaProfesional,
        },
      });

      // Los flags son del tenant, no del usuario; se componen igual que en
      // GetUserProfileUseCase para que ambas respuestas tengan la misma forma.
      //
      // `clinicaDental` se lee DESPUÉS del UPDATE y dentro de la misma
      // transacción, así que ya cuenta la especialidad recién guardada: el
      // médico que se marca como odontólogo en Ajustes ve aparecer los
      // presupuestos con esa misma respuesta, sin recargar.
      const clinica = await this.datosClinica.leer(tx);
      return {
        ...actualizado,
        asistenteIaActivo: await this.asistenteIa.leer(tx),
        clinicaDental: await this.clinicaDental.leer(tx),
        direccionClinica: clinica.direccion,
        telefonoClinica: clinica.telefono,
      };
    });
  }
}
