import { NotFoundException } from '@nestjs/common';
import type { Tx } from '../../../db/drizzle';
import type { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import type { ClinicalRecordView } from '@healthflow/shared-types';
import type { ClinicalRecordRepository, PaginaNotas } from '../domain/clinical-record.repository';
import { GetClinicalRecordUseCase } from './get-clinical-record.use-case';

const fakeTenantDb = { run: <T>(fn: (tx: Tx) => Promise<T>) => fn({} as Tx) } as TenantDbService;

function vistaConDosNotas(): ClinicalRecordView {
  return {
    recordId: 'rec-1',
    patientId: 'pac-1',
    patientNombre: 'Ana',
    patientTelefono: null,
    patientFechaNacimiento: '1990-01-01',
    abiertoEn: '2026-01-01T00:00:00.000Z',
    nextCursor: null,
    totalNotas: 2,
    historial: { sinAlergiasConocidas: true, alergias: [], antecedentes: { banderas: [] }, sexo: null },
    notas: [
      {
        id: 'nota-1',
        appointmentId: 'apt-1',
        doctorId: 'doc-1',
        tipoNota: 'nota_evolucion',
        estatus: 'cerrada',
        contenido: {
          tipoNota: 'nota_evolucion',
          padecimientoActual: '<p>Dolor de cabeza intenso desde ayer</p>',
          exploracionFisica: { signosVitales: { ta: '120/80', fc: '70', fr: null, temp: null, spo2: null, peso: null, talla: null } },
          diagnosticos: [{ cie10: 'R51', descripcion: 'Cefalea' }],
          planTerapeutico: 'Paracetamol 500mg cada 8h',
        },
        cerradoEn: '2026-01-02T00:00:00.000Z',
        correcciones: [],
    createdAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'nota-2',
        appointmentId: 'apt-2',
        doctorId: 'doc-1',
        tipoNota: 'nota_evolucion',
        estatus: 'borrador',
        contenido: {
          tipoNota: 'nota_evolucion',
          padecimientoActual: '',
          exploracionFisica: { signosVitales: { ta: null, fc: null, fr: null, temp: null, spo2: null, peso: null, talla: null } },
          diagnosticos: [],
          planTerapeutico: '',
        },
        cerradoEn: null,
        correcciones: [],
    createdAt: '2026-02-01T00:00:00.000Z',
      },
    ],
  };
}

/**
 * Solo implementa `getRecordView`: es lo único que este caso de uso llama.
 * El resto del puerto (crear notas, transicionar la cita…) no aplica aquí, y
 * listar sus 8 métodos como no-ops solo ensuciaría la prueba sin agregar
 * ninguna garantía real.
 */
class FakeClinicalRecordRepository implements Pick<ClinicalRecordRepository, 'getRecordView'> {
  constructor(private readonly vista: ClinicalRecordView | null) {}
  async getRecordView(_tx: Tx, _patientId: string, _page: PaginaNotas) {
    return this.vista;
  }
}

function comoRepositorio(fake: FakeClinicalRecordRepository): ClinicalRecordRepository {
  return fake as unknown as ClinicalRecordRepository;
}

/**
 * `GetClinicalRecordUseCase` sirve el expediente TAL CUAL lo devuelve el
 * repositorio, sin distinguir por rol — decisión explícita del titular de la
 * cuenta: el asistente tiene acceso completo al expediente (contenido de las
 * notas incluido), distinto de otras secciones (Cuenta, Finanzas) que siguen
 * detrás de `Consultation`/`manage`. Quien controla QUIÉN puede llegar aquí
 * es el guard del controller (`RequirePolicy('read', 'Patient')`), no este
 * caso de uso. Esta prueba existe para que, si alguien reintroduce una
 * redacción por rol más adelante, sea una decisión consciente y no un efecto
 * secundario de otro cambio.
 */
describe('GetClinicalRecordUseCase', () => {
  it('devuelve el expediente completo, notas y contenido incluidos', async () => {
    const repo = new FakeClinicalRecordRepository(vistaConDosNotas());
    const useCase = new GetClinicalRecordUseCase(fakeTenantDb, comoRepositorio(repo));

    const vista = await useCase.execute('pac-1');

    expect(vista.patientNombre).toBe('Ana');
    expect(vista.totalNotas).toBe(2);
    expect(vista.historial).toEqual({ sinAlergiasConocidas: true, alergias: [], antecedentes: { banderas: [] }, sexo: null });
    expect(vista.notas[0]?.contenido.diagnosticos).toEqual([{ cie10: 'R51', descripcion: 'Cefalea' }]);
    expect(vista.notas[0]?.contenido.planTerapeutico).toBe('Paracetamol 500mg cada 8h');
    expect(vista.notas[1]).toMatchObject({ id: 'nota-2', estatus: 'borrador' });
  });

  it('respeta el límite y el cursor que le pasen', async () => {
    const repo = new FakeClinicalRecordRepository(vistaConDosNotas());
    let recibido: PaginaNotas | undefined;
    repo.getRecordView = async (_tx, _patientId, page) => {
      recibido = page;
      return vistaConDosNotas();
    };
    const useCase = new GetClinicalRecordUseCase(fakeTenantDb, comoRepositorio(repo));

    await useCase.execute('pac-1', { limit: 5, cursor: 'cursor-abc' });

    expect(recibido).toEqual({ limit: 5, cursor: 'cursor-abc' });
  });

  it('topa el límite pedido al máximo permitido', async () => {
    const repo = new FakeClinicalRecordRepository(vistaConDosNotas());
    let recibido: PaginaNotas | undefined;
    repo.getRecordView = async (_tx, _patientId, page) => {
      recibido = page;
      return vistaConDosNotas();
    };
    const useCase = new GetClinicalRecordUseCase(fakeTenantDb, comoRepositorio(repo));

    await useCase.execute('pac-1', { limit: 9999 });

    expect(recibido?.limit).toBeLessThanOrEqual(50);
  });

  it('404 si el paciente aún no tiene expediente', async () => {
    const repo = new FakeClinicalRecordRepository(null);
    const useCase = new GetClinicalRecordUseCase(fakeTenantDb, comoRepositorio(repo));

    await expect(useCase.execute('pac-sin-expediente')).rejects.toThrow(NotFoundException);
  });
});
