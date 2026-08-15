import { NotFoundException } from '@nestjs/common';
import type { Tx } from '../../../db/drizzle';
import type { RequestContextService } from '../../../common/tenant-context/request-context';
import type { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import type { ClinicalRecordView } from '@healthflow/shared-types';
import type { ClinicalRecordRepository, PaginaNotas } from '../domain/clinical-record.repository';
import { GetClinicalRecordUseCase } from './get-clinical-record.use-case';

const fakeTenantDb = { run: <T>(fn: (tx: Tx) => Promise<T>) => fn({} as Tx) } as TenantDbService;

function fakeCtx(rol: 'asistente' | 'medico' | 'admin') {
  return { get: () => ({ tenantId: 't', userId: 'u', rol }) } as RequestContextService;
}

function vistaConDosNotas(): ClinicalRecordView {
  return {
    recordId: 'rec-1',
    patientId: 'pac-1',
    patientNombre: 'Ana',
    abiertoEn: '2026-01-01T00:00:00.000Z',
    nextCursor: null,
    totalNotas: 2,
    historial: { sinAlergiasConocidas: true, alergias: [], antecedentes: { banderas: [] } },
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
 * `GetClinicalRecordUseCase` es la barrera real de "el asistente no ve
 * contenido clínico" — el endpoint HTTP quedó abierto a cualquier rol
 * (`RequirePolicy('read', 'Patient')`) a propósito, porque abrir la ficha del
 * paciente es trabajo de recepción. La redacción vive AQUÍ, y si esta prueba
 * se rompiera sin querer, un asistente empezaría a recibir diagnósticos y
 * planes de tratamiento completos sin que nadie lo decidiera.
 */
describe('GetClinicalRecordUseCase', () => {
  it('el asistente recibe el expediente SIN el contenido de las notas', async () => {
    const repo = new FakeClinicalRecordRepository(vistaConDosNotas());
    const useCase = new GetClinicalRecordUseCase(fakeTenantDb, fakeCtx('asistente'), comoRepositorio(repo));

    const vista = await useCase.execute('pac-1');

    expect(vista.notas).toHaveLength(2);
    for (const nota of vista.notas) {
      expect(nota.contenido).toBeUndefined();
    }
  });

  it('el asistente SÍ recibe el resto del expediente intacto (alergias, fechas, estatus)', async () => {
    const repo = new FakeClinicalRecordRepository(vistaConDosNotas());
    const useCase = new GetClinicalRecordUseCase(fakeTenantDb, fakeCtx('asistente'), comoRepositorio(repo));

    const vista = await useCase.execute('pac-1');

    expect(vista.patientNombre).toBe('Ana');
    expect(vista.totalNotas).toBe(2);
    expect(vista.historial).toEqual({ sinAlergiasConocidas: true, alergias: [], antecedentes: { banderas: [] } });
    expect(vista.notas[0]).toMatchObject({ id: 'nota-1', estatus: 'cerrada', tipoNota: 'nota_evolucion' });
    expect(vista.notas[1]).toMatchObject({ id: 'nota-2', estatus: 'borrador' });
  });

  it.each(['medico', 'admin'] as const)('%s SÍ recibe el contenido completo de cada nota', async (rol) => {
    const repo = new FakeClinicalRecordRepository(vistaConDosNotas());
    const useCase = new GetClinicalRecordUseCase(fakeTenantDb, fakeCtx(rol), comoRepositorio(repo));

    const vista = await useCase.execute('pac-1');

    expect(vista.notas[0]?.contenido?.diagnosticos).toEqual([{ cie10: 'R51', descripcion: 'Cefalea' }]);
    expect(vista.notas[0]?.contenido?.planTerapeutico).toBe('Paracetamol 500mg cada 8h');
  });

  it('404 si el paciente aún no tiene expediente, para cualquier rol', async () => {
    const repo = new FakeClinicalRecordRepository(null);
    const useCase = new GetClinicalRecordUseCase(fakeTenantDb, fakeCtx('asistente'), comoRepositorio(repo));

    await expect(useCase.execute('pac-sin-expediente')).rejects.toThrow(NotFoundException);
  });
});
