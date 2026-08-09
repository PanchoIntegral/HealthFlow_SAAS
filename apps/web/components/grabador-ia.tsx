'use client';

import { useEffect, useRef, useState } from 'react';
import type { NotaEvolucionContent, SugerenciaNotaIa } from '@healthflow/shared-types';
import { api, ApiError } from '../lib/api';

type Estado = 'idle' | 'grabando' | 'procesando' | 'error';

/**
 * Contenedores a intentar, en orden de preferencia.
 *
 * Ogg va primero porque es el que Google documenta como soportado; Firefox lo
 * produce de forma nativa. Chrome solo sabe grabar webm y Safari mp4, así que
 * esos quedan como respaldo: si Gemini llegara a rechazar alguno, el arreglo
 * es transcodificar del lado del servidor, no dejar sin función al navegador
 * que usa la mayoría.
 */
const FORMATOS = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

/** Debe coincidir con MAX_AUDIO_BYTES del API (tope de la petición a Gemini). */
const MAX_BYTES = 14 * 1024 * 1024;

function formatoSoportado(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return FORMATOS.find((f) => MediaRecorder.isTypeSupported(f)) ?? null;
}

const mmss = (segundos: number) =>
  `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;

/**
 * Graba la consulta y la manda a transcribir.
 *
 * El audio vive SOLO en memoria del navegador y se manda una vez; ni se guarda
 * localmente ni se persiste en el servidor. Al terminar, lo que vuelve es una
 * sugerencia que el padre mezcla con lo que el médico ya escribió — este
 * componente nunca toca la nota directamente.
 *
 * Si algo falla, el blob grabado se conserva para poder reintentar sin volver
 * a grabar la consulta: pedirle a un médico que repita 20 minutos de audio
 * porque se cayó la red no es una opción.
 */
export function GrabadorIa({
  token,
  appointmentId,
  contenidoActual,
  onSugerencia,
}: {
  token: string;
  appointmentId: string;
  contenidoActual: NotaEvolucionContent;
  onSugerencia: (sugerencia: SugerenciaNotaIa, advertencias: string[]) => void;
}) {
  const [estado, setEstado] = useState<Estado>('idle');
  const [error, setError] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(0);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  /** Se conserva tras un fallo para poder reintentar sin regrabar. */
  const pendiente = useRef<Blob | null>(null);
  /** Se lee al detener: el estado de React llega tarde al callback del recorder. */
  const contenidoRef = useRef(contenidoActual);
  contenidoRef.current = contenidoActual;

  // Cronómetro de la grabación.
  useEffect(() => {
    if (estado !== 'grabando') return;
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [estado]);

  // Avisa antes de cerrar la pestaña con una grabación en curso o subiendo:
  // ese audio no existe en ningún otro lado.
  useEffect(() => {
    if (estado !== 'grabando' && estado !== 'procesando') return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [estado]);

  // Suelta el micrófono si el componente se desmonta grabando (el indicador
  // del navegador se quedaría prendido, y con razón: seguiría abierto).
  useEffect(() => {
    return () => {
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function iniciar() {
    setError(null);
    const mimeType = formatoSoportado();
    if (!mimeType) {
      setError('Tu navegador no puede grabar audio. Prueba con Chrome o Safari actualizado.');
      setEstado('error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType });
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        // Soltar el micrófono en cuanto se deja de grabar, no al terminar de
        // procesar: el punto rojo del navegador debe apagarse cuando de verdad
        // se dejó de escuchar.
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: mimeType });
        chunks.current = [];
        void enviar(blob);
      };
      recorder.current = rec;
      // Un chunk cada 10s: si el navegador se queda sin memoria en una consulta
      // muy larga, se pierde lo mínimo.
      rec.start(10_000);
      setSegundos(0);
      setEstado('grabando');
    } catch {
      setError('No se pudo usar el micrófono. Revisa los permisos del navegador.');
      setEstado('error');
    }
  }

  function detener() {
    setEstado('procesando');
    recorder.current?.stop();
  }

  async function enviar(blob: Blob) {
    pendiente.current = blob;
    setEstado('procesando');
    setError(null);

    // Se corta aquí y no tras subir 14 MB por una red lenta: el médico se
    // entera al instante, no al final de la espera.
    if (blob.size > MAX_BYTES) {
      pendiente.current = null;
      setError('La grabación es demasiado larga para transcribirla. Captura la nota a mano.');
      setEstado('error');
      return;
    }

    try {
      const res = await api.transcribirIa(token, appointmentId, blob, contenidoRef.current);
      pendiente.current = null;
      onSugerencia(res.contenido, res.advertencias);
      setEstado('idle');
      setSegundos(0);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo enviar el audio. Revisa tu conexión e intenta de nuevo.',
      );
      setEstado('error');
    }
  }

  if (estado === 'grabando') {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-sm font-medium text-red-600">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          Grabando {mmss(segundos)}
        </span>
        <button
          onClick={detener}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold hover:border-brand-blue hover:text-brand-blue"
        >
          Detener y transcribir
        </button>
      </div>
    );
  }

  if (estado === 'procesando') {
    return (
      <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-500">
        Transcribiendo… puede tardar un minuto
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="max-w-xs text-right text-xs text-red-600" role="alert">
          {error}
        </span>
      )}
      <button
        onClick={() => (pendiente.current ? void enviar(pendiente.current) : void iniciar())}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-brand-blue hover:text-brand-blue"
      >
        {pendiente.current ? '↻ Reintentar transcripción' : '🎙 Grabar con IA'}
      </button>
    </div>
  );
}
