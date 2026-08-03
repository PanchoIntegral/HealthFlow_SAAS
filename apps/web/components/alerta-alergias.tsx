'use client';

import { banderaPorKey, type HistorialPaciente } from '@healthflow/shared-types';

/**
 * Aviso de alergias y antecedentes de riesgo. Se pinta ARRIBA de todo en la
 * consulta, antes de que el médico empiece a escribir: de nada sirve el dato si
 * hay que ir a buscarlo a otra pantalla justo cuando ya se infiltró el
 * anestésico.
 *
 * Tres estados distintos a propósito, porque significan cosas distintas:
 *  - rojo   → hay alergias o antecedentes críticos
 *  - verde  → alguien preguntó y declaró que no hay alergias conocidas
 *  - ámbar  → NADIE ha preguntado. No es lo mismo que "no tiene".
 */
export function AlertaAlergias({
  historial,
  onCapturar,
}: {
  historial: HistorialPaciente;
  onCapturar?: () => void;
}) {
  const { sinAlergiasConocidas, alergias, antecedentes } = historial;
  const banderas = (antecedentes?.banderas ?? [])
    .map(banderaPorKey)
    .filter((b): b is NonNullable<typeof b> => !!b);

  const hayRiesgo = alergias.length > 0 || banderas.length > 0;

  // Sin información: el estado más peligroso, porque se confunde con "no tiene".
  if (!hayRiesgo && !sinAlergiasConocidas) {
    return (
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
        <p className="text-sm text-amber-900">
          <strong>Sin información de alergias.</strong> No se ha preguntado — no es lo mismo que no
          tener.
        </p>
        {onCapturar && (
          <button
            onClick={onCapturar}
            className="shrink-0 rounded-lg border border-amber-400 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
          >
            Capturar
          </button>
        )}
      </div>
    );
  }

  if (!hayRiesgo) {
    return (
      <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
        ✓ Sin alergias conocidas ni antecedentes de riesgo registrados.
      </div>
    );
  }

  const hayCriticos = alergias.some((a) => a.severidad === 'grave') || banderas.some((b) => b.critica);

  return (
    <div
      className={`mb-4 rounded-xl border px-4 py-3 ${
        hayCriticos ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className={`text-sm font-semibold ${hayCriticos ? 'text-red-900' : 'text-amber-900'}`}>
          ⚠ Revisar antes de tratar
        </p>
        {onCapturar && (
          <button
            onClick={onCapturar}
            className="shrink-0 text-xs font-medium text-slate-600 underline hover:text-slate-900"
          >
            Editar
          </button>
        )}
      </div>

      {alergias.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {alergias.map((a, i) => (
            <span
              key={`${a.sustancia}-${i}`}
              className={`rounded-lg px-2 py-1 text-xs font-medium ${
                a.severidad === 'grave'
                  ? 'bg-red-600 text-white'
                  : a.severidad === 'moderada'
                    ? 'bg-red-100 text-red-900'
                    : 'bg-slate-200 text-slate-700'
              }`}
              title={a.notas}
            >
              Alergia: {a.sustancia}
              {a.severidad === 'grave' && ' · GRAVE'}
            </span>
          ))}
        </div>
      )}

      {/* La conducta, no solo la etiqueta: saber que toma bifosfonatos no
          sirve si no recuerdas que contraindica la extracción. */}
      <ul className="space-y-1">
        {banderas.map((b) => (
          <li key={b.key} className="text-xs text-slate-700">
            <strong className={b.critica ? 'text-red-800' : 'text-amber-900'}>{b.label}.</strong>{' '}
            {b.conducta}
          </li>
        ))}
      </ul>
    </div>
  );
}
