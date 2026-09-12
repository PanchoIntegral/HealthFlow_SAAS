import { randomUUID } from 'node:crypto';
import type {
  Abono,
  EstatusPartida,
  EstatusPresupuesto,
  NuevaPartida,
  PresupuestoPartida,
} from '@healthflow/shared-types';
import {
  AbonoExcedeSaldoError,
  PresupuestoCongeladoError,
  PresupuestoNoAceptadoError,
  PresupuestoSinPartidasError,
  TransicionPresupuestoInvalidaError,
} from './presupuesto.errors';

/**
 * Transiciones permitidas. Un presupuesto avanza en una sola dirección: se
 * cotiza, se presenta, el paciente decide, y si acepta se ejecuta hasta
 * terminar. No hay vuelta atrás desde `aceptado` porque a partir de ahí ya hay
 * dinero y trabajo de por medio; lo que sí se puede es cancelar.
 */
const TRANSICIONES: Record<EstatusPresupuesto, readonly EstatusPresupuesto[]> = {
  borrador: ['presentado', 'cancelado'],
  presentado: ['aceptado', 'rechazado', 'borrador', 'cancelado'],
  aceptado: ['terminado', 'cancelado'],
  rechazado: ['borrador'],
  terminado: [],
  cancelado: [],
};

/** Estatus en los que las partidas ya no se tocan (precios congelados). */
const CONGELADOS: readonly EstatusPresupuesto[] = ['aceptado', 'terminado', 'cancelado'];

export interface PresupuestoProps {
  id: string;
  patientId: string;
  doctorId: string;
  titulo: string;
  estatus: EstatusPresupuesto;
  notas: string | null;
  vigenciaHasta: string | null;
  aceptadoEn: Date | null;
  partidas: PresupuestoPartida[];
  abonos: Abono[];
}

/**
 * Entidad del presupuesto. Concentra las dos reglas que no pueden vivir en la
 * base de datos: la máquina de estados y el congelamiento de precios tras la
 * aceptación del paciente. Pura y testeable sin Postgres.
 *
 * Los montos van en CENTAVOS enteros — misma convención que `ConceptoCfdi`,
 * porque las partidas terminan alimentando conceptos de CFDI y mezclar
 * decimales entre módulos produce descuadres de un peso.
 */
export class Presupuesto {
  private constructor(private readonly props: PresupuestoProps) {}

  static crear(input: {
    patientId: string;
    doctorId: string;
    titulo: string;
    notas?: string | null;
    vigenciaHasta?: string | null;
    partidas: NuevaPartida[];
    id?: string;
  }): Presupuesto {
    return new Presupuesto({
      id: input.id ?? randomUUID(),
      patientId: input.patientId,
      doctorId: input.doctorId,
      titulo: input.titulo,
      estatus: 'borrador',
      notas: input.notas ?? null,
      vigenciaHasta: input.vigenciaHasta ?? null,
      aceptadoEn: null,
      partidas: input.partidas.map((p, i) => construirPartida(p, i)),
      abonos: [],
    });
  }

  static fromState(props: PresupuestoProps): Presupuesto {
    return new Presupuesto({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get estatus(): EstatusPresupuesto {
    return this.props.estatus;
  }
  get partidas(): PresupuestoPartida[] {
    return this.props.partidas;
  }
  get abonos(): Abono[] {
    return this.props.abonos;
  }
  get aceptadoEn(): Date | null {
    return this.props.aceptadoEn;
  }

  /** Suma de las partidas NO canceladas. Una partida cancelada no se cobra. */
  get totalCentavos(): number {
    return this.props.partidas
      .filter((p) => p.estatus !== 'cancelada')
      .reduce((sum, p) => sum + p.importeCentavos, 0);
  }

  get abonadoCentavos(): number {
    return this.props.abonos.reduce((sum, a) => sum + a.montoCentavos, 0);
  }

  /** Nunca negativo: `registrarAbono` rechaza el sobrepago. */
  get saldoCentavos(): number {
    return this.totalCentavos - this.abonadoCentavos;
  }

  /** Reemplaza las partidas. Prohibido si el paciente ya aceptó. */
  reemplazarPartidas(nuevas: NuevaPartida[]): void {
    this.assertEditable();
    this.props.partidas = nuevas.map((p, i) => construirPartida(p, i));
  }

  cambiarEstatus(hacia: EstatusPresupuesto, now: Date = new Date()): void {
    const desde = this.props.estatus;
    if (!TRANSICIONES[desde].includes(hacia)) {
      throw new TransicionPresupuestoInvalidaError(desde, hacia);
    }
    // Presentar o aceptar algo vacío no significa nada.
    if ((hacia === 'presentado' || hacia === 'aceptado') && this.props.partidas.length === 0) {
      throw new PresupuestoSinPartidasError();
    }

    this.props.estatus = hacia;
    if (hacia === 'aceptado') this.props.aceptadoEn = now;
  }

  /** Cambia el avance de UNA partida. Permitido aun con precios congelados:
   *  marcar trabajo como hecho no altera lo que se cobra. */
  cambiarEstatusPartida(partidaId: string, estatus: EstatusPartida, appointmentId?: string): void {
    const partida = this.props.partidas.find((p) => p.id === partidaId);
    if (!partida) return;
    partida.estatus = estatus;
    // Se guarda la cita donde se ejecutó: de ahí salen los conceptos del CFDI.
    if (appointmentId !== undefined) partida.appointmentId = appointmentId;
  }

  registrarAbono(input: { montoCentavos: number; metodo: Abono['metodo']; fecha?: string; referencia?: string | null }): Abono {
    if (this.props.estatus !== 'aceptado') {
      throw new PresupuestoNoAceptadoError(this.props.estatus);
    }
    if (input.montoCentavos > this.saldoCentavos) {
      throw new AbonoExcedeSaldoError(this.saldoCentavos, input.montoCentavos);
    }

    const abono: Abono = {
      id: randomUUID(),
      montoCentavos: input.montoCentavos,
      metodo: input.metodo,
      fecha: input.fecha ?? new Date().toISOString().slice(0, 10),
      referencia: input.referencia ?? null,
    };
    this.props.abonos.push(abono);
    return abono;
  }

  /** Partidas terminadas de una cita: lo que se puede facturar de esa sesión. */
  partidasFacturablesDe(appointmentId: string): PresupuestoPartida[] {
    return this.props.partidas.filter(
      (p) => p.estatus === 'terminado' && p.appointmentId === appointmentId,
    );
  }

  private assertEditable(): void {
    if (CONGELADOS.includes(this.props.estatus)) {
      throw new PresupuestoCongeladoError(this.props.estatus);
    }
  }

  toState(): PresupuestoProps {
    return { ...this.props };
  }
}

/**
 * El importe es SIEMPRE derivado, nunca aceptado del cliente: un total
 * manipulable permitiría cotizar por debajo de lo que suman las partidas.
 * Mismo criterio que `ConceptoCfdi.importeCentavos`.
 */
function construirPartida(p: NuevaPartida, orden: number): PresupuestoPartida {
  return {
    id: randomUUID(),
    descripcion: p.descripcion,
    piezas: p.piezas ?? [],
    fase: p.fase ?? 1,
    cantidad: p.cantidad,
    valorUnitarioCentavos: p.valorUnitarioCentavos,
    estatus: 'pendiente',
    appointmentId: null,
    recallTypeId: p.recallTypeId ?? null,
    importeCentavos: Math.round(p.cantidad * p.valorUnitarioCentavos),
  };
}
