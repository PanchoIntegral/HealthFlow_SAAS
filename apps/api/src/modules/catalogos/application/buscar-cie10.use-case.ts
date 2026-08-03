import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  esEspecialidadValida,
  perfilDe,
  type DiagnosticoCie10,
  type EspecialidadKey,
} from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { CIE10_REPOSITORY, type Cie10Repository } from '../domain/cie10.repository';

@Injectable()
export class BuscarCie10UseCase {
  constructor(
    @Inject(CIE10_REPOSITORY) private readonly repo: Cie10Repository,
    private readonly tenantDb: TenantDbService,
  ) {}

  /**
   * @param userId Médico que busca. Su especialidad decide qué códigos suben
   *   al principio de la lista — nunca cuáles se ocultan.
   */
  async execute(query: string, userId: string): Promise<DiagnosticoCie10[]> {
    const q = query.trim();
    if (q.length < 2) return [];

    const especialidad = await this.especialidadDe(userId);
    return this.repo.buscar(q, perfilDe(especialidad).rangosCie10);
  }

  /**
   * Va por TenantDbService y no por la conexión pelada: `users` tiene RLS, y
   * una consulta fuera de una transacción con el tenant fijado devuelve cero
   * filas SIN error — la especialidad degradaba a 'general' en silencio y la
   * priorización simplemente no ocurría.
   *
   * Se lee de la base en vez del JWT para que un cambio de especialidad
   * aplique de inmediato, sin esperar a que caduque el token. Es una búsqueda
   * por llave primaria, despreciable al lado del escaneo trigram del catálogo.
   */
  private async especialidadDe(userId: string): Promise<EspecialidadKey> {
    const key = await this.tenantDb.run(async (tx) => {
      const result = await tx.execute(
        sql`SELECT especialidad_key FROM users WHERE id = ${userId} LIMIT 1`,
      );
      return (result.rows as unknown as { especialidad_key: string }[])[0]?.especialidad_key;
    });
    return esEspecialidadValida(key) ? key : 'general';
  }
}
