import { BadRequestException } from '@nestjs/common';
import type { Tx } from '../../../db/drizzle';
import type { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import type { RequestContextService } from '../../../common/tenant-context/request-context';
import type { AuditService } from '../../../common/audit/audit.service';
import { FakeAlmacenamientoAdapter } from '../infrastructure/storage/fake-almacenamiento.adapter';
import type {
  NewRadiografiaInput,
  RadiografiaRepository,
  RadiografiaRow,
} from '../domain/radiografia.repository';
import { RequestUploadUrlUseCase } from './request-upload-url.use-case';
import { ConfirmRadiografiaUseCase } from './confirm-radiografia.use-case';

const fakeTenantDb = { run: <T>(fn: (tx: Tx) => Promise<T>) => fn({} as Tx) } as TenantDbService;
const fakeAudit = { record: jest.fn() } as unknown as AuditService;
const fakeCtx = {
  get: () => ({ tenantId: 'tenant-1', userId: 'user-1', rol: 'medico' }),
} as RequestContextService;

class InMemoryRadiografiaRepo implements RadiografiaRepository {
  filas: RadiografiaRow[] = [];

  async crear(_tx: Tx, input: NewRadiografiaInput): Promise<RadiografiaRow> {
    const row: RadiografiaRow = {
      id: `rad-${this.filas.length + 1}`,
      patientId: input.patientId,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      subidoPorNombre: 'Dr. Prueba',
      createdAt: new Date().toISOString(),
    };
    this.filas.push(row);
    return row;
  }
  async listarPorPaciente(_tx: Tx, patientId: string): Promise<RadiografiaRow[]> {
    return this.filas.filter((f) => f.patientId === patientId);
  }
  async eliminar(_tx: Tx, id: string): Promise<RadiografiaRow | null> {
    const i = this.filas.findIndex((f) => f.id === id);
    if (i === -1) return null;
    const [row] = this.filas.splice(i, 1);
    return row!;
  }
}

describe('RequestUploadUrlUseCase', () => {
  it('arma la clave con el tenant y paciente actuales', async () => {
    const storage = new FakeAlmacenamientoAdapter();
    const useCase = new RequestUploadUrlUseCase(fakeCtx, storage);

    const result = await useCase.execute({ patientId: 'pac-1', mimeType: 'image/jpeg' });

    expect(result.storageKey).toMatch(/^tenant\/tenant-1\/patients\/pac-1\/.+\.jpg$/);
    expect(storage.objetos.has(result.storageKey)).toBe(true);
    // El Content-Type viaja firmado: el cliente debe mandarlo tal cual.
    expect(result.headers['Content-Type']).toBe('image/jpeg');
  });

  it('usa la extensión correcta según el mimeType', async () => {
    const storage = new FakeAlmacenamientoAdapter();
    const useCase = new RequestUploadUrlUseCase(fakeCtx, storage);

    const png = await useCase.execute({ patientId: 'pac-1', mimeType: 'image/png' });
    expect(png.storageKey).toMatch(/\.png$/);
  });
});

describe('ConfirmRadiografiaUseCase', () => {
  it('registra la metadata cuando el storageKey corresponde al tenant/paciente', async () => {
    const storage = new FakeAlmacenamientoAdapter();
    const repo = new InMemoryRadiografiaRepo();
    const key = 'tenant/tenant-1/patients/pac-1/abc.jpg';
    // El objeto tiene que existir en storage: confirmar es el paso POSTERIOR
    // a la subida, no un alta independiente.
    await storage.presignedUploadUrl(key, 'image/jpeg');
    const useCase = new ConfirmRadiografiaUseCase(fakeTenantDb, fakeCtx, fakeAudit, storage, repo);

    const view = await useCase.execute({
      patientId: 'pac-1',
      storageKey: key,
      mimeType: 'image/jpeg',
    });

    expect(view.patientId).toBe('pac-1');
    expect(repo.filas).toHaveLength(1);
  });

  it('rechaza confirmar una imagen que nunca llegó al storage', async () => {
    const storage = new FakeAlmacenamientoAdapter();
    const repo = new InMemoryRadiografiaRepo();
    const useCase = new ConfirmRadiografiaUseCase(fakeTenantDb, fakeCtx, fakeAudit, storage, repo);

    // La subida se cortó a medias: sin esto quedaba registrada una radiografía
    // que después no abre.
    await expect(
      useCase.execute({
        patientId: 'pac-1',
        storageKey: 'tenant/tenant-1/patients/pac-1/nunca-subida.jpg',
        mimeType: 'image/jpeg',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(repo.filas).toHaveLength(0);
  });

  it('rechaza un storageKey que no corresponde al tenant/paciente de la petición', async () => {
    const storage = new FakeAlmacenamientoAdapter();
    const repo = new InMemoryRadiografiaRepo();
    const useCase = new ConfirmRadiografiaUseCase(fakeTenantDb, fakeCtx, fakeAudit, storage, repo);

    await expect(
      useCase.execute({
        patientId: 'pac-1',
        // Pretende confirmar un objeto de OTRO tenant.
        storageKey: 'tenant/tenant-ajeno/patients/pac-1/abc.jpg',
        mimeType: 'image/jpeg',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(repo.filas).toHaveLength(0);
  });

  it('rechaza un storageKey de OTRO paciente del mismo tenant', async () => {
    const storage = new FakeAlmacenamientoAdapter();
    const repo = new InMemoryRadiografiaRepo();
    const useCase = new ConfirmRadiografiaUseCase(fakeTenantDb, fakeCtx, fakeAudit, storage, repo);

    await expect(
      useCase.execute({
        patientId: 'pac-1',
        storageKey: 'tenant/tenant-1/patients/pac-OTRO/abc.jpg',
        mimeType: 'image/jpeg',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
