'use client';

import { useState } from 'react';
import {
  BANDERAS_CLINICAS,
  ETIQUETAS_SEXO,
  SEVERIDADES_ALERGIA,
  SEXOS_PACIENTE,
  TIPOS_ALERGIA,
  type Alergia,
  type HistorialPaciente,
  type SeveridadAlergia,
  type SexoPaciente,
  type TipoAlergia,
} from '@healthflow/shared-types';

/**
 * Captura de alergias y antecedentes. Se guarda completo (no por campo): la
 * pantalla manda siempre el historial entero, que es lo que permite BORRAR una
 * alergia capturada por error.
 */
export function EditorHistorial({
  inicial,
  guardando,
  onGuardar,
  onCancelar,
}: {
  inicial: HistorialPaciente;
  guardando?: boolean;
  onGuardar: (h: HistorialPaciente) => void;
  onCancelar?: () => void;
}) {
  const [sexo, setSexo] = useState<SexoPaciente | ''>(inicial.sexo ?? '');
  const [sinAlergias, setSinAlergias] = useState(inicial.sinAlergiasConocidas);
  const [alergias, setAlergias] = useState<Alergia[]>(inicial.alergias);
  const [banderas, setBanderas] = useState<string[]>(inicial.antecedentes?.banderas ?? []);
  const [texto, setTexto] = useState({
    patologicos: inicial.antecedentes?.patologicos ?? '',
    quirurgicos: inicial.antecedentes?.quirurgicos ?? '',
    medicamentosActuales: inicial.antecedentes?.medicamentosActuales ?? '',
    familiares: inicial.antecedentes?.familiares ?? '',
  });

  const [nueva, setNueva] = useState<Alergia>({
    sustancia: '',
    tipo: 'medicamento',
    severidad: 'moderada',
  });

  const agregar = () => {
    if (!nueva.sustancia.trim()) return;
    setAlergias((as) => [...as, { ...nueva, sustancia: nueva.sustancia.trim() }]);
    setNueva({ sustancia: '', tipo: 'medicamento', severidad: 'moderada' });
    // Registrar una alergia contradice "sin alergias conocidas": se apaga solo
    // para que no queden los dos estados a la vez.
    setSinAlergias(false);
  };

  const guardar = () =>
    onGuardar({
      sinAlergiasConocidas: sinAlergias,
      alergias,
      antecedentes: { banderas, ...texto },
      // '' se manda como null, que el backend interpreta como "no lo estoy
      // editando" y conserva lo guardado. Aquí es lo mismo: la cadena vacía
      // solo aparece cuando el dato nunca se capturó.
      sexo: sexo || null,
    });

  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue';

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-1 font-semibold">Sexo</h3>
        <p className="mb-2 text-xs text-slate-500">
          Va impreso en la receta médica (art. 65 del Reglamento de Insumos para la Salud).
        </p>
        <select
          value={sexo}
          onChange={(e) => setSexo(e.target.value as SexoPaciente | '')}
          className={input}
        >
          <option value="">Sin capturar</option>
          {SEXOS_PACIENTE.map((s) => (
            <option key={s} value={s}>
              {ETIQUETAS_SEXO[s]}
            </option>
          ))}
        </select>
      </section>

      <section>
        <h3 className="mb-2 font-semibold">Alergias</h3>

        <div className="mb-3 flex flex-wrap gap-2">
          {alergias.map((a, i) => (
            <span
              key={`${a.sustancia}-${i}`}
              className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-2.5 py-1 text-sm text-red-900"
            >
              <strong>{a.sustancia}</strong>
              <span className="text-xs text-red-700">
                {a.tipo} · {a.severidad}
              </span>
              <button
                onClick={() => setAlergias((as) => as.filter((_, j) => j !== i))}
                className="text-red-500 hover:text-red-800"
                aria-label={`Quitar ${a.sustancia}`}
              >
                ✕
              </button>
            </span>
          ))}
          {alergias.length === 0 && <span className="text-sm text-slate-400">Ninguna registrada.</span>}
        </div>

        <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
          <input
            value={nueva.sustancia}
            onChange={(e) => setNueva((n) => ({ ...n, sustancia: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && agregar()}
            placeholder="Sustancia (penicilina, lidocaína, látex…)"
            className={input}
          />
          <select
            value={nueva.tipo}
            onChange={(e) => setNueva((n) => ({ ...n, tipo: e.target.value as TipoAlergia }))}
            className={input}
          >
            {TIPOS_ALERGIA.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={nueva.severidad}
            onChange={(e) =>
              setNueva((n) => ({ ...n, severidad: e.target.value as SeveridadAlergia }))
            }
            className={input}
          >
            {SEVERIDADES_ALERGIA.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            onClick={agregar}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Agregar
          </button>
        </div>

        {/* Declaración explícita. Sin esto, "no hay alergias registradas" y
            "no tiene alergias" se ven igual en pantalla y son cosas distintas. */}
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={sinAlergias}
            disabled={alergias.length > 0}
            onChange={(e) => setSinAlergias(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Se preguntó y el paciente no refiere alergias conocidas
            {alergias.length > 0 && (
              <span className="block text-xs text-slate-500">
                No aplica: ya hay alergias registradas arriba.
              </span>
            )}
          </span>
        </label>
      </section>

      <section>
        <h3 className="mb-1 font-semibold">Antecedentes de riesgo</h3>
        <p className="mb-2 text-xs text-slate-500">
          Marca lo que aplique. Cada uno se le recuerda al médico durante la consulta, junto con la
          conducta que exige.
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {BANDERAS_CLINICAS.map((b) => (
            <label key={b.key} className="flex items-start gap-2 rounded-lg p-1.5 text-sm hover:bg-slate-50">
              <input
                type="checkbox"
                checked={banderas.includes(b.key)}
                onChange={(e) =>
                  setBanderas((bs) =>
                    e.target.checked ? [...bs, b.key] : bs.filter((k) => k !== b.key),
                  )
                }
                className="mt-0.5"
              />
              <span>
                {b.label}
                {b.critica && <span className="ml-1 text-xs font-semibold text-red-600">crítico</span>}
                <span className="block text-xs text-slate-500">{b.conducta}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ['patologicos', 'Antecedentes patológicos'],
            ['quirurgicos', 'Antecedentes quirúrgicos'],
            ['medicamentosActuales', 'Medicamentos actuales'],
            ['familiares', 'Antecedentes familiares'],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
            <textarea
              value={texto[key]}
              onChange={(e) => setTexto((t) => ({ ...t, [key]: e.target.value }))}
              rows={2}
              className={input}
            />
          </div>
        ))}
      </section>

      <div className="flex gap-2">
        <button
          onClick={guardar}
          disabled={guardando}
          className="rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {guardando ? 'Guardando…' : 'Guardar historial'}
        </button>
        {onCancelar && (
          <button onClick={onCancelar} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}
