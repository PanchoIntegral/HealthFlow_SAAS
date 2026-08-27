'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CORRECCION_TEXTO_MAX, CORRECCION_TEXTO_MIN } from '@healthflow/shared-types';
import { api, ApiError } from '../lib/api';
import { Modal } from './modal';

/**
 * Agrega una corrección a una nota cerrada.
 *
 * Deliberadamente NO es un editor de la nota: la NOM-004 no admite
 * enmendaduras ni tachaduras, así que lo que se firmó se queda como está y la
 * rectificación se escribe aparte, con fecha y autor. El texto del modal se lo
 * dice al médico, porque la primera reacción de todos es buscar el botón de
 * "editar" y conviene que entiendan por qué no existe.
 */
export function CorregirNotaModal({
  token,
  noteId,
  patientId,
  onClose,
}: {
  token: string;
  noteId: string;
  patientId: string;
  onClose: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const guardar = useMutation({
    mutationFn: () => api.corregirNota(token, noteId, texto.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clinical-record', patientId] });
      onClose();
    },
    onError: (e: unknown) => {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar la corrección.');
    },
  });

  const faltan = CORRECCION_TEXTO_MIN - texto.trim().length;

  return (
    <Modal
      titulo="Agregar corrección"
      subtitulo="La nota original no se modifica: tu aclaración queda firmada y fechada debajo de ella."
      ancho="max-w-lg"
      onClose={guardar.isPending ? () => {} : onClose}
    >
      <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        El expediente clínico no admite enmendaduras (NOM-004). Por eso una nota firmada no se
        reescribe: se corrige agregando esta aclaración, que queda con tu nombre, tu cédula y la
        fecha de hoy.
      </p>

      <label className="block text-sm">
        <span className="mb-1 block font-medium text-slate-600">Qué se corrige y por qué</span>
        <textarea
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          disabled={guardar.isPending}
          rows={5}
          maxLength={CORRECCION_TEXTO_MAX}
          placeholder="Ej.: En la exploración se asentó pie derecho; la lesión corresponde al pie izquierdo."
          className="w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-brand-blue"
        />
        <span className="mt-1 block text-xs text-slate-400">
          {faltan > 0
            ? `Faltan ${faltan} caracteres.`
            : `${texto.trim().length} / ${CORRECCION_TEXTO_MAX}`}
        </span>
      </label>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={guardar.isPending}
          className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          onClick={() => guardar.mutate()}
          disabled={guardar.isPending || faltan > 0}
          className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {guardar.isPending ? 'Guardando…' : 'Firmar corrección'}
        </button>
      </div>
    </Modal>
  );
}
