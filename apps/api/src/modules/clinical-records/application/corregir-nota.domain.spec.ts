import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CorreccionNota } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import type { RequestContextService } from '../../../common/tenant-context/request-context';
import type { AuditService } from '../../../common/audit/audit.service';
import type {
  ClinicalRecordRepository,
  NuevaCorreccionInput,
} from '../domain/clinical-record.repository';
import { CorregirNotaUseCase } from './corregir-nota.use-case';

const fakeTenantDb = { run: <T>(fn: (tx: Tx) => Promise<T>) => fn({} as Tx) } as TenantDbService;
const fakeAudit = { record: jest.fn() } as unknown as AuditService;
const fakeCtx = {
  get: () => ({ tenantId: 'tenant-1', userId: 'user-1', rol: 'medico' }),
} as RequestContextService;

function repoCon(estatus: string | null) {
  const creadas: NuevaCorreccionInput[] = [];
  const repo = {
    getNotaBasica: async () => (estatus ? { id: 'nota-1', estatus } : null),
    crearCorreccion: async (_tx: Tx, input: NuevaCorreccionInput): Promise<CorreccionNota> => {
      creadas.push(input);
      return {
        id: 'corr-1',
        texto: input.texto,
        autorNombre: 'Dra. Prueba',
        autorCedula: '1234567',
        createdAt: new Date().toISOString(),
      };
    },
  } as unknown as ClinicalRecordRepository;
  return { repo, creadas };
}

const TEXTO = 'La lesión corresponde al pie izquierdo, no al derecho.';

describe('CorregirNotaUseCase', () => {
  it('agrega la corrección a una nota cerrada', async () => {
    const { repo, creadas } = repoCon('cerrada');
    const useCase = new CorregirNotaUseCase(fakeTenantDb, fakeCtx, fakeAudit, repo);

    const corr = await useCase.execute('nota-1', TEXTO);

    expect(corr.texto).toBe(TEXTO);
    expect(creadas).toHaveLength(1);
    expect(creadas[0]!.autorId).toBe('user-1');
  });

  it('NO permite corregir un borrador: esa nota todavía se edita', async () => {
    const { repo, creadas } = repoCon('borrador');
    const useCase = new CorregirNotaUseCase(fakeTenantDb, fakeCtx, fakeAudit, repo);

    await expect(useCase.execute('nota-1', TEXTO)).rejects.toThrow(BadRequestException);
    expect(creadas).toHaveLength(0);
  });

  it('rechaza un texto que no explica nada', async () => {
    const { repo, creadas } = repoCon('cerrada');
    const useCase = new CorregirNotaUseCase(fakeTenantDb, fakeCtx, fakeAudit, repo);

    // "error" no le sirve a quien lea el expediente después.
    await expect(useCase.execute('nota-1', 'error')).rejects.toThrow(BadRequestException);
    // Ni los espacios cuentan como explicación.
    await expect(useCase.execute('nota-1', '              ')).rejects.toThrow(BadRequestException);
    expect(creadas).toHaveLength(0);
  });

  it('404 si la nota no existe en el tenant activo', async () => {
    const { repo } = repoCon(null);
    const useCase = new CorregirNotaUseCase(fakeTenantDb, fakeCtx, fakeAudit, repo);

    await expect(useCase.execute('nota-fantasma', TEXTO)).rejects.toThrow(NotFoundException);
  });
});
