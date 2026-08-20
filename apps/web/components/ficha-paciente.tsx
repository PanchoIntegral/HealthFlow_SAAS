'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { ActividadClinicaPaciente } from '@healthflow/shared-types';
import { api, ApiError } from '../lib/api';
import { Modal } from './modal';
import { IconArchive, IconPencil, IconTrash } from './icons';

const CAMPO =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue';

/**
 * Acciones sobre la ficha del paciente: corregir sus datos, archivarlo o
 * eliminarlo.
 *
 * "Eliminar" y "archivar" NO son lo mismo, y la interfaz no los presenta como
 * si lo fueran: la NOM-004 obliga a conservar el expediente cinco años desde
 * el último acto médico, así que un paciente con historial nunca se borra —se
 * archiva. El botón de eliminar existe solo para el caso legítimo: el
 * duplicado o el dedazo que nunca fue un expediente. Si el backend responde
 * que hay historial, el diálogo lo dice y ofrece archivar en su lugar.
 */
export function FichaPaciente({
  token,
  patientId,
  nombre,
  telefono,
  fechaNacimiento,
}: {
  token: string;
  patientId: string;
  nombre: string;
  telefono: string | null;
  fechaNacimiento: string;
}) {
  const [editando, setEditando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setEditando(true)}
          className="flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline"
        >
          <IconPencil size={13} />
          Corregir datos
        </button>
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-700"
        >
          <IconArchive size={13} />
          Archivar o eliminar
        </button>
      </div>

      {editando && (
        <EditarDatosModal
          token={token}
          patientId={patientId}
          nombre={nombre}
          telefono={telefono}
          fechaNacimiento={fechaNacimiento}
          onClose={() => setEditando(false)}
        />
      )}

      {confirmando && (
        <ArchivarEliminarModal
          token={token}
          patientId={patientId}
          nombre={nombre}
          onClose={() => setConfirmando(false)}
        />
      )}
    </>
  );
}

function EditarDatosModal({
  token,
  patientId,
  nombre,
  telefono,
  fechaNacimiento,
  onClose,
}: {
  token: string;
  patientId: string;
  nombre: string;
  telefono: string | null;
  fechaNacimiento: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [n, setN] = useState(nombre);
  const [t, setT] = useState(telefono ?? '');
  const [f, setF] = useState(fechaNacimiento);

  const guardar = useMutation({
    mutationFn: () =>
      api.updatePatient(token, patientId, {
        nombre: n.trim(),
        telefono: t.trim(),
        fechaNacimiento: f,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinical-record', patientId] });
      qc.invalidateQueries({ queryKey: ['patients'] });
      onClose();
    },
  });

  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <Modal titulo="Corregir datos del paciente" onClose={onClose}>
      <label className="mb-3 block text-sm">
        <span className="mb-1 block font-medium text-slate-600">Nombre completo</span>
        <input value={n} onChange={(e) => setN(e.target.value)} maxLength={160} className={CAMPO} />
      </label>

      <label className="mb-3 block text-sm">
        <span className="mb-1 block font-medium text-slate-600">Teléfono</span>
        <input
          value={t}
          onChange={(e) => setT(e.target.value)}
          maxLength={20}
          placeholder="Opcional"
          className={CAMPO}
        />
        <span className="mt-1 block text-xs text-slate-400">Déjalo vacío para borrarlo.</span>
      </label>

      <label className="mb-4 block text-sm">
        <span className="mb-1 block font-medium text-slate-600">Fecha de nacimiento</span>
        <input
          type="date"
          value={f}
          max={hoy}
          onChange={(e) => setF(e.target.value)}
          className={CAMPO}
        />
      </label>

      {/* Se avisa explícitamente porque es contraintuitivo: el usuario espera
          que corregir estos datos arregle TODO, y en las recetas ya emitidas no
          lo hace — su contenido es un snapshot congelado a propósito, para que
          la reimpresión coincida con el papel que se entregó. La fecha de
          nacimiento pesa más que el nombre aquí: cambia la EDAD, y una receta
          ya impresa se queda con la edad anterior. */}
      <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
        Las recetas y documentos ya emitidos conservan el nombre y la edad con
        los que se imprimieron: son copias de lo que se entregó al paciente y
        no se reescriben. La corrección aplica de aquí en adelante, incluida la
        edad en las próximas recetas.
      </p>

      {guardar.error && (
        <p className="mb-3 text-sm text-red-700">
          {guardar.error instanceof ApiError ? guardar.error.message : 'Error de conexión'}
        </p>
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
          disabled={n.trim().length < 2 || !f || guardar.isPending}
          onClick={() => guardar.mutate()}
          className="rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {guardar.isPending ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  );
}

function ArchivarEliminarModal({
  token,
  patientId,
  nombre,
  onClose,
}: {
  token: string;
  patientId: string;
  nombre: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  /** Se llena solo si el backend rechaza el borrado por tener expediente. */
  const [actividad, setActividad] = useState<ActividadClinicaPaciente | null>(null);

  const salir = () => {
    qc.invalidateQueries({ queryKey: ['patients'] });
    router.push('/pacientes');
  };

  const archivar = useMutation({
    mutationFn: () => api.archivarPaciente(token, patientId),
    onSuccess: salir,
  });

  const eliminar = useMutation({
    mutationFn: () => api.eliminarPaciente(token, patientId),
    onSuccess: salir,
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { actividad?: ActividadClinicaPaciente };
        if (body.actividad) setActividad(body.actividad);
      }
    },
  });

  const error = eliminar.error instanceof ApiError ? eliminar.error : null;

  return (
    <Modal titulo="Archivar o eliminar" subtitulo={nombre} onClose={onClose}>
      <section className="mb-4 rounded-xl border border-slate-200 p-3">
        <h3 className="text-sm font-semibold text-slate-800">Archivar</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Sale del buscador y del directorio, y deja de contar para el cupo de tu plan. El
          expediente se conserva completo y puedes reactivarlo cuando quieras. Es lo que debes
          usar si el paciente ya no se atiende contigo.
        </p>
        <button
          type="button"
          disabled={archivar.isPending}
          onClick={() => archivar.mutate()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          <IconArchive size={15} />
          {archivar.isPending ? 'Archivando…' : 'Archivar paciente'}
        </button>
      </section>

      <section className="rounded-xl border border-red-200 p-3">
        <h3 className="text-sm font-semibold text-red-900">Eliminar definitivamente</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Solo funciona si este registro <strong>nunca tuvo actividad clínica</strong> — un
          duplicado o un alta por error. Si ya tiene expediente, la NOM-004 obliga a conservarlo
          cinco años y el sistema no te dejará borrarlo.
        </p>

        {actividad && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-900">
              No se puede eliminar: este paciente tiene expediente
            </p>
            <p className="mt-1 text-sm text-amber-800">{error?.message}</p>
          </div>
        )}

        {error && !actividad && (
          <p className="mt-3 text-sm text-red-700">{error.message}</p>
        )}

        <button
          type="button"
          disabled={eliminar.isPending || actividad !== null}
          onClick={() => eliminar.mutate()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          <IconTrash size={15} />
          {eliminar.isPending ? 'Eliminando…' : 'Eliminar definitivamente'}
        </button>
      </section>
    </Modal>
  );
}
