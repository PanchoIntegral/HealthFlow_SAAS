'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FacturaView,
  MotivoCancelacionSat,
  TimbrarFacturaRequest,
  TratamientoIva,
} from '@healthflow/shared-types';
import { useAuth } from '../lib/auth';
import { api, ApiError } from '../lib/api';

const RFC_PUBLICO_GENERAL = 'XAXX010101000';

const MOTIVOS_SAT: { value: MotivoCancelacionSat; label: string }[] = [
  { value: '01', label: '01 · Emitida con errores CON relación' },
  { value: '02', label: '02 · Emitida con errores SIN relación' },
  { value: '03', label: '03 · No se llevó a cabo la operación' },
  { value: '04', label: '04 · Operación nominativa en factura global' },
];

const REGIMENES = [
  { value: '605', label: '605 · Sueldos y salarios' },
  { value: '612', label: '612 · Personas físicas con act. empresarial' },
  { value: '626', label: '626 · RESICO' },
  { value: '601', label: '601 · General de ley (moral)' },
  { value: '616', label: '616 · Sin obligaciones fiscales' },
];

const USOS_CFDI = [
  { value: 'D01', label: 'D01 · Honorarios médicos' },
  { value: 'G03', label: 'G03 · Gastos en general' },
  { value: 'S01', label: 'S01 · Sin efectos fiscales' },
];

const TRATAMIENTOS: { value: TratamientoIva; label: string }[] = [
  { value: 'EXENTO', label: 'Exento (consulta médica)' },
  { value: 'TASA_16', label: 'IVA 16%' },
  { value: 'TASA_0', label: 'IVA 0%' },
];

interface ConceptoForm {
  claveProdServ: string;
  claveUnidad: string;
  descripcion: string;
  cantidad: number;
  valorUnitario: number;
  tratamientoIva: TratamientoIva;
}

const CONCEPTO_CONSULTA: ConceptoForm = {
  claveProdServ: '85121600',
  claveUnidad: 'E48',
  descripcion: 'Consulta médica',
  cantidad: 1,
  valorUnitario: 500,
  tratamientoIva: 'EXENTO',
};

const pesos = (n: number) =>
  n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

function ivaConcepto(c: ConceptoForm): number {
  return c.tratamientoIva === 'TASA_16' ? c.cantidad * c.valorUnitario * 0.16 : 0;
}

const facturaQueryKey = (appointmentId: string) => ['factura', appointmentId];

/**
 * Estado de facturación de una cita finalizada + acciones (timbrar/cancelar).
 * Los totales aquí son SOLO visuales: el servidor recalcula desde los conceptos
 * y su versión es la que vale.
 */
export function FacturaPanel({ appointmentId }: { appointmentId: string }) {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<'timbrar' | 'cancelar' | null>(null);

  const canBill = ['asistente', 'medico', 'admin'].includes(user?.rol ?? '');
  const canCancel = ['medico', 'admin'].includes(user?.rol ?? '');

  const { data: factura, isLoading } = useQuery({
    queryKey: facturaQueryKey(appointmentId),
    queryFn: () => api.getFacturaDeCita(token!, appointmentId),
    enabled: !!token && canBill,
  });

  if (!token || !canBill || isLoading) return null;

  const onDone = (updated: FacturaView) => {
    queryClient.setQueryData(facturaQueryKey(appointmentId), updated);
    setModal(null);
  };

  return (
    <div className="border-t border-slate-100 pt-3">
      {/* Sin factura, o la última quedó CANCELADA/ERROR → se puede (re)facturar */}
      {(!factura || factura.estatus === 'CANCELADA' || factura.estatus === 'ERROR') && (
        <div className="flex flex-col gap-2">
          {factura?.estatus === 'ERROR' && (
            <p className="text-xs font-medium text-red-600">
              ⚠ El timbrado anterior falló — puedes reintentar
            </p>
          )}
          {factura?.estatus === 'CANCELADA' && (
            <p className="text-xs text-slate-500">
              Factura anterior cancelada (motivo {factura.motivoCancelacion})
            </p>
          )}
          <button
            onClick={() => setModal('timbrar')}
            className="rounded-lg border border-brand-blue py-2 text-sm font-semibold text-brand-blue transition hover:bg-brand-blue/5"
          >
            {factura?.estatus === 'ERROR' ? 'Reintentar timbrado' : 'Facturar'} 🧾
          </button>
        </div>
      )}

      {factura?.estatus === 'TIMBRADA' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              ● Facturada · {pesos(parseFloat(factura.total))}
            </span>
            {canCancel && (
              <button
                onClick={() => setModal('cancelar')}
                className="text-xs font-medium text-slate-400 transition hover:text-red-600"
              >
                Cancelar factura
              </button>
            )}
          </div>
          <p className="truncate text-[11px] text-slate-400" title={factura.uuidFiscal ?? ''}>
            Folio fiscal: {factura.uuidFiscal}
          </p>
        </div>
      )}

      {factura?.estatus === 'PENDIENTE' && (
        <p className="text-xs text-slate-500">Timbrado en curso…</p>
      )}

      {modal === 'timbrar' && (
        <TimbrarModal
          appointmentId={appointmentId}
          token={token}
          onClose={() => setModal(null)}
          onDone={onDone}
        />
      )}
      {modal === 'cancelar' && factura && (
        <CancelarModal
          factura={factura}
          token={token}
          onClose={() => setModal(null)}
          onDone={onDone}
        />
      )}
    </div>
  );
}

