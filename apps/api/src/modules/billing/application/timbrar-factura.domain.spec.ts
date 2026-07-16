import { NotFoundException } from '@nestjs/common';
import type { Tx } from '../../../db/drizzle';
import type { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import type { AuditService } from '../../../common/audit/audit.service';
import type { AppointmentRepository } from '../../appointments/domain/appointment.repository';
import type { ConceptoCfdi } from '../domain/concepto-cfdi.entity';
import { EmisorFiscal } from '../domain/emisor-fiscal.entity';
import type { Factura } from '../domain/factura.entity';
import {
  EmisorNoConfiguradoError,
  FacturaYaEmitidaError,
  PacTimbradoError,
} from '../domain/factura.errors';
import type { FacturaRepository } from '../domain/factura.repository';
import type { ReceptorFiscal } from '../domain/receptor-fiscal.entity';
import { Rfc } from '../domain/rfc.value-object';
import { FakePacAdapter } from '../infrastructure/pac/fake-pac.adapter';
import { TimbrarFacturaUseCase, type TimbrarFacturaInput } from './timbrar-factura.use-case';

/** TenantDb falso: ejecuta el callback con una Tx vacía (sin base de datos). */
const fakeTenantDb = { run: <T>(fn: (tx: Tx) => Promise<T>) => fn({} as Tx) } as TenantDbService;
const fakeAudit = { record: jest.fn() } as unknown as AuditService;

class InMemoryFacturaRepo implements FacturaRepository {
  facturas = new Map<string, Factura>();
  conceptos = new Map<string, ConceptoCfdi[]>();
  emisor: EmisorFiscal | null = EmisorFiscal.fromState({
    id: 'emisor-1',
    rfc: Rfc.create('EKU9003173C9'),
    razonSocial: 'Clínica Demo',
    regimenFiscal: '601',
    codigoPostal: '22000',
    facturapiOrgId: null,
  });
  /** Simula el 23505 del índice único parcial en el insert. */
  failInsertConDuplicado = false;

  async insertPendiente(_tx: Tx, factura: Factura, conceptos: ConceptoCfdi[]): Promise<void> {
    if (this.failInsertConDuplicado) throw new FacturaYaEmitidaError();
    this.facturas.set(factura.id, factura);
    this.conceptos.set(factura.id, conceptos);
  }
  async findById(_tx: Tx, id: string): Promise<Factura | null> {
    return this.facturas.get(id) ?? null;
  }
  async findUltimaByAppointment(_tx: Tx, appointmentId: string): Promise<Factura | null> {
    const todas = [...this.facturas.values()].filter((f) => f.appointmentId === appointmentId);
    return todas[todas.length - 1] ?? null;
  }
  async findActivaByAppointment(_tx: Tx, appointmentId: string): Promise<Factura | null> {
    for (const f of this.facturas.values()) {
      if (f.appointmentId === appointmentId && ['PENDIENTE', 'TIMBRADA'].includes(f.estatus)) {
        return f;
      }
    }
    return null;
  }
  async updateEstado(_tx: Tx, factura: Factura): Promise<void> {
    this.facturas.set(factura.id, factura);
  }
  async listConceptos(_tx: Tx, facturaId: string): Promise<ConceptoCfdi[]> {
    return this.conceptos.get(facturaId) ?? [];
  }
  async findEmisorByTenant(): Promise<EmisorFiscal | null> {
    return this.emisor;
  }
  async saveReceptor(_tx: Tx, _receptor: ReceptorFiscal): Promise<string> {
    return 'receptor-1';
  }
}

const appointments = {
  findById: jest.fn(),
} as unknown as jest.Mocked<AppointmentRepository>;

const input = (appointmentId = 'appt-1'): TimbrarFacturaInput => ({
  appointmentId,
  receptor: {
    rfc: 'GODE561231GR8',
    razonSocial: 'Juan Pérez',
    regimenFiscal: '605',
    codigoPostal: '22010',
    usoCfdi: 'D01',
  },
  conceptos: [
    {
      claveProdServ: '85121600',
      claveUnidad: 'E48',
      descripcion: 'Consulta médica general',
      cantidad: 1,
      valorUnitario: 500, // pesos
      tratamientoIva: 'EXENTO',
    },
  ],
});

describe('TimbrarFacturaUseCase', () => {
  let repo: InMemoryFacturaRepo;
  let pac: FakePacAdapter;
  let useCase: TimbrarFacturaUseCase;

  beforeEach(() => {
    repo = new InMemoryFacturaRepo();
    pac = new FakePacAdapter();
    useCase = new TimbrarFacturaUseCase(fakeTenantDb, fakeAudit, appointments, repo, pac);
    (appointments.findById as jest.Mock).mockResolvedValue({ id: 'appt-1' });
  });

  it('happy path: timbra y devuelve la factura TIMBRADA con totales calculados', async () => {
    const view = await useCase.execute(input());
    expect(view.estatus).toBe('TIMBRADA');
    expect(view.uuidFiscal).not.toBeNull();
    expect(view.subtotal).toBe('500.00');
    expect(view.iva).toBe('0.00'); // consulta médica exenta
    expect(view.total).toBe('500.00');
    expect(view.conceptos).toHaveLength(1);
  });

  it('cita inexistente o de otro tenant (oculta por RLS) → 404', async () => {
    (appointments.findById as jest.Mock).mockResolvedValue(null);
    await expect(useCase.execute(input())).rejects.toThrow(NotFoundException);
  });

  it('sin emisor fiscal configurado → EmisorNoConfiguradoError', async () => {
    repo.emisor = null;
    await expect(useCase.execute(input())).rejects.toThrow(EmisorNoConfiguradoError);
  });

  it('ya existe factura TIMBRADA para la cita → FacturaYaEmitidaError (idempotencia)', async () => {
    await useCase.execute(input());
    await expect(useCase.execute(input())).rejects.toThrow(FacturaYaEmitidaError);
  });

  it('carrera de doble submit: el 23505 del índice se traduce a FacturaYaEmitidaError', async () => {
    repo.failInsertConDuplicado = true;
    await expect(useCase.execute(input())).rejects.toThrow(FacturaYaEmitidaError);
  });

  it('fallo del PAC: la factura queda persistida en ERROR y se propaga PacTimbradoError', async () => {
    pac.failNextTimbrado = true;
    await expect(useCase.execute(input())).rejects.toThrow(PacTimbradoError);

    const guardada = await repo.findActivaByAppointment({} as Tx, 'appt-1');
    expect(guardada).toBeNull(); // ERROR no cuenta como "viva"
    const todas = [...repo.facturas.values()];
    expect(todas).toHaveLength(1);
    expect(todas[0]!.estatus).toBe('ERROR');
  });

  it('tras un ERROR se puede volver a intentar el timbrado de la misma cita', async () => {
    pac.failNextTimbrado = true;
    await expect(useCase.execute(input())).rejects.toThrow(PacTimbradoError);

    const view = await useCase.execute(input());
    expect(view.estatus).toBe('TIMBRADA');
  });
});
