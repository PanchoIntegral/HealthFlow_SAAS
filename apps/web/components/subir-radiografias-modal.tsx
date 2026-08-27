'use client';

import { useRef, useState } from 'react';
import { MIME_TYPES_RADIOGRAFIA, type MimeTypeRadiografia } from '@healthflow/shared-types';
import { api, ApiError } from '../lib/api';
import { ErrorSubidaDirecta, subirArchivoDirecto } from '../lib/subida-directa';
import { Modal } from './modal';

const MAX_BYTES = 10 * 1024 * 1024;

type Estado = 'pendiente' | 'subiendo' | 'lista' | 'error';

interface EnCola {
  id: string;
  file: File;
  estado: Estado;
  error?: string;
  /** Miniatura local (objectURL): se ve la placa antes de subirla. */
  preview: string;
}

const peso = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/** Identidad práctica de un archivo: elegir dos veces la misma placa no la duplica. */
const huella = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

/** Motivo por el que un archivo no se puede ni intentar, o null si es válido. */
function rechazo(file: File): string | null {
  if (!MIME_TYPES_RADIOGRAFIA.includes(file.type as MimeTypeRadiografia)) {
    return 'Formato no admitido (JPEG, PNG o WEBP).';
  }
  if (file.size > MAX_BYTES) return `Pesa ${peso(file.size)}; el máximo es 10 MB.`;
  return null;
}

/**
 * Cola de subida de radiografías: se eligen varias placas de una vez y se
 * suben DE UNA EN UNA, cada una con su propio estado.
 *
 * Secuencial y no en paralelo a propósito: cada subida son dos llamadas al API
 * más el PUT al storage, y en el consultorio esto corre sobre el wifi de la
 * clínica. Diez placas en paralelo saturan la subida y hacen que fallen
 * varias a la vez; en fila, si una falla, las demás ya entraron y se puede
 * reintentar solo esa.
 */
