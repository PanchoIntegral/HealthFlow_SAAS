'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ETIQUETA_GRUPO_PLANTILLA,
  GRUPOS_PLANTILLA,
  ORDEN_PLANTILLAS_VACIA,
  VALORES_PLANTILLA,
  opcionesPlantillaDeGrupo,
  type GrupoPlantilla,
  type LadoPie,
  type MarcaPlantilla,
  type OrdenPlantillasContent,
} from '@healthflow/shared-types';
import { api } from '../lib/api';
import { Modal } from './modal';
import { IconPrinter } from './icons';

/**
 * Orden de plantillas ortopédicas (formato del laboratorio "Microrthopedic
 * Solutions"), en modal. Se monta y desmonta con el modal —nunca queda viva
 * de fondo— así que cada apertura hidrata limpio desde el servidor: el mismo
 * bug de estado que se corrigió en la página de consulta (ver el
 * `key={appointmentId}` de ConsultaPage) no puede reaparecer aquí porque no
 * hay instancia que sobreviva entre citas.
 *
 * Dos formas de abrirla, mutuamente excluyentes:
 *  - `appointmentId`: desde la consulta en curso. Puede que la orden todavía
 *    no exista, así que esta vía la CREA si hace falta.
 *  - `ordenId`: desde el expediente del paciente, donde la orden ya existe y
 *    solo se sigue llenando — no hay ninguna cita en curso de la que partir.
 *
 * Una vez resuelto el id (por cualquiera de las dos vías), guardar y marcar
 * completada van SIEMPRE por ese id: es lo que permite editar la misma orden
 * indistintamente desde la consulta o desde el expediente.
 */
