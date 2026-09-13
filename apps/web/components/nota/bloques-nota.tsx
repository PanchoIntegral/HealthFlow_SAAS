'use client';

import type {
  BloqueClinico,
  BloquesNota,
  CampoEsquema,
  DiagnosticoPes,
  ErrorCierre,
  EstudioRegistrado,
  MedicamentoConciliado,
  ProblemaClinico,
  RegistroRiesgoCv,
} from '@healthflow/shared-types';
import {
  ADHERENCIAS,
  CAMBIOS_MEDICAMENTO,
  ESTADOS_PROBLEMA,
  TIPOS_ESTUDIO,
} from '@healthflow/shared-types';

/**
 * Editores de los bloques estructurados de la nota. Qué bloques aparecen y si
 * son obligatorios lo dice el esquema de la API; aquí sólo se captura. Los
 * errores llegan ya calculados y se muestran junto al elemento al que apuntan.
 */

type Actualizar = (actualizar: (b: BloquesNota) => BloquesNota) => void;

const input =
  'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-blue disabled:bg-slate-50';

function nuevoId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function BloqueNota({
  def,
  campo,
  bloques,
  onChange,
  readOnly,
  errores,
}: {
  def: BloqueClinico;
  campo: CampoEsquema;
  bloques: BloquesNota;
  onChange: Actualizar;
  readOnly: boolean;
  errores: ErrorCierre[];
}) {
  const props = { bloques, onChange, readOnly, errores };
  return (
    <div data-testid={`bloque-${def.bloque}`}>
      {def.ayuda && <p className="mb-2 text-xs text-slate-500">{def.ayuda}</p>}
      {def.bloque === 'problemas' && <Problemas {...props} />}
      {def.bloque === 'medicamentos' && <Medicamentos {...props} />}
      {def.bloque === 'estudios' && <Estudios {...props} />}
      {def.bloque === 'seguimiento' && <Seguimiento {...props} />}
      {def.bloque === 'riesgoCv' && <RiesgoCv {...props} />}
      {def.bloque === 'pes' && <Pes {...props} />}
      {def.bloque === 'alergiasVerificadasEn' && <AlergiasVerificadas {...props} />}
      {campo.reglaId && campo.requisito === 'requerido' && (
        <p className="mt-2 text-xs text-amber-700">Se pide por el contexto de esta consulta.</p>
      )}
    </div>
  );
}

interface PropsBloque {
  bloques: BloquesNota;
  onChange: Actualizar;
  readOnly: boolean;
  errores: ErrorCierre[];
}

/** Lista con declaración explícita ("sin problemas activos") como alternativa a los elementos. */
function Declaracion<D extends string>({
  opciones,
  valor,
  motivo,
  onChange,
  readOnly,
}: {
  opciones: { valor: D; label: string }[];
  valor: D | undefined;
  motivo: string | undefined;
  onChange: (d: D | undefined, motivo: string | undefined) => void;
  readOnly: boolean;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <select
        aria-label="Declaración"
        value={valor ?? ''}
        disabled={readOnly}
        onChange={(e) => onChange((e.target.value || undefined) as D | undefined, motivo)}
        className="rounded-lg border border-slate-300 px-2 py-1.5"
      >
        <option value="">Sin declaración</option>
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.label}
          </option>
        ))}
      </select>
      {valor && (
        <input
          aria-label="Motivo de la declaración"
          value={motivo ?? ''}
          disabled={readOnly}
          maxLength={500}
          onChange={(e) => onChange(valor, e.target.value || undefined)}
          placeholder="Motivo"
          className="min-w-[200px] flex-1 rounded-lg border border-slate-300 px-2 py-1.5"
        />
      )}
    </div>
  );
}