export function SubirRadiografiasModal({
  token,
  patientId,
  onClose,
  onSubida,
}: {
  token: string;
  patientId: string;
  onClose: () => void;
  /** Se llama tras CADA subida exitosa: la galería de atrás se va poblando. */
  onSubida: () => void;
}) {
  const [cola, setCola] = useState<EnCola[]>([]);
  const [trabajando, setTrabajando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [arrastrando, setArrastrando] = useState(false);

  function agregar(files: FileList | File[]) {
    const yaEnCola = new Set(cola.map((c) => huella(c.file)));
    const entrantes = Array.from(files).filter((f) => {
      // Repetir la selección es fácil (volver a abrir el diálogo, arrastrar de
      // nuevo); subir dos veces la misma placa al expediente ensucia de verdad.
      if (yaEnCola.has(huella(f))) return false;
      yaEnCola.add(huella(f));
      return true;
    });
    const nuevos: EnCola[] = entrantes.map((file, i) => {
      const motivo = rechazo(file);
      return {
        id: `${Date.now()}-${i}-${file.name}`,
        file,
        estado: motivo ? 'error' : 'pendiente',
        error: motivo ?? undefined,
        preview: URL.createObjectURL(file),
      };
    });
    setCola((prev) => [...prev, ...nuevos]);
  }

  function quitar(id: string) {
    setCola((prev) => {
      const fuera = prev.find((c) => c.id === id);
      if (fuera) URL.revokeObjectURL(fuera.preview);
      return prev.filter((c) => c.id !== id);
    });
  }

  const marcar = (id: string, cambio: Partial<EnCola>) =>
    setCola((prev) => prev.map((c) => (c.id === id ? { ...c, ...cambio } : c)));

  async function subirUna(item: EnCola): Promise<void> {
    marcar(item.id, { estado: 'subiendo', error: undefined });
    try {
      const mimeType = item.file.type as MimeTypeRadiografia;
      const { uploadUrl, headers, storageKey } = await api.requestUploadUrl(token, {
        patientId,
        mimeType,
      });
      await subirArchivoDirecto(uploadUrl, headers, item.file);
      await api.confirmRadiografia(token, { patientId, storageKey, mimeType });
      marcar(item.id, { estado: 'lista' });
      onSubida();
    } catch (e) {
      if (e instanceof ErrorSubidaDirecta) {
        console.error('[radiografias] subida fallida:', e.causa, e.detalle);
      }
      marcar(item.id, {
        estado: 'error',
        error:
          e instanceof ErrorSubidaDirecta || e instanceof ApiError
            ? e.message
            : 'No se pudo subir esta imagen.',
      });
    }
  }

  async function subirTodas() {
    setTrabajando(true);
    // Se recorre la cola capturada al inicio: agregar archivos mientras sube
    // no reordena lo que ya está en marcha.
    const porSubir = cola.filter((c) => c.estado === 'pendiente' || c.estado === 'error');
    for (const item of porSubir) {
      if (rechazo(item.file)) continue; // inválido: ya trae su motivo en pantalla
      await subirUna(item);
    }
    setTrabajando(false);
  }

  const pendientes = cola.filter((c) => c.estado === 'pendiente').length;
  const listas = cola.filter((c) => c.estado === 'lista').length;
  const fallidas = cola.filter((c) => c.estado === 'error' && !rechazo(c.file)).length;

  function cerrar() {
    for (const c of cola) URL.revokeObjectURL(c.preview);
    onClose();
  }

  return (
    <Modal
      titulo="Subir radiografías"
      subtitulo="Puedes elegir varias. Se suben una por una, en orden."
      ancho="max-w-lg"
      onClose={trabajando ? () => {} : cerrar}
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          if (e.dataTransfer.files.length) agregar(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border border-dashed px-4 py-8 text-center text-sm transition ${
          arrastrando
            ? 'border-brand-blue bg-brand-blue/5 text-brand-blue'
            : 'border-slate-300 text-slate-500 hover:border-brand-blue hover:text-brand-blue'
        }`}
      >
        <p className="font-medium">Arrastra las placas aquí o haz clic para elegirlas</p>
        <p className="mt-1 text-xs text-slate-400">JPEG, PNG o WEBP · hasta 10 MB cada una</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={MIME_TYPES_RADIOGRAFIA.join(',')}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) agregar(e.target.files);
            // Permite volver a elegir el MISMO archivo tras quitarlo.
            e.target.value = '';
          }}
        />
      </div>

      {cola.length > 0 && (
        <ul className="mt-4 space-y-2">
          {cola.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-slate-200 p-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.preview}
                alt=""
                className="h-12 w-12 shrink-0 rounded object-cover ring-1 ring-slate-200"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{item.file.name}</p>
                <p className="text-xs text-slate-400">{peso(item.file.size)}</p>
                {item.error && <p className="mt-0.5 text-xs text-red-600">{item.error}</p>}
              </div>
              <EstadoBadge estado={item.estado} />
              {item.estado !== 'subiendo' && item.estado !== 'lista' && (
                <button
                  onClick={() => quitar(item.id)}
                  aria-label={`Quitar ${item.file.name}`}
                  className="shrink-0 px-1 text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {listas > 0 && `${listas} subida${listas === 1 ? '' : 's'}`}
          {listas > 0 && fallidas > 0 && ' · '}
          {fallidas > 0 && `${fallidas} con error`}
        </p>
        <div className="flex gap-2">
          <button
            onClick={cerrar}
            disabled={trabajando}
            className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            {listas > 0 && pendientes === 0 && fallidas === 0 ? 'Cerrar' : 'Cancelar'}
          </button>
          <button
            onClick={() => void subirTodas()}
            disabled={trabajando || (pendientes === 0 && fallidas === 0)}
            className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {trabajando
              ? 'Subiendo…'
              : fallidas > 0 && pendientes === 0
                ? `Reintentar ${fallidas}`
                : `Subir ${pendientes || ''}`.trim()}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EstadoBadge({ estado }: { estado: Estado }) {
  if (estado === 'lista') return <span className="shrink-0 text-sm text-emerald-600">✓</span>;
  if (estado === 'subiendo')
    return <span className="shrink-0 text-xs text-brand-blue">Subiendo…</span>;
  if (estado === 'error') return <span className="shrink-0 text-sm text-red-500">!</span>;
  return null;
}
