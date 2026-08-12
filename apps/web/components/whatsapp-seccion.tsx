'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SaveWhatsappConfigRequest,
  WhatsappConfigView,
  WhatsappConsumoMes,
} from '@healthflow/shared-types';
import { api, ApiError } from '../lib/api';

const CAMPO =
  'w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 disabled:bg-slate-50';
const BOTON =
  'rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2.5 font-semibold text-white transition hover:opacity-95 disabled:opacity-50';

/** Anticipaciones que se ofrecen. Fuera de esto es un caso raro que no vale la pena exponer. */
const ANTICIPACIONES = [
  { horas: 2, etiqueta: '2 horas antes' },
  { horas: 24, etiqueta: 'Un día antes' },
  { horas: 48, etiqueta: 'Dos días antes' },
  { horas: 72, etiqueta: 'Tres días antes' },
];

export function WhatsappSeccion({ token }: { token: string }) {
  const qc = useQueryClient();
  const consulta = useQuery({
    queryKey: ['whatsapp-config'],
    queryFn: () => api.getWhatsappConfig(token),
  });

  const [form, setForm] = useState<WhatsappConfigView | null>(null);
  const [guardado, setGuardado] = useState(false);

  useEffect(() => {
    if (consulta.data) setForm(consulta.data);
  }, [consulta.data]);

  const mutation = useMutation({
    mutationFn: (body: SaveWhatsappConfigRequest) => api.saveWhatsappConfig(token, body),
    onSuccess: (config) => {
      setForm(config);
      qc.setQueryData(['whatsapp-config'], config);
      setGuardado(true);
    },
  });

  if (consulta.isLoading || !form) {
    return <p className="text-sm text-slate-500">Cargando…</p>;
  }
  if (consulta.isError) {
    return <p className="text-sm text-red-600">No se pudo cargar la configuración.</p>;
  }

  const set = <K extends keyof WhatsappConfigView>(k: K, v: WhatsappConfigView[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setGuardado(false);
  };

  const guardar = (extra: SaveWhatsappConfigRequest = {}) => {
    mutation.mutate({
      activo: form.activo,
      nombreRemitente: form.nombreRemitente,
      horasAnticipacion: form.horasAnticipacion,
      enviarConfirmacion: form.enviarConfirmacion,
      zonaHoraria: form.zonaHoraria,
      silencioDesde: form.silencioDesde,
      silencioHasta: form.silencioHasta,
      ...extra,
    });
  };

  const faltaNombre = !form.nombreRemitente?.trim();

  return (
    <div className="space-y-4">
      <Tarjeta>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-slate-800">Recordatorios automáticos</h3>
            <p className="mt-1 text-sm text-slate-500">
              Tus pacientes reciben un WhatsApp antes de su cita, con botones para confirmar,
              cancelar o reagendar.
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.activo}
              disabled={faltaNombre && !form.activo}
              onChange={(e) => set('activo', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-blue focus:ring-brand-blue disabled:opacity-40"
            />
            <span className={faltaNombre && !form.activo ? 'text-slate-400' : 'text-slate-700'}>
              Activos
            </span>
          </label>
        </div>

        {faltaNombre && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Para activarlos, escribe abajo el nombre con el que quieres que te identifiquen tus
            pacientes.
          </p>
        )}
      </Tarjeta>

      <Tarjeta>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Nombre de la clínica</span>
          <input
            value={form.nombreRemitente ?? ''}
            onChange={(e) => set('nombreRemitente', e.target.value)}
            maxLength={120}
            placeholder="Clínica Dental del Valle"
            className={CAMPO}
          />
          {/*
            Los mensajes salen del número compartido de HealthFlow, así que el
            remitente que ve el paciente no es la clínica: el nombre viaja
            dentro del texto y sin él el aviso llegaría sin decir de parte de
            quién es.
          */}
          <span className="mt-1 block text-xs text-slate-500">
            Aparece dentro del mensaje: «Te recordamos tu cita en {form.nombreRemitente?.trim() ||
              '…'}».
          </span>
        </label>

        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Cuándo se envía</span>
          <select
            value={form.horasAnticipacion}
            onChange={(e) => set('horasAnticipacion', Number(e.target.value))}
            className={CAMPO}
          >
            {ANTICIPACIONES.map((a) => (
              <option key={a.horas} value={a.horas}>
                {a.etiqueta}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            Nunca se manda entre las {form.silencioDesde}:00 y las {form.silencioHasta}:00; si le
            toca de madrugada, sale a primera hora.
          </span>
        </label>
      </Tarjeta>

      <Tarjeta>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.enviarConfirmacion}
            onChange={(e) => set('enviarConfirmacion', e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-blue focus:ring-brand-blue"
          />
          <span className="text-slate-700">
            Responder «Cita confirmada» cuando el paciente pulsa el botón
          </span>
        </label>
        {/*
          A partir del 1-oct-2026 Meta cobra también los mensajes de respuesta,
          que hoy son gratis. Para una clínica con volumen alto esa respuesta
          pasa a ser ~40% de la factura, y muchas van a preferir que el botón
          solo actualice el estatus en silencio.
        */}
        <p className="mt-2 pl-6 text-xs text-slate-500">
          Hoy esta respuesta no cuesta nada. A partir de octubre de 2026 Meta la cobra igual que
          el recordatorio; si lo apagas, el botón sigue funcionando y la cita se marca como
          confirmada, solo que el paciente no recibe acuse.
        </p>
      </Tarjeta>

      {mutation.isError && (
        <p className="text-sm text-red-600">
          {mutation.error instanceof ApiError ? mutation.error.message : 'No se pudo guardar'}
        </p>
      )}

      <Consumo token={token} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => guardar()}
          disabled={mutation.isPending}
          className={BOTON}
        >
          {mutation.isPending ? 'Guardando…' : 'Guardar cambios'}
        </button>
        {guardado && !mutation.isPending && (
          <span className="text-sm text-brand-green">Guardado.</span>
        )}
      </div>
    </div>
  );
}

/**
 * Cuántos mensajes se han mandado. Va aquí, junto al interruptor, y no en
 * Facturación: la decisión de encender los recordatorios y la de cuánto cuestan
 * son la misma decisión.
 */
function Consumo({ token }: { token: string }) {
  const consulta = useQuery({
    queryKey: ['whatsapp-consumo'],
    queryFn: () => api.getWhatsappConsumo(token),
  });

  const meses = consulta.data ?? [];
  if (meses.length === 0) return null;

  return (
    <Tarjeta>
      <h3 className="font-semibold text-slate-800">Mensajes enviados</h3>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="pb-2 font-medium">Mes</th>
            <th className="pb-2 text-right font-medium">Cobrables</th>
            <th className="pb-2 text-right font-medium">Leídos</th>
            <th className="pb-2 text-right font-medium">Fallidos</th>
          </tr>
        </thead>
        <tbody>
          {meses.map((m: WhatsappConsumoMes) => (
            <tr key={m.mes} className="border-t border-slate-100">
              <td className="py-2 text-slate-700">{nombreDelMes(m.mes)}</td>
              <td className="py-2 text-right font-medium text-slate-800">{m.facturables}</td>
              <td className="py-2 text-right text-slate-500">{m.leidos}</td>
              <td className="py-2 text-right text-slate-500">{m.fallidos}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/*
        La tarifa se documenta aquí porque no hay cupo gratis: se cobra desde el
        primer mensaje. Es una estimación — la factura real la emite Meta.
      */}
      <p className="mt-3 text-xs text-slate-500">
        Solo se cobran los mensajes que salieron. Referencia: unos $0.0085 USD cada uno en México;
        la cifra exacta la factura Meta.
      </p>
    </Tarjeta>
  );
}

function nombreDelMes(mes: string): string {
  const [anio, m] = mes.split('-');
  const fecha = new Date(Number(anio), Number(m) - 1, 1);
  return new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(fecha);
}

function Tarjeta({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">{children}</div>;
}
