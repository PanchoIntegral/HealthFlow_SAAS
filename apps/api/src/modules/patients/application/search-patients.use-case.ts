import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { PatientDirectoryPage, PatientSummary } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  PATIENT_REPOSITORY,
  type PatientCursor,
  type PatientRepository,
} from '../domain/patient.repository';

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

/**
 * Separador del cursor. NUL a propósito: un nombre sí puede llevar espacios,
 * guiones o dos puntos, y cualquiera de esos partiría mal "Ana Torres<sep>uuid".
 * Postgres no admite NUL dentro de un valor text, así que nunca colisiona.
 */
const SEP = String.fromCharCode(0);

/**
 * Serializa la posición como base64url para que el cliente la trate como opaca.
 * No lleva firma: no es un secreto ni concede acceso — RLS sigue acotando la
 * consulta al tenant, así que un cursor manipulado como mucho pagina mal.
 */
function encodeCursor(c: PatientCursor): string {
  return Buffer.from(`${c.nombre}${SEP}${c.id}`, 'utf8').toString('base64url');
}

function decodeCursor(raw: string): PatientCursor {
  const partes = Buffer.from(raw, 'base64url').toString('utf8').split(SEP);
  const [nombre, id] = partes;
  // El id entra en la consulta como ::uuid; validarlo aquí evita que un cursor
  // roto llegue a Postgres y se convierta en un 500 en vez de un 400.
  const esUuid = !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (partes.length !== 2 || nombre === undefined || !esUuid) {
    throw new BadRequestException('Cursor inválido');
  }
  return { nombre, id };
}

/**
 * Caso de uso: buscador/directorio de pacientes, paginado. Sin query (o con 1
 * caracter) devuelve el directorio del tenant ordenado por nombre — es la vista
 * inicial de "Expedientes"; con 2+ caracteres busca por nombre o CURP.
 */
@Injectable()
export class SearchPatientsUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(PATIENT_REPOSITORY) private readonly repo: PatientRepository,
  ) {}

  execute(query: string, cursorRaw?: string, limitRaw?: number): Promise<PatientDirectoryPage> {
    const q = query.trim();
    const esDirectorio = q.length < 2;
    const desde = cursorRaw ? decodeCursor(cursorRaw) : null;
    const limit = Math.min(Math.max(limitRaw ?? PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);

    return this.tenantDb.run(async (tx) => {
      // Se piden limit+1 filas: la de más solo sirve para saber si queda otra
      // página, y se descarta. Evita una consulta aparte para responder "¿hay
      // más?", que es lo único que necesita el botón de "Cargar más".
      const filas = esDirectorio
        ? await this.repo.list(tx, limit + 1, desde)
        : await this.repo.search(tx, q, limit + 1, desde);

      const hayMas = filas.length > limit;
      const pacientes = hayMas ? filas.slice(0, limit) : filas;
      const ultimo: PatientSummary | undefined = pacientes[pacientes.length - 1];

      const total = esDirectorio
        ? await this.repo.contarTodos(tx)
        : await this.repo.contarCoincidencias(tx, q);

      return {
        pacientes,
        nextCursor: hayMas && ultimo ? encodeCursor({ nombre: ultimo.nombre, id: ultimo.id }) : null,
        total,
      };
    });
  }
}
