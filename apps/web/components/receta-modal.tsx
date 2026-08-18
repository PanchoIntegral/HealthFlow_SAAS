'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ETIQUETAS_SEXO,
  SEXOS_PACIENTE,
  VIAS_ADMINISTRACION,
  type DiagnosticoCie10,
  type HistorialPaciente,
  type MedicamentoRecetado,
  type SexoPaciente,
} from '@healthflow/shared-types';
import { api, ApiError } from '../lib/api';
import { Modal } from './modal';
import { AlertaAlergias } from './alerta-alergias';
import { MedicamentoPicker } from './medicamento-picker';
import { IconBan, IconPill } from './icons';

const CAMPO =
  'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-blue';

/**
 * Emisión de una receta. Se abre desde la consulta (con la cita y los
 * diagnósticos ya capturados) y también desde el expediente, sin cita — igual
 * que una orden de plantillas, la receta tiene ciclo de vida propio y a veces
 * hay que emitirla después de que la consulta se cerró.
 */
export function RecetaModal({
  token,
  patientId,
  pacienteNombre,
  appointmentId,
  historial,
  diagnosticosIniciales = [],
  onClose,
}: {
  token: string;
  patientId: string;
  pacienteNombre?: string;
  appointmentId?: string;
  /** Para la alerta de alergias y para saber si falta capturar el sexo. */
  historial?: HistorialPaciente;
  /** Precargados de la nota: el médico no debe teclear el diagnóstico dos veces. */
  diagnosticosIniciales?: DiagnosticoCie10[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [medicamentos, setMedicamentos] = useState<MedicamentoRecetado[]>([]);
  const [indicaciones, setIndicaciones] = useState('');
  const [sexo, setSexo] = useState<SexoPaciente | ''>(historial?.sexo ?? '');

  // El sexo es obligatorio en la receta (RIS art. 65) y puede no estar
  // capturado en pacientes anteriores a la migración 0026. Se pide AQUÍ, en el
  // momento en que hace falta, en vez de mandar al médico al expediente.
  const faltaSexo = historial != null && historial.sexo == null;

  const emitir = useMutation({
    mutationFn: async () => {
      if (faltaSexo && sexo) {
        // El backend conserva alergias y antecedentes si no cambian; se
        // reenvían tal cual porque el PATCH los reemplaza completos.
        await api.updateHistorial(token, patientId, {
          sinAlergiasConocidas: historial.sinAlergiasConocidas,
          alergias: historial.alergias,
          antecedentes: historial.antecedentes,
          sexo,
        });
      }
      return api.emitirReceta(token, {
        patientId,
        appointmentId,
        diagnosticos: diagnosticosIniciales,
        medicamentos,
        indicacionesGenerales: indicaciones.trim() || undefined,
      });
    },
    onSuccess: (receta) => {
      qc.invalidateQueries({ queryKey: ['recetas', patientId] });
      qc.invalidateQueries({ queryKey: ['clinical-record', patientId] });
      window.open(`/recetas/${receta.id}`, '_blank');
      onClose();
    },
  });

  const actualizar = (i: number, campo: keyof MedicamentoRecetado, valor: string) =>
    setMedicamentos((ms) => ms.map((m, j) => (j === i ? { ...m, [campo]: valor } : m)));

  const quitar = (i: number) => setMedicamentos((ms) => ms.filter((_, j) => j !== i));

  const error = emitir.error instanceof ApiError ? emitir.error : null;
  const cuerpo = (error?.body ?? {}) as { error?: string; campos?: string[] };
  const controlado = cuerpo.error === 'MedicamentoControladoNoEmisible';
  const camposFaltantes = cuerpo.error === 'RecetaIncompleta' ? (cuerpo.campos ?? []) : [];

  const falta = (i: number, campo: string) =>
    camposFaltantes.includes(`medicamentos[${i}].${campo}`);
  const claseCampo = (i: number, campo: string) =>
    falta(i, campo) ? `${CAMPO} border-red-400 bg-red-50` : CAMPO;

  const puedeEmitir =
    medicamentos.length > 0 && (!faltaSexo || sexo !== '') && !emitir.isPending;

  return (
    <Modal titulo="Nueva receta" subtitulo={pacienteNombre} onClose={onClose} ancho="max-w-3xl">
      {historial && <AlertaAlergias historial={historial} />}

      {faltaSexo && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">Falta el sexo del paciente</p>
          <p className="mb-2 mt-0.5 text-xs text-amber-800">
            El artículo 65 del Reglamento de Insumos para la Salud lo exige en la receta. Se guarda
            en el expediente al emitir.
          </p>
          <select
            value={sexo}
            onChange={(e) => setSexo(e.target.value as SexoPaciente)}
            className={CAMPO}
          >
            <option value="">Selecciona…</option>
            {SEXOS_PACIENTE.map((s) => (
              <option key={s} value={s}>
                {ETIQUETAS_SEXO[s]}
              </option>
            ))}
          </select>
        </div>
      )}

      {diagnosticosIniciales.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">Diagnósticos</h3>
          <div className="flex flex-wrap gap-1.5">
            {diagnosticosIniciales.map((d) => (
              <span
                key={d.cie10}
                className="rounded bg-brand-blue/10 px-2 py-0.5 text-xs text-brand-blue"
              >
                {d.cie10} — {d.descripcion}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="mb-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Medicamentos</h3>

        {medicamentos.length === 0 && (
          <p className="mb-2 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-400">
            Busca un medicamento para agregarlo a la receta.
          </p>
        )}

        <ul className="mb-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {medicamentos.map((m, i) => (
            <li key={`${m.clave ?? 'libre'}-${i}`} className="p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{m.denominacionGenerica}</p>
                  {m.clave === null && (
                    <p className="text-xs text-amber-700">Fuera de catálogo</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => quitar(i)}
                  className="text-xs font-medium text-slate-400 hover:text-red-600"
                >
                  Quitar
                </button>
              </div>

              {/* Los siete datos del RIS art. 29, uno por campo: es lo que
                  permite decirle al médico cuál le falta. */}
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={m.presentacion}
                  onChange={(e) => actualizar(i, 'presentacion', e.target.value)}
                  placeholder="Presentación (tabletas de 500 mg)"
                  className={claseCampo(i, 'presentacion')}
                />
                <input
                  value={m.dosis}
                  onChange={(e) => actualizar(i, 'dosis', e.target.value)}
                  placeholder="Dosis (1 tableta)"
                  className={claseCampo(i, 'dosis')}
                />
                <select
                  value={m.via}
                  onChange={(e) => actualizar(i, 'via', e.target.value)}
                  className={claseCampo(i, 'via')}
                >
                  <option value="">Vía de administración…</option>
                  {VIAS_ADMINISTRACION.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <input
                  value={m.frecuencia}
                  onChange={(e) => actualizar(i, 'frecuencia', e.target.value)}
                  placeholder="Frecuencia (cada 8 horas)"
                  className={claseCampo(i, 'frecuencia')}
                />
                <input
                  value={m.duracion}
                  onChange={(e) => actualizar(i, 'duracion', e.target.value)}
                  placeholder="Duración (por 7 días)"
                  className={claseCampo(i, 'duracion')}
                />
                <input
                  value={m.denominacionDistintiva ?? ''}
                  onChange={(e) => actualizar(i, 'denominacionDistintiva', e.target.value)}
                  placeholder="Marca comercial (opcional)"
                  className={CAMPO}
                />
                <input
                  value={m.indicaciones ?? ''}
                  onChange={(e) => actualizar(i, 'indicaciones', e.target.value)}
                  placeholder="Indicaciones para este medicamento (opcional)"
                  className={`${CAMPO} sm:col-span-2`}
                />
              </div>
            </li>
          ))}
        </ul>

        <MedicamentoPicker
          token={token}
          onElegir={(m) => setMedicamentos((ms) => [...ms, m])}
        />
      </section>

      <section className="mb-4">
        <h3 className="mb-1 text-sm font-semibold text-slate-700">Indicaciones generales</h3>
        <textarea
          value={indicaciones}
          onChange={(e) => setIndicaciones(e.target.value)}
          rows={3}
          placeholder="Reposo, abundantes líquidos, acudir a urgencias si…"
          className={CAMPO}
        />
      </section>

      {controlado && (
        <div className="mb-4 flex gap-2 rounded-xl border border-red-300 bg-red-50 p-3">
          <IconBan size={18} />
          <div>
            <p className="text-sm font-semibold text-red-900">No se puede emitir esta receta</p>
            <p className="mt-1 text-sm leading-relaxed text-red-800">{error?.message}</p>
          </div>
        </div>
      )}

      {camposFaltantes.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">Faltan datos que exige la ley</p>
          {/* Los del emisor no se arreglan en este modal: se capturan en
              Ajustes, así que se dicen aparte y con su nombre. */}
          {camposFaltantes.some((c) => c.startsWith('emisor.')) && (
            <p className="mt-1 text-sm text-amber-800">
              Tu perfil está incompleto. Captura en Ajustes: {' '}
              {camposFaltantes
                .filter((c) => c.startsWith('emisor.'))
                .map((c) => ETIQUETAS_EMISOR[c] ?? c)
                .join(', ')}
              .
            </p>
          )}
          {camposFaltantes.some((c) => c.startsWith('medicamentos')) && (
            <p className="mt-1 text-sm text-amber-800">
              Completa los campos marcados en rojo.
            </p>
          )}
        </div>
      )}

      {error && !controlado && camposFaltantes.length === 0 && (
        <p className="mb-4 text-sm text-red-700">{error.message}</p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:border-slate-400"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={!puedeEmitir}
          onClick={() => emitir.mutate()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          <IconPill size={16} />
          {emitir.isPending ? 'Emitiendo…' : 'Emitir receta'}
        </button>
      </div>
    </Modal>
  );
}

/** Nombres legibles de los campos del emisor que exige el RIS art. 64. */
const ETIQUETAS_EMISOR: Record<string, string> = {
  'emisor.cedulaProfesional': 'tu cédula profesional',
  'emisor.institucionTitulo': 'la institución que expidió tu título',
  'emisor.domicilioEstablecimiento': 'el domicilio de la clínica',
  'emisor.medicoNombre': 'tu nombre',
};