function Lista<T>({
  items,
  render,
  onAdd,
  onRemove,
  readOnly,
  etiquetaAgregar,
}: {
  items: T[];
  render: (item: T, i: number) => React.ReactNode;
  onAdd: () => void;
  onRemove: (i: number) => void;
  readOnly: boolean;
  etiquetaAgregar: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={(item as { id?: string }).id ?? i} className="relative rounded-lg border border-slate-200 p-2 pr-8">
          {render(item, i)}
          {!readOnly && (
            <button
              type="button"
              aria-label="Quitar"
              onClick={() => onRemove(i)}
              className="absolute right-2 top-2 text-slate-400 hover:text-red-600"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button
          type="button"
          onClick={onAdd}
          className="rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-brand-blue hover:text-brand-blue"
        >
          + {etiquetaAgregar}
        </button>
      )}
    </div>
  );
}

function Problemas({ bloques, onChange, readOnly }: PropsBloque) {
  const lista = bloques.problemas ?? { items: [] };
  const set = (items: ProblemaClinico[]) => onChange((b) => ({ ...b, problemas: { ...lista, items } }));
  const campo = (i: number, k: keyof ProblemaClinico, v: string) =>
    set(lista.items.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  return (
    <>
      <Lista
        items={lista.items}
        readOnly={readOnly}
        etiquetaAgregar="Agregar problema"
        onAdd={() => set([...lista.items, { id: nuevoId(), descripcion: '', estado: 'activo' }])}
        onRemove={(i) => set(lista.items.filter((_, j) => j !== i))}
        render={(p, i) => (
          <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
            <input aria-label="Problema" className={input} value={p.descripcion} disabled={readOnly} onChange={(e) => campo(i, 'descripcion', e.target.value)} placeholder="Problema" />
            <select aria-label="Estado del problema" className={input} value={p.estado} disabled={readOnly} onChange={(e) => campo(i, 'estado', e.target.value)}>
              {ESTADOS_PROBLEMA.map((e) => <option key={e} value={e}>{e.replace('_', ' ')}</option>)}
            </select>
            <input aria-label="Evidencia" className={input} value={p.evidencia ?? ''} disabled={readOnly} onChange={(e) => campo(i, 'evidencia', e.target.value)} placeholder="Evidencia" />
            <input aria-label="Objetivo" className={input} value={p.objetivo ?? ''} disabled={readOnly} onChange={(e) => campo(i, 'objetivo', e.target.value)} placeholder="Objetivo" />
            <input aria-label="Plan del problema" className={`${input} sm:col-span-2`} value={p.plan ?? ''} disabled={readOnly} onChange={(e) => campo(i, 'plan', e.target.value)} placeholder="Plan" />
          </div>
        )}
      />
      <Declaracion
        opciones={[{ valor: 'sin_problemas_activos' as const, label: 'Sin problemas activos' }]}
        valor={lista.declaracion}
        motivo={lista.motivo}
        readOnly={readOnly}
        onChange={(declaracion, motivo) => onChange((b) => ({ ...b, problemas: { ...lista, declaracion, motivo } }))}
      />
    </>
  );
}

function Medicamentos({ bloques, onChange, readOnly, errores }: PropsBloque) {
  const lista = bloques.medicamentos ?? { items: [] };
  const set = (items: MedicamentoConciliado[]) => onChange((b) => ({ ...b, medicamentos: { ...lista, items } }));
  const campo = (i: number, k: keyof MedicamentoConciliado, v: string) =>
    set(lista.items.map((m, j) => (j === i ? { ...m, [k]: v || undefined } : m)));
  return (
    <>
      <Lista
        items={lista.items}
        readOnly={readOnly}
        etiquetaAgregar="Agregar medicamento"
        onAdd={() => set([...lista.items, { id: nuevoId(), nombre: '', cambio: 'sin_cambio' }])}
        onRemove={(i) => set(lista.items.filter((_, j) => j !== i))}
        render={(m, i) => {
          const faltaRazon = errores.some((e) => e.ruta === `bloques.medicamentos.${i}.razonCambio`);
          return (
            <div className="grid gap-2 sm:grid-cols-3">
              <input aria-label="Medicamento" className={`${input} sm:col-span-3`} value={m.nombre} disabled={readOnly} onChange={(e) => set(lista.items.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} placeholder="Medicamento" />
              <input aria-label="Dosis" className={input} value={m.dosis ?? ''} disabled={readOnly} onChange={(e) => campo(i, 'dosis', e.target.value)} placeholder="Dosis" />
              <input aria-label="Vía" className={input} value={m.via ?? ''} disabled={readOnly} onChange={(e) => campo(i, 'via', e.target.value)} placeholder="Vía" />
              <input aria-label="Frecuencia" className={input} value={m.frecuencia ?? ''} disabled={readOnly} onChange={(e) => campo(i, 'frecuencia', e.target.value)} placeholder="Frecuencia" />
              <select aria-label="Adherencia" className={input} value={m.adherencia ?? ''} disabled={readOnly} onChange={(e) => campo(i, 'adherencia', e.target.value)}>
                <option value="">Adherencia…</option>
                {ADHERENCIAS.map((a) => <option key={a} value={a}>{a.replace('_', ' ')}</option>)}
              </select>
              <select aria-label="Cambio" className={input} value={m.cambio} disabled={readOnly} onChange={(e) => set(lista.items.map((x, j) => (j === i ? { ...x, cambio: e.target.value as MedicamentoConciliado['cambio'] } : x)))}>
                {CAMBIOS_MEDICAMENTO.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </select>
              {m.cambio !== 'sin_cambio' && (
                <input aria-label="Razón del cambio" className={`${input} ${faltaRazon ? 'border-red-300' : ''}`} value={m.razonCambio ?? ''} disabled={readOnly} onChange={(e) => campo(i, 'razonCambio', e.target.value)} placeholder="Razón del cambio" />
              )}
            </div>
          );
        }}
      />
      <Declaracion
        opciones={[
          { valor: 'sin_medicamentos' as const, label: 'Sin medicamentos' },
          { valor: 'no_fue_posible_conciliar' as const, label: 'No fue posible conciliar' },
        ]}
        valor={lista.declaracion}
        motivo={lista.motivo}
        readOnly={readOnly}
        onChange={(declaracion, motivo) => onChange((b) => ({ ...b, medicamentos: { ...lista, declaracion, motivo } }))}
      />
    </>
  );
}

function Estudios({ bloques, onChange, readOnly }: PropsBloque) {
  const lista = bloques.estudios ?? { items: [] };
  const set = (items: EstudioRegistrado[]) => onChange((b) => ({ ...b, estudios: { ...lista, items } }));
  const campo = (i: number, k: keyof EstudioRegistrado, v: string | number | boolean | undefined) =>
    set(lista.items.map((x, j) => (j === i ? { ...x, [k]: v === '' ? undefined : v } : x)));
  return (
    <Lista
      items={lista.items}
      readOnly={readOnly}
      etiquetaAgregar="Agregar estudio"
      onAdd={() => set([...lista.items, { id: nuevoId(), tipo: 'laboratorio', nombre: '' }])}
      onRemove={(i) => set(lista.items.filter((_, j) => j !== i))}
      render={(e, i) => (
        <div className="grid gap-2 sm:grid-cols-3">
          <select aria-label="Tipo de estudio" className={input} value={e.tipo} disabled={readOnly} onChange={(ev) => campo(i, 'tipo', ev.target.value)}>
            {TIPOS_ESTUDIO.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
          <input aria-label="Estudio" className={input} value={e.nombre} disabled={readOnly} onChange={(ev) => set(lista.items.map((x, j) => (j === i ? { ...x, nombre: ev.target.value } : x)))} placeholder="Estudio" />
          <input aria-label="Fecha del estudio" type="date" className={input} value={e.fecha ?? ''} disabled={readOnly} onChange={(ev) => campo(i, 'fecha', ev.target.value)} />
          <input aria-label="Resultado" className={input} value={e.resultado ?? ''} disabled={readOnly} onChange={(ev) => campo(i, 'resultado', ev.target.value)} placeholder="Resultado" />
          <input aria-label="Unidad" className={input} value={e.unidad ?? ''} disabled={readOnly} onChange={(ev) => campo(i, 'unidad', ev.target.value)} placeholder="Unidad" />
          <input aria-label="Fuente" className={input} value={e.fuente ?? ''} disabled={readOnly} onChange={(ev) => campo(i, 'fuente', ev.target.value)} placeholder="Fuente" />
          <input aria-label="Interpretación" className={`${input} sm:col-span-2`} value={e.interpretacion ?? ''} disabled={readOnly} onChange={(ev) => campo(i, 'interpretacion', ev.target.value)} placeholder="Interpretación" />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={e.solicitado === true} disabled={readOnly} onChange={(ev) => campo(i, 'solicitado', ev.target.checked || undefined)} />
            Solicitado en esta consulta
          </label>
        </div>
      )}
    />
  );
}

function Seguimiento({ bloques, onChange, readOnly }: PropsBloque) {
  const s = bloques.seguimiento ?? {};
  const set = (cambio: Partial<NonNullable<BloquesNota['seguimiento']>>) =>
    onChange((b) => ({ ...b, seguimiento: { ...s, ...cambio } }));
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <input aria-label="Plazo" className={input} value={s.plazo ?? ''} disabled={readOnly} onChange={(e) => set({ plazo: e.target.value || undefined })} placeholder="Plazo (2 semanas, al tener resultados…)" />
      <input aria-label="Fecha de seguimiento" type="date" className={input} value={s.fecha ?? ''} disabled={readOnly} onChange={(e) => set({ fecha: e.target.value || undefined })} />
      <input aria-label="Signos de alarma" className={`${input} sm:col-span-2`} value={s.signosAlarma ?? ''} disabled={readOnly} onChange={(e) => set({ signosAlarma: e.target.value || undefined })} placeholder="Signos de alarma" />
      <input aria-label="Referencia" className={`${input} sm:col-span-2`} value={s.referencia ?? ''} disabled={readOnly} onChange={(e) => set({ referencia: e.target.value || undefined })} placeholder="Referencia o interconsulta" />
      <div className="sm:col-span-2">
        <Declaracion
          opciones={[{ valor: 'seguimiento_no_requerido' as const, label: 'Seguimiento no requerido' }]}
          valor={s.declaracion}
          motivo={s.motivo}
          readOnly={readOnly}
          onChange={(declaracion, motivo) => set({ declaracion, motivo })}
        />
      </div>
    </div>
  );
}

/** Sólo registro: HealthFlow no calcula riesgo (ver RegistroRiesgoCv en shared-types). */
function RiesgoCv({ bloques, onChange, readOnly }: PropsBloque) {
  const items = bloques.riesgoCv ?? [];
  const set = (nuevos: RegistroRiesgoCv[]) => onChange((b) => ({ ...b, riesgoCv: nuevos }));
  const campo = (i: number, cambio: Partial<RegistroRiesgoCv>) =>
    set(items.map((r, j) => (j === i ? { ...r, ...cambio } : r)));
  return (
    <>
      <p className="mb-2 text-xs text-slate-500">
        Registra el resultado que obtuviste con la herramienta de tu elección. HealthFlow no lo calcula.
      </p>
      <Lista
        items={items}
        readOnly={readOnly}
        etiquetaAgregar="Registrar riesgo"
        onAdd={() => set([...items, { algoritmo: '', version: '', fecha: new Date().toISOString().slice(0, 10), entradas: [], resultado: '', unidad: '' }])}
        onRemove={(i) => set(items.filter((_, j) => j !== i))}
        render={(r, i) => (
          <div className="grid gap-2 sm:grid-cols-3">
            <input aria-label="Algoritmo" className={input} value={r.algoritmo} disabled={readOnly} onChange={(e) => campo(i, { algoritmo: e.target.value })} placeholder="Algoritmo" />
            <input aria-label="Versión" className={input} value={r.version} disabled={readOnly} onChange={(e) => campo(i, { version: e.target.value })} placeholder="Versión" />
            <input aria-label="Fecha del cálculo" type="date" className={input} value={r.fecha.slice(0, 10)} disabled={readOnly} onChange={(e) => campo(i, { fecha: e.target.value })} />
            <input aria-label="Resultado del riesgo" className={input} value={String(r.resultado)} disabled={readOnly} onChange={(e) => campo(i, { resultado: e.target.value })} placeholder="Resultado" />
            <input aria-label="Unidad del riesgo" className={input} value={r.unidad} disabled={readOnly} onChange={(e) => campo(i, { unidad: e.target.value })} placeholder="Unidad (% a 10 años…)" />
            <input
              aria-label="Entradas"
              className={input}
              disabled={readOnly}
              defaultValue={r.entradas.map((x) => `${x.clave}=${x.valor}${x.unidad ? ` ${x.unidad}` : ''}`).join('; ')}
              onBlur={(e) => campo(i, { entradas: parsearEntradas(e.target.value) })}
              placeholder="edad=58; PAS=140 mmHg"
            />
          </div>
        )}
      />
    </>
  );
}

function parsearEntradas(texto: string): RegistroRiesgoCv['entradas'] {
  return texto
    .split(';')
    .map((parte) => parte.trim())
    .filter(Boolean)
    .map((parte) => {
      const [clave = '', resto = ''] = parte.split('=');
      const [valor = '', ...unidad] = resto.trim().split(/\s+/);
      const numero = Number(valor);
      return {
        clave: clave.trim(),
        valor: valor !== '' && Number.isFinite(numero) ? numero : valor,
        ...(unidad.length ? { unidad: unidad.join(' ') } : {}),
      };
    });
}

function Pes({ bloques, onChange, readOnly }: PropsBloque) {
  const items = bloques.pes ?? [];
  const set = (nuevos: DiagnosticoPes[]) => onChange((b) => ({ ...b, pes: nuevos }));
  const campo = (i: number, cambio: Partial<DiagnosticoPes>) =>
    set(items.map((p, j) => (j === i ? { ...p, ...cambio } : p)));
  return (
    <Lista
      items={items}
      readOnly={readOnly}
      etiquetaAgregar="Agregar diagnóstico PES"
      onAdd={() => set([...items, { problema: '', etiologia: '', signosSintomas: '' }])}
      onRemove={(i) => set(items.filter((_, j) => j !== i))}
      render={(p, i) => (
        <div className="grid gap-2">
          <input aria-label="Problema nutricional" className={input} value={p.problema} disabled={readOnly} onChange={(e) => campo(i, { problema: e.target.value })} placeholder="Problema" />
          <input aria-label="Etiología" className={input} value={p.etiologia} disabled={readOnly} onChange={(e) => campo(i, { etiologia: e.target.value })} placeholder="Relacionado con (etiología)" />
          <input aria-label="Signos y síntomas" className={input} value={p.signosSintomas} disabled={readOnly} onChange={(e) => campo(i, { signosSintomas: e.target.value })} placeholder="Evidenciado por (signos y síntomas)" />
        </div>
      )}
    />
  );
}

function AlergiasVerificadas({ bloques, onChange, readOnly }: PropsBloque) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={!!bloques.alergiasVerificadasEn}
        disabled={readOnly}
        onChange={(e) =>
          onChange((b) => ({ ...b, alergiasVerificadasEn: e.target.checked ? new Date().toISOString() : undefined }))
        }
      />
      Alergias verificadas con el paciente en esta consulta
      {bloques.alergiasVerificadasEn && (
        <span className="text-xs text-slate-400">
          ({new Date(bloques.alergiasVerificadasEn).toLocaleString('es-MX')})
        </span>
      )}
    </label>
  );
}