export function OrdenPlantillasModal({
  token,
  appointmentId,
  ordenId,
  onClose,
}: {
  token: string;
  appointmentId?: string;
  ordenId?: string;
  onClose: () => void;
}) {
  const orden = useQuery({
    queryKey: appointmentId ? ['orden-plantillas-cita', appointmentId] : ['orden-plantillas', ordenId],
    queryFn: () =>
      appointmentId
        ? api.getOrCreateOrdenPlantillas(token, appointmentId)
        : api.getOrdenPlantillasDetalle(token, ordenId!),
  });
  const id = orden.data?.id;

  const [content, setContent] = useState<OrdenPlantillasContent>(ORDEN_PLANTILLAS_VACIA);
  const hydrated = useRef(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (orden.data && !hydrated.current) {
      setContent({ ...ORDEN_PLANTILLAS_VACIA, ...orden.data.contenido });
      hydrated.current = true;
    }
  }, [orden.data]);

  const readOnly = orden.data?.estatus === 'cancelada';

  const queryClient = useQueryClient();
  // Coincide por prefijo con `['ordenes-plantillas', patientId]` de la lista
  // del expediente (sin importar qué paciente): así, editar desde la consulta
  // deja el badge del expediente al día sin que nadie tenga que refrescar.
  const refrescarListados = () => void queryClient.invalidateQueries({ queryKey: ['ordenes-plantillas'] });

  const saveDraft = useMutation({
    mutationFn: (c: OrdenPlantillasContent) => api.saveOrdenPlantillasDraft(token, id!, c),
    onSuccess: () => {
      setSavedAt(new Date());
      refrescarListados();
    },
  });

  // Autosave con debounce, igual que el borrador de la nota. Espera a tener
  // `id` (no solo `hydrated`): si se abrió por `appointmentId`, el GET que
  // crea la orden puede tardar un instante más que el primer render.
  useEffect(() => {
    if (!hydrated.current || !id || readOnly) return;
    const t = setTimeout(() => saveDraft.mutate(content), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, id]);

  const marcarCompletada = useMutation({
    mutationFn: () => api.marcarOrdenPlantillasCompletada(token, id!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orden-plantillas', id] });
      void queryClient.invalidateQueries({ queryKey: ['orden-plantillas-cita', appointmentId] });
      refrescarListados();
    },
  });

  const alternarOpcion = (key: string) => {
    if (readOnly) return;
    setContent((c) => ({
      ...c,
      opciones: c.opciones.includes(key) ? c.opciones.filter((o) => o !== key) : [...c.opciones, key],
    }));
  };

  const alternarMarca = (key: string, lado: LadoPie) => {
    if (readOnly) return;
    setContent((c) => {
      const existe = c.marcas.some((m) => m.opcion === key && m.lado === lado);
      const marcas: MarcaPlantilla[] = existe
        ? c.marcas.filter((m) => !(m.opcion === key && m.lado === lado))
        : [...c.marcas, { opcion: key, lado }];
      return { ...c, marcas };
    });
  };

  const setValor = (key: string, valor: string) => {
    if (readOnly) return;
    setContent((c) => {
      const valores = { ...c.valores };
      if (valor) valores[key] = valor;
      else delete valores[key];
      return { ...c, valores };
    });
  };

  const setCampo = <K extends keyof OrdenPlantillasContent>(campo: K, valor: OrdenPlantillasContent[K]) => {
    if (readOnly) return;
    setContent((c) => ({ ...c, [campo]: valor }));
  };

  const marcaLado = (key: string, lado: LadoPie) => content.marcas.some((m) => m.opcion === key && m.lado === lado);

  const input =
    'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-blue disabled:bg-slate-50';

  return (
    <Modal
      titulo="Orden de plantillas ortopédicas"
      subtitulo="Microrthopedic Solutions · se llena desde la consulta o el expediente del paciente"
      onClose={onClose}
      ancho="max-w-4xl"
    >
      {orden.isLoading && <p className="text-sm text-slate-400">Cargando…</p>}

      {orden.data && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span
              className={`rounded-full px-2.5 py-1 font-medium ${
                orden.data.estatus === 'completada'
                  ? 'bg-emerald-100 text-emerald-800'
                  : orden.data.estatus === 'cancelada'
                    ? 'bg-slate-100 text-slate-500'
                    : 'bg-amber-100 text-amber-800'
              }`}
            >
              {orden.data.estatus === 'completada'
                ? '✓ Completada'
                : orden.data.estatus === 'cancelada'
                  ? 'Cancelada'
                  : 'Borrador'}
            </span>
            <span className="text-slate-400">
              {saveDraft.isPending ? 'Guardando…' : savedAt ? `Guardado hace instantes` : ''}
            </span>
          </div>

          {/* Datos de la orden */}
          <section className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-3">
            <Campo label="Shoe Size">
              <input
                value={content.shoeSize ?? ''}
                onChange={(e) => setCampo('shoeSize', e.target.value)}
                disabled={readOnly}
                className={input}
              />
            </Campo>
            <Campo label="Shoe Type">
              <input
                value={content.shoeType ?? ''}
                onChange={(e) => setCampo('shoeType', e.target.value)}
                disabled={readOnly}
                className={input}
              />
            </Campo>
            <Campo label="Weight">
              <input
                value={content.weight ?? ''}
                onChange={(e) => setCampo('weight', e.target.value)}
                disabled={readOnly}
                className={input}
              />
            </Campo>
            <Campo label="Account #">
              <input
                value={content.accountNumber ?? ''}
                onChange={(e) => setCampo('accountNumber', e.target.value)}
                disabled={readOnly}
                className={input}
              />
            </Campo>
            <Campo label="Date Required">
              <input
                type="date"
                value={content.dateRequired ?? ''}
                onChange={(e) => setCampo('dateRequired', e.target.value)}
                disabled={readOnly}
                className={input}
              />
            </Campo>
            <Campo label="Diagnosis" ancho={2}>
              <input
                value={content.diagnosis ?? ''}
                onChange={(e) => setCampo('diagnosis', e.target.value)}
                disabled={readOnly}
                className={input}
              />
            </Campo>
            <div className="flex items-end gap-4 pb-1.5 text-sm sm:col-span-3">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={content.returnCastToDr ?? false}
                  disabled={readOnly}
                  onChange={(e) => setCampo('returnCastToDr', e.target.checked)}
                />
                Return Cast to Dr
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={content.mailToPatient ?? false}
                  disabled={readOnly}
                  onChange={(e) => setCampo('mailToPatient', e.target.checked)}
                />
                Mail to Patient
              </label>
            </div>
          </section>

          {/* Grupos de casillas, en el mismo orden que la hoja del laboratorio */}
          <div className="grid gap-4 sm:grid-cols-2">
            {GRUPOS_PLANTILLA.map((grupo) => (
              <GrupoCasillas
                key={grupo}
                grupo={grupo}
                marcada={(key) => content.opciones.includes(key)}
                marcaLado={marcaLado}
                onToggle={alternarOpcion}
                onToggleLado={alternarMarca}
                readOnly={readOnly}
              />
            ))}
          </div>

          {/* Valores libres: grados de posting, espesores, hasta dónde llega la cobertura… */}
          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Posting y cobertura</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {VALORES_PLANTILLA.map((v) => (
                <Campo key={v.key} label={v.label}>
                  {v.tipo === 'seleccion' ? (
                    <select
                      value={content.valores[v.key] ?? ''}
                      onChange={(e) => setValor(v.key, e.target.value)}
                      disabled={readOnly}
                      className={input}
                    >
                      <option value="">—</option>
                      {(v.opciones ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={content.valores[v.key] ?? ''}
                      onChange={(e) => setValor(v.key, e.target.value)}
                      disabled={readOnly}
                      className={input}
                    />
                  )}
                </Campo>
              ))}
            </div>
          </section>

          <Campo label="Special instructions and diagnostic">
            <textarea
              value={content.specialInstructions ?? ''}
              onChange={(e) => setCampo('specialInstructions', e.target.value)}
              disabled={readOnly}
              rows={3}
              className={input}
            />
          </Campo>

          <div className="flex items-center gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => marcarCompletada.mutate()}
              disabled={readOnly || orden.data.estatus === 'completada' || marcarCompletada.isPending}
              className="rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {orden.data.estatus === 'completada' ? '✓ Completada' : 'Marcar como completada'}
            </button>
            {/* Nueva pestaña y no navegación dentro del modal: la vista de
                impresión es su propia ruta, sin el chrome de la consulta, y no
                tiene sentido perder el borrador que se está llenando aquí. */}
            <a
              href={`/ordenes-plantillas/${orden.data.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
            >
              <IconPrinter size={16} />
              Imprimir / Exportar
            </a>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Campo({ label, ancho = 1, children }: { label: string; ancho?: number; children: React.ReactNode }) {
  return (
    <div className={ancho === 2 ? 'sm:col-span-2' : undefined}>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      {children}
    </div>
  );
}

function GrupoCasillas({
  grupo,
  marcada,
  marcaLado,
  onToggle,
  onToggleLado,
  readOnly,
}: {
  grupo: GrupoPlantilla;
  marcada: (key: string) => boolean;
  marcaLado: (key: string, lado: LadoPie) => boolean;
  onToggle: (key: string) => void;
  onToggleLado: (key: string, lado: LadoPie) => void;
  readOnly?: boolean;
}) {
  const opciones = opcionesPlantillaDeGrupo(grupo);
  if (opciones.length === 0) return null;

  return (
    <section className="rounded-xl border border-slate-200 p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{ETIQUETA_GRUPO_PLANTILLA[grupo]}</h3>
      <ul className="space-y-1.5">
        {opciones.map((o) => (
          <li key={o.key} className="flex items-center justify-between gap-2 text-sm">
            {o.porLado ? (
              <>
                <span>{o.label}</span>
                <span className="flex shrink-0 gap-2 text-xs">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={marcaLado(o.key, 'derecho')}
                      disabled={readOnly}
                      onChange={() => onToggleLado(o.key, 'derecho')}
                    />
                    R
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={marcaLado(o.key, 'izquierdo')}
                      disabled={readOnly}
                      onChange={() => onToggleLado(o.key, 'izquierdo')}
                    />
                    L
                  </label>
                </span>
              </>
            ) : (
              <label className="flex w-full items-center gap-2">
                <input
                  type="checkbox"
                  checked={marcada(o.key)}
                  disabled={readOnly}
                  onChange={() => onToggle(o.key)}
                />
                {o.label}
              </label>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