// ─── Modal de timbrado ───────────────────────────────────────────

function TimbrarModal({
  appointmentId,
  token,
  onClose,
  onDone,
}: {
  appointmentId: string;
  token: string;
  onClose: () => void;
  onDone: (f: FacturaView) => void;
}) {
  const [rfc, setRfc] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [regimenFiscal, setRegimenFiscal] = useState('605');
  const [codigoPostal, setCodigoPostal] = useState('');
  const [usoCfdi, setUsoCfdi] = useState('D01');
  const [conceptos, setConceptos] = useState<ConceptoForm[]>([{ ...CONCEPTO_CONSULTA }]);

  const timbrar = useMutation({
    mutationFn: (body: TimbrarFacturaRequest) => api.timbrarFactura(token, body),
    onSuccess: onDone,
  });

  const totales = useMemo(() => {
    const subtotal = conceptos.reduce((s, c) => s + c.cantidad * c.valorUnitario, 0);
    const iva = conceptos.reduce((s, c) => s + ivaConcepto(c), 0);
    return { subtotal, iva, total: subtotal + iva };
  }, [conceptos]);

  const publicoGeneral = () => {
    setRfc(RFC_PUBLICO_GENERAL);
    setRazonSocial('PUBLICO EN GENERAL');
    setRegimenFiscal('616');
    setUsoCfdi('S01');
  };

  const setConcepto = (i: number, patch: Partial<ConceptoForm>) =>
    setConceptos((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const errorMsg =
    timbrar.error instanceof ApiError
      ? timbrar.error.status === 409
        ? 'Esta cita ya tiene una factura activa.'
        : timbrar.error.status === 429
          ? 'Demasiados intentos de timbrado — espera un minuto.'
          : timbrar.error.message
      : timbrar.error
        ? 'Error al timbrar'
        : null;

  return (
    <ModalShell title="Facturar consulta" onClose={timbrar.isPending ? () => {} : onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          timbrar.mutate({
            appointmentId,
            receptor: { rfc, razonSocial, regimenFiscal, codigoPostal, usoCfdi },
            conceptos,
          });
        }}
        className="flex flex-col gap-4"
      >
        {/* Receptor */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Datos fiscales del receptor</h3>
            <button
              type="button"
              onClick={publicoGeneral}
              className="text-xs font-medium text-brand-blue hover:underline"
            >
              Público en general
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="RFC">
              <input
                value={rfc}
                onChange={(e) => setRfc(e.target.value.toUpperCase())}
                required
                maxLength={13}
                placeholder="XAXX010101000"
                className={inputCls}
              />
            </Field>
            <Field label="Razón social">
              <input
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
                required
                className={inputCls}
              />
            </Field>
            <Field label="Régimen fiscal">
              <select
                value={regimenFiscal}
                onChange={(e) => setRegimenFiscal(e.target.value)}
                className={inputCls}
              >
                {REGIMENES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Código postal">
              <input
                value={codigoPostal}
                onChange={(e) => setCodigoPostal(e.target.value)}
                required
                maxLength={5}
                pattern="\d{5}"
                className={inputCls}
              />
            </Field>
            <Field label="Uso CFDI">
              <select
                value={usoCfdi}
                onChange={(e) => setUsoCfdi(e.target.value)}
                className={inputCls}
              >
                {USOS_CFDI.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        {/* Conceptos */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Conceptos</h3>
            <button
              type="button"
              onClick={() =>
                setConceptos((prev) => [
                  ...prev,
                  { ...CONCEPTO_CONSULTA, descripcion: '', valorUnitario: 0 },
                ])
              }
              className="text-xs font-medium text-brand-blue hover:underline"
            >
              + Agregar concepto
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {conceptos.map((c, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Descripción">
                    <input
                      value={c.descripcion}
                      onChange={(e) => setConcepto(i, { descripcion: e.target.value })}
                      required
                      className={inputCls}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Cantidad">
                      <input
                        type="number"
                        min={0.01}
                        step={0.01}
                        value={c.cantidad}
                        onChange={(e) => setConcepto(i, { cantidad: Number(e.target.value) })}
                        required
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Precio unitario">
                      <input
                        type="number"
                        min={0.01}
                        step={0.01}
                        value={c.valorUnitario}
                        onChange={(e) =>
                          setConcepto(i, { valorUnitario: Number(e.target.value) })
                        }
                        required
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <Field label="IVA">
                    <select
                      value={c.tratamientoIva}
                      onChange={(e) =>
                        setConcepto(i, { tratamientoIva: e.target.value as TratamientoIva })
                      }
                      className={inputCls}
                    >
                      {TRATAMIENTOS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="flex items-end justify-between pb-1">
                    <span className="text-sm text-slate-500">
                      Importe: <strong>{pesos(c.cantidad * c.valorUnitario)}</strong>
                    </span>
                    {conceptos.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setConceptos((prev) => prev.filter((_, j) => j !== i))}
                        className="text-xs text-slate-400 hover:text-red-600"
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Totales (visuales; el servidor recalcula) */}
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span>{pesos(totales.subtotal)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>IVA</span>
            <span>{pesos(totales.iva)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold">
            <span>Total</span>
            <span>{pesos(totales.total)}</span>
          </div>
        </div>

        {errorMsg && <p className="text-sm font-medium text-red-600">{errorMsg}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={timbrar.isPending}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-50"
          >
            Cerrar
          </button>
          <button
            type="submit"
            disabled={timbrar.isPending}
            className="rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
          >
            {timbrar.isPending ? 'Timbrando…' : 'Timbrar factura'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Modal de cancelación ────────────────────────────────────────

function CancelarModal({
  factura,
  token,
  onClose,
  onDone,
}: {
  factura: FacturaView;
  token: string;
  onClose: () => void;
  onDone: (f: FacturaView) => void;
}) {
  const [motivo, setMotivo] = useState<MotivoCancelacionSat>('02');

  const cancelar = useMutation({
    mutationFn: () => api.cancelarFactura(token, factura.id, { motivo }),
    onSuccess: onDone,
  });

  return (
    <ModalShell title="Cancelar factura" onClose={cancelar.isPending ? () => {} : onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-600">
          Vas a cancelar ante el SAT la factura con folio fiscal{' '}
          <span className="font-mono text-xs">{factura.uuidFiscal}</span> por{' '}
          <strong>{pesos(parseFloat(factura.total))}</strong>. Esta acción no se puede deshacer.
        </p>
        <Field label="Motivo de cancelación (obligatorio, catálogo SAT)">
          <select
            value={motivo}
            onChange={(e) => setMotivo(e.target.value as MotivoCancelacionSat)}
            className={inputCls}
          >
            {MOTIVOS_SAT.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        {cancelar.error && (
          <p className="text-sm font-medium text-red-600">
            {cancelar.error instanceof ApiError ? cancelar.error.message : 'Error al cancelar'}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={cancelar.isPending}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-50"
          >
            Volver
          </button>
          <button
            onClick={() => cancelar.mutate()}
            disabled={cancelar.isPending}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {cancelar.isPending ? 'Cancelando…' : 'Confirmar cancelación'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Piezas compartidas ──────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-blue';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
