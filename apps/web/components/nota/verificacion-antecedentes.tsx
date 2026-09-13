'use client';

import type {
  ErrorCierre,
  EstadoVerificacionAntecedentes,
  NotaEvolucionContent,
  ReferenciaAntecedentes,
} from '@healthflow/shared-types';

const OPCIONES: { estado: EstadoVerificacionAntecedentes; label: string; detalle: string }[] = [
  {
    estado: 'verificados_sin_cambios',
    label: 'Verificados sin cambios',
    detalle: 'Se revisaron con el paciente y siguen vigentes.',
  },
  {
    estado: 'actualizados',
    label: 'Actualizados en esta consulta',
    detalle: 'Escribe abajo lo que cambió; queda en esta nota.',
  },
  {
    estado: 'no_fue_posible_verificar',
    label: 'No fue posible verificar',
    detalle: 'Indica por qué.',
  },
];

const CAMPOS = [
  ['antecedentesHeredofamiliares', 'Heredofamiliares'],
  ['antecedentesPersonalesPatologicos', 'Personales patológicos'],
  ['antecedentesPersonalesNoPatologicos', 'Personales no patológicos'],
] as const;

/**
 * Primera valoración de especialidad: el paciente ya tiene historia general
 * firmada, así que los antecedentes se muestran como REFERENCIA, no como
 * captura nueva, y el profesional declara qué hizo con ellos.
 */
export function VerificacionAntecedentes({
  content,
  referencia,
  setContent,
  readOnly,
  errores,
  resaltar,
}: {
  content: NotaEvolucionContent;
  referencia: ReferenciaAntecedentes | null;
  setContent: (actualizar: (c: NotaEvolucionContent) => NotaEvolucionContent) => void;
  readOnly: boolean;
  errores: ErrorCierre[];
  resaltar: boolean;
}) {
  const v = content.verificacionAntecedentes;
  const faltaMotivo = errores.some((e) => e.codigo === 'MOTIVO_REQUERIDO');
  const faltaActualizacion = errores.some((e) => e.ruta === 'verificacionAntecedentes.actualizacion');

  const elegir = (estado: EstadoVerificacionAntecedentes) =>
    setContent((c) => ({
      ...c,
      // Sin precargar la referencia en "actualizados": si se copiara, la nota
      // parecería actualizada sin que nadie escribiera nada. Lo vigente sigue
      // visible arriba; abajo va sólo lo que cambió.
      verificacionAntecedentes: {
        estado,
        ...(estado === 'no_fue_posible_verificar' ? { motivo: c.verificacionAntecedentes?.motivo } : {}),
      },
    }));

  return (
    <div className="space-y-4" data-testid="verificacion-antecedentes">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Antecedentes vigentes (referencia)
        </p>
        {referencia ? (
          <>
            <dl className="space-y-2">
              {CAMPOS.map(([k, label]) => (
                <div key={k}>
                  <dt className="text-xs font-medium text-slate-500">{label}</dt>
                  <dd className="text-slate-700">{textoPlano(referencia[k]) || '—'}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-slate-400">
              Firmados el {new Date(referencia.cerradoEn).toLocaleDateString('es-MX')}
            </p>
          </>
        ) : (
          <p className="text-slate-500">No se encontraron antecedentes firmados.</p>
        )}
      </div>

      <fieldset
        className={`space-y-2 rounded-lg p-1 ${resaltar && errores.some((e) => e.codigo === 'CAMPO_REQUERIDO' && e.ruta === 'verificacionAntecedentes') ? 'ring-1 ring-red-300' : ''}`}
      >
        <legend className="mb-1 text-xs font-medium text-slate-500">
          ¿Qué hiciste con estos antecedentes? <span className="text-red-500">*</span>
        </legend>
        {OPCIONES.map((o) => (
          <label key={o.estado} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="verificacion-antecedentes"
              checked={v?.estado === o.estado}
              disabled={readOnly}
              onChange={() => elegir(o.estado)}
              className="mt-1"
            />
            <span>
              {o.label}
              <span className="block text-xs text-slate-500">{o.detalle}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {v?.estado === 'no_fue_posible_verificar' && (
        <input
          aria-label="Motivo de no verificación"
          value={v.motivo ?? ''}
          disabled={readOnly}
          maxLength={500}
          onChange={(e) =>
            setContent((c) => ({
              ...c,
              verificacionAntecedentes: { estado: 'no_fue_posible_verificar', motivo: e.target.value || undefined },
            }))
          }
          placeholder="Motivo (obligatorio): paciente no acompañado, urgencia…"
          className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand-blue disabled:bg-slate-50 ${
            resaltar && faltaMotivo ? 'border-red-300' : 'border-slate-300'
          }`}
        />
      )}

      {v?.estado === 'actualizados' && (
        <div className={`space-y-3 ${resaltar && faltaActualizacion ? 'rounded-lg ring-1 ring-red-300' : ''}`}>
          {CAMPOS.map(([k, label]) => (
            <label key={k} className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
              <textarea
                value={content[k] ?? ''}
                onChange={(e) => setContent((c) => ({ ...c, [k]: e.target.value }))}
                disabled={readOnly}
                rows={2}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue disabled:bg-slate-50"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Los antecedentes pueden venir como HTML de notas anteriores; aquí se leen como texto. */
function textoPlano(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
