'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  EMPTY_NOTA_EVOLUCION,
  MAPA_CORPORAL_VACIO,
  ODONTOGRAMA_VACIO,
  PODOGRAMA_VACIO,
  partidasDesdeOdontograma,
  perfilDe,
  type CampoBaseKey,
  type CampoSugeribleIa,
  type Odontograma as OdontogramaData,
  type MapaCorporal as MapaCorporalData,
  type Podograma as PodogramaData,
  type DatoNoCapturado,
  type DiagnosticoCie10,
  type ErrorCierre,
  type EsquemaNota,
  type BloquesNota,
  type EspecialidadKey,
  type HistorialPaciente,
  type SugerenciaNotaIa,
  type NotaEvolucionContent,
  type PerfilEspecialidad,
  type PresupuestoView,
  type SignosVitales,
} from '@healthflow/shared-types';
import { useAuth } from '../../../lib/auth';
import { api, ApiError } from '../../../lib/api';
import { RichTextEditor } from '../../../components/rich-text-editor';
import { CamposEspecialidad } from '../../../components/campos-especialidad';
import { AlertaAlergias } from '../../../components/alerta-alergias';
import { EditorHistorial } from '../../../components/editor-historial';
import { OrdenPlantillasModal } from '../../../components/orden-plantillas-modal';
import { IconClipboardList, IconPill } from '../../../components/icons';
import { RecetaModal } from '../../../components/receta-modal';
import { Odontograma } from '../../../components/odontograma';
import { Podograma } from '../../../components/podograma';
import { MapaCorporal } from '../../../components/mapa-corporal';
import { NuevoPresupuestoModal } from '../../../components/nuevo-presupuesto-modal';
import { Modal } from '../../../components/modal';
import { GrabadorIa } from '../../../components/grabador-ia';
import { pesos } from '../../../components/presupuesto-panel';
import { BloqueNota } from '../../../components/nota/bloques-nota';
import { PendientesFirma } from '../../../components/nota/pendientes-firma';
import { VerificacionAntecedentes } from '../../../components/nota/verificacion-antecedentes';
import {
  ETIQUETA_CONTEXTO,
  bloquesDelEsquema,
  campoDe,
  clavesExtension,
  erroresDe,
  esRequerido,
} from '../../../components/nota/esquema-ui';

/** Etiqueta de cada signo vital. Qué subconjunto se muestra lo decide el perfil. */
const ETIQUETA_VITAL: Record<keyof SignosVitales, string> = {
  ta: 'T/A (mmHg)',
  fc: 'FC (lpm)',
  fr: 'FR (rpm)',
  temp: 'Temp (°C)',
  spo2: 'SpO₂ (%)',
  peso: 'Peso (kg)',
  talla: 'Talla (m)',
};

/** Texto por defecto de los campos base, cuando la especialidad no lo reescribe. */
const ETIQUETA_BASE: Record<CampoBaseKey, { label: string; placeholder?: string }> = {
  padecimientoActual: {
    label: 'Padecimiento actual',
    placeholder: 'Describir inicio, evolución y síntomas asociados…',
  },
  hallazgos: { label: 'Hallazgos', placeholder: '' },
  diagnosticos: { label: 'Diagnósticos (CIE-10)' },
  planTerapeutico: {
    label: 'Plan terapéutico',
    placeholder: 'Medicamentos, indicaciones, próxima cita…',
  },
};

/** Etiqueta efectiva de un campo base: la de la especialidad si la define. */
function textoDe(perfil: PerfilEspecialidad, campo: CampoBaseKey) {
  return { ...ETIQUETA_BASE[campo], ...(perfil.etiquetas?.[campo] ?? {}) };
}

/**
 * Norma que rige la nota. NOM-004 es la base de todo expediente clínico, pero
 * el odontológico se rige además por la NOM-013-SSA2-2015 — y decirle NOM-004
 * a secas a un dentista es información incorrecta en pantalla.
 */
function normaDe(perfil: PerfilEspecialidad): string {
  return perfil.key === 'odontologia'
    ? 'NOM-004-SSA3-2012 · NOM-013-SSA2-2015'
    : 'NOM-004-SSA3-2012';
}

/**
 * Envoltura delgada: su ÚNICO trabajo es forzar un remount completo cuando
 * cambia `appointmentId`.
 *
 * Next.js App Router NO desmonta el componente de página al navegar entre dos
 * URLs de la MISMA ruta dinámica (`/consulta/A` → `/consulta/B`): reutiliza la
 * instancia y solo le pasa params nuevos. Sin este `key`, todo el estado de
 * React de abajo —el contenido de la nota, el `hydrated` que decide si ya se
 * cargó— sobrevive el cambio de paciente. El efecto de hidratación es
 * "cárgalo UNA vez"; si la instancia no se renueva, esa vez ya pasó, y el
 * borrador de un paciente se queda pintado (y AUTOGUARDADO, vía el timer de
 * `saveDraft`) en la consulta de otro. Es la causa real de las notas
 * cruzadas: nunca fue una fuga en la base de datos ni en el backend — RLS
 * separa por cuenta correctamente — sino un remount que no ocurría.
 *
 * `key={appointmentId}` es la forma correcta de pedirle a React que trate cada
 * cita como una identidad distinta: al cambiar la key, desmonta la instancia
 * vieja entera (con su `content`, sus refs, sus timers pendientes) y monta una
 * limpia. Ninguna cantidad de `useEffect` adicional es tan confiable como
 * esto, porque no depende de acordarse de resetear cada pieza de estado una
 * por una — y la próxima persona que agregue un `useState` a esta pantalla no
 * tiene que saber de este problema para no reintroducirlo.
 */
export default function ConsultaPage({
  params,
}: {
  params: Promise<{ appointmentId: string }>;
}) {
  const { appointmentId } = use(params);
  return <ConsultaPageInner key={appointmentId} appointmentId={appointmentId} />;
}

function ConsultaPageInner({ appointmentId }: { appointmentId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const patientId = searchParams.get('patientId');
  const { token, user, ready } = useAuth();

  const [content, setContent] = useState<NotaEvolucionContent>(EMPTY_NOTA_EVOLUCION);
  /**
   * Lo que la nota pide y lo que falta, SIEMPRE calculado por la API: llega con
   * la nota, se refresca con cada autosave y con el rechazo de un cierre. La
   * pantalla no evalúa reglas; si una regla cambia, aquí no se toca nada.
   */
  const [esquema, setEsquema] = useState<EsquemaNota | undefined>(undefined);
  const [pendientes, setPendientes] = useState<ErrorCierre[]>([]);
  /** Tras un intento de firma fallido se resaltan en rojo los campos pendientes. */
  const [intentoFirma, setIntentoFirma] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const hydrated = useRef(false);

  // Presupuesto creado desde la consulta, sin salir a registrar alergias primero.
  const [modalPresupuesto, setModalPresupuesto] = useState(false);
  const [presupuestoCreado, setPresupuestoCreado] = useState<PresupuestoView | null>(null);

  /** Se pide la cédula justo antes de firmar, si el médico aún no la tiene. */
  const [modalCedula, setModalCedula] = useState(false);

  /**
   * Captura de alergias y antecedentes, EN MODAL sobre la propia consulta.
   *
   * Antes mandaba al médico a /pacientes/{id} a mitad de escribir la nota —
   * salir de la pantalla para anotar una alergia y tener que regresar rompe el
   * flujo justo en el momento en que más urge tener el dato a la vista. El
   * editor es el mismo (`EditorHistorial`) que usa el expediente; aquí solo
   * cambia dónde se monta.
   */
  const [modalHistorial, setModalHistorial] = useState(false);

  /** Orden de plantillas ortopédicas (solo podología). Se monta al abrir el modal
   * y se desmonta al cerrarlo — nunca vive de fondo, así hidrata limpio cada vez. */
  const [modalPlantillas, setModalPlantillas] = useState(false);
  const [modalReceta, setModalReceta] = useState(false);

  /**
   * Qué campos vienen de la IA y siguen sin revisar. Vive en el estado de la
   * pantalla y NO dentro de la nota: es información de esta sesión de edición
   * ("revisa esto antes de firmar"), no un dato del expediente. Al firmar, la
   * nota queda idéntica a una escrita a mano.
   */
  const [camposDeIa, setCamposDeIa] = useState<Set<CampoSugeribleIa>>(new Set());
  const [avisosIa, setAvisosIa] = useState<string[]>([]);

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  const note = useQuery({
    queryKey: ['note', appointmentId],
    queryFn: () => api.getConsultationNote(token!, appointmentId),
    enabled: !!token,
  });

  /**
   * Esta pantalla solo usa el expediente para dos cosas: la alerta de alergias
   * y las tres últimas consultas de la barra lateral. Pedía el historial
   * ENTERO para pintar tres líneas.
   *
   * Se piden 6 y no 3 porque de esas notas hay que descartar la de esta misma
   * consulta y las que sigan en borrador. Si aun así quedaran menos de tres,
   * se muestran las que haya: es un resumen de cortesía, y el expediente
   * completo está a un clic.
   *
   * Clave distinta de la del expediente (`…, 'resumen'`) para que esta página
   * reducida y la vista paginada del paciente no se pisen en la cache.
   */
  const record = useQuery({
    queryKey: ['clinical-record', patientId, 'resumen'],
    queryFn: () => api.getClinicalRecord(token!, patientId!, { limit: 6 }),
    enabled: !!token && !!patientId,
  });

  /**
   * Perfil del médico CONECTADO (distinto del perfil de la nota, más abajo):
   * de aquí sale la cédula con la que se va a firmar. Se pide al abrir la
   * consulta, no al hacer clic en firmar, para que el diálogo aparezca al
   * instante y no después de una espera.
   */
  const miPerfil = useQuery({
    queryKey: ['mi-perfil'],
    queryFn: () => api.getMyProfile(token!),
    enabled: !!token,
  });

  // Hidrata el contenido local una vez con lo que traiga el borrador.
  useEffect(() => {
    if (note.data && !hydrated.current) {
      setContent({ ...EMPTY_NOTA_EVOLUCION, ...note.data.contenido });
      setEsquema(note.data.esquema);
      setPendientes(note.data.pendientes);
      hydrated.current = true;
    }
  }, [note.data]);

  const readOnly = note.data?.estatus === 'cerrada';

  const guardarHistorial = useMutation({
    mutationFn: (h: HistorialPaciente) => api.updateHistorial(token!, patientId!, h),
    onSuccess: () => {
      // Refetch y no invalidate: la consulta necesita el dato fresco YA, en
      // esta misma pantalla, no en el próximo montaje.
      void record.refetch();
      setModalHistorial(false);
    },
  });

  const saveDraft = useMutation({
    mutationFn: (c: NotaEvolucionContent) => api.saveNoteDraft(token!, appointmentId, c),
    onSuccess: (r) => {
      setSavedAt(new Date());
      setEsquema(r.esquema);
      setPendientes(r.pendientes);
    },
  });

  // Autosave con debounce mientras la nota sea borrador.
  useEffect(() => {
    if (!hydrated.current || readOnly || !token) return;
    const t = setTimeout(() => saveDraft.mutate(content), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  const finish = useMutation({
    mutationFn: () => api.finishConsultation(token!, appointmentId, content),
    onSuccess: () => router.push('/sala-de-espera'),
    onError: (err) => {
      const errores = err instanceof ApiError ? (err.body as { errores?: ErrorCierre[] })?.errores : undefined;
      if (Array.isArray(errores)) {
        setPendientes(errores);
        setIntentoFirma(true);
      } else {
        alert(err instanceof ApiError ? err.message : 'Error al cerrar la nota');
      }
    },
  });

  /**
   * Mezcla la sugerencia de la IA sobre lo que ya hay en pantalla.
   *
   * Aditiva y conservadora: un campo que el médico ya escribió NO se pisa, y
   * los diagnósticos se suman a los suyos en vez de reemplazarlos. Que la IA
   * borre de un golpe lo que alguien tecleó es exactamente la forma de perder
   * su confianza para siempre.
   */
  const aplicarSugerencia = (sugerencia: SugerenciaNotaIa, advertencias: string[]) => {
    const tocados = new Set<CampoSugeribleIa>();

    setContent((c) => {
      const siguiente: NotaEvolucionContent = { ...c };

      if (sugerencia.padecimientoActual && !tieneValor(c.padecimientoActual)) {
        siguiente.padecimientoActual = sugerencia.padecimientoActual;
        tocados.add('padecimientoActual');
      }
      if (sugerencia.planTerapeutico && !tieneValor(c.planTerapeutico)) {
        siguiente.planTerapeutico = sugerencia.planTerapeutico;
        tocados.add('planTerapeutico');
      }

      const hallazgosNuevos =
        sugerencia.hallazgos && !tieneValor(c.exploracionFisica.hallazgos)
          ? sugerencia.hallazgos
          : undefined;
      // Solo los signos que el médico dejó vacíos: una cifra medida por él
      // manda siempre sobre una escuchada por el modelo.
      const vitales = { ...c.exploracionFisica.signosVitales };
      let cambioVital = false;
      for (const [k, v] of Object.entries(sugerencia.signosVitales ?? {})) {
        const key = k as keyof SignosVitales;
        if (v && !vitales[key]) {
          vitales[key] = v;
          cambioVital = true;
        }
      }
      if (hallazgosNuevos || cambioVital) {
        siguiente.exploracionFisica = {
          ...c.exploracionFisica,
          signosVitales: vitales,
          ...(hallazgosNuevos ? { hallazgos: hallazgosNuevos } : {}),
        };
        if (hallazgosNuevos) tocados.add('hallazgos');
        if (cambioVital) tocados.add('signosVitales');
      }

      const nuevos = (sugerencia.diagnosticos ?? []).filter(
        (d) => !c.diagnosticos.some((x) => x.cie10 === d.cie10),
      );
      if (nuevos.length > 0) {
        siguiente.diagnosticos = [...c.diagnosticos, ...nuevos];
        tocados.add('diagnosticos');
      }

      // Odontograma: se AGREGAN las marcas que no existan ya en esa pieza y
      // cara. Nunca se quita una marca del dentista ni se cambia la dentición
      // que él eligió: solo él sabe si está viendo una boca mixta.
      if (sugerencia.odontograma?.length) {
        const previo = c.odontograma ?? ODONTOGRAMA_VACIO;
        const clave = (m: { pieza: string; cara?: string }) => `${m.pieza}|${m.cara ?? ''}`;
        const yaMarcadas = new Set(previo.marcas.map(clave));
        const nuevas = sugerencia.odontograma.filter((m) => !yaMarcadas.has(clave(m)));
        if (nuevas.length > 0) {
          siguiente.odontograma = { ...previo, marcas: [...previo.marcas, ...nuevas] };
          tocados.add('odontograma');
        }
      }

      const extension = { ...(c.extension ?? {}) };
      let cambioExtension = false;
      for (const [k, v] of Object.entries(sugerencia.extension ?? {})) {
        const actual = extension[k];
        if (v !== null && v !== undefined && (actual === undefined || actual === null || actual === '')) {
          extension[k] = v;
          cambioExtension = true;
        }
      }
      if (cambioExtension) {
        siguiente.extension = extension;
        tocados.add('extension');
      }

      return siguiente;
    });

    setCamposDeIa(tocados);
    setAvisosIa(
      tocados.size === 0 && advertencias.length === 0
        ? ['La IA no encontró información nueva que agregar a lo que ya escribiste.']
        : advertencias,
    );
  };

  /** El médico revisó (o corrigió) un campo: deja de estar marcado como de IA. */
  const marcarRevisado = (campo: CampoSugeribleIa) =>
    setCamposDeIa((previos) => {
      if (!previos.has(campo)) return previos;
      const siguiente = new Set(previos);
      siguiente.delete(campo);
      return siguiente;
    });

  /**
   * Firmar. Si el médico todavía no tiene cédula registrada, se le pide AQUÍ
   * —en el único momento en que de verdad hace falta— y queda guardada para
   * siempre: es la última oportunidad de que la nota salga completa, porque
   * una vez cerrada ya no se puede tocar.
   *
   * Si el perfil no cargó (red caída, 500), no se estorba: se deja firmar. Un
   * médico bloqueado con la consulta abierta es peor que una nota sin cédula.
   */
  const firmar = () => {
    if (miPerfil.data && miPerfil.data.cedulaProfesional === null) {
      setModalCedula(true);
      return;
    }
    finish.mutate();
  };

  /**
   * El perfil sale de la NOTA, no del médico conectado: una nota firmada hace
   * seis meses debe seguir mostrando los campos con los que se firmó, aunque
   * su autor haya cambiado de especialidad desde entonces.
   */
  const perfil = useMemo(() => perfilDe(content.especialidad), [content.especialidad]);
  /**
   * Qué campos de la especialidad se muestran lo dice el esquema de la API, en
   * su orden; el catálogo sólo aporta cómo se ven (etiqueta, tipo, opciones).
   * Así un campo oculto nunca puede exigirse al cerrar sin que se vea.
   *
   * Va aquí ARRIBA, junto a los demás hooks: abajo hay un `return null`
   * mientras carga la sesión, y un hook después de él se saltaría en esos
   * renders y rompería el orden de hooks.
   */
  const camposVisibles = useMemo(
    () =>
      clavesExtension(esquema).flatMap((key) => {
        const def = perfil.camposExtra.find((c) => c.key === key);
        return def ? [def] : [];
      }),
    [esquema, perfil.camposExtra],
  );
  const bloquesVisibles = useMemo(() => bloquesDelEsquema(esquema, perfil), [esquema, perfil]);
  /** Declarar la omisión de T/A sólo se ofrece si la API la admite para esta nota. */
  const puedeOmitirVitales = !!campoDe(esquema, 'signosVitales.ta')?.estadosPermitidos.includes('no_valorado');
  const omitidos = puedeOmitirVitales && content.signosVitalesOmitidos === true;

  if (!ready || !token || !user) return null;

  /**
   * Cotizar es odontológico: el presupuesto se arma por pieza (notación FDI) y
   * nace del odontograma, así que a un internista o a un pediatra le aparecía
   * un panel que no puede llenar. Se gobierna con la MISMA condición que el
   * odontograma de arriba —la especialidad de la nota— y no con el rol solo.
   */
  const puedeCotizar =
    (user.rol === 'medico' || user.rol === 'admin') && !!patientId && perfil.key === 'odontologia';

  const resaltadas = intentoFirma ? pendientes.map((p) => p.ruta) : [];
  const isMissing = (field: string) => resaltadas.includes(field);
  const requerido = (ruta: string) => esRequerido(esquema, ruta);
  const pideAntecedentes = !!campoDe(esquema, 'antecedentesHeredofamiliares');
  const pideVerificacion = !!campoDe(esquema, 'verificacionAntecedentes');
  const plantillaV1 = !!esquema && esquema.plantillaVersion !== 'legacy-v0';

  const setNoCapturado = (ruta: string, valor: DatoNoCapturado | undefined) =>
    setContent((c) => {
      const siguiente = { ...(c.noCapturado ?? {}) };
      if (valor) siguiente[ruta] = valor;
      else delete siguiente[ruta];
      return { ...c, noCapturado: siguiente };
    });
  const setBloques = (actualizar: (b: BloquesNota) => BloquesNota) =>
    setContent((c) => ({ ...c, bloques: actualizar(c.bloques ?? {}) }));
  const setVital = (key: keyof SignosVitales, value: string) =>
    setContent((c) => ({
      ...c,
      exploracionFisica: {
        ...c.exploracionFisica,
        signosVitales: { ...c.exploracionFisica.signosVitales, [key]: value || null },
      },
    }));

  const addDiagnostico = (d: DiagnosticoCie10) =>
    setContent((c) =>
      c.diagnosticos.some((x) => x.cie10 === d.cie10)
        ? c
        : { ...c, diagnosticos: [...c.diagnosticos, d] },
    );
  const removeDiagnostico = (cie10: string) =>
    setContent((c) => ({ ...c, diagnosticos: c.diagnosticos.filter((d) => d.cie10 !== cie10) }));

  const setCampoExtra = (key: string, valor: string | number | null) =>
    setContent((c) => ({ ...c, extension: { ...(c.extension ?? {}), [key]: valor } }));

  /** Actualización funcional: no pierde marcas si llegan varios clics seguidos. */
  const setOdontograma = (actualizar: (previo: OdontogramaData) => OdontogramaData) =>
    setContent((c) => ({ ...c, odontograma: actualizar(c.odontograma ?? ODONTOGRAMA_VACIO) }));

  /** Igual que el odontograma, y por lo mismo: marcar rápido no puede perder marcas. */
  const setPodograma = (actualizar: (previo: PodogramaData) => PodogramaData) =>
    setContent((c) => ({ ...c, podograma: actualizar(c.podograma ?? PODOGRAMA_VACIO) }));

  /** El mapa corporal también usa actualización funcional para no perder puntos consecutivos. */
  const setMapaCorporal = (actualizar: (previo: MapaCorporalData) => MapaCorporalData) =>
    setContent((c) => ({
      ...c,
      mapaCorporal: actualizar(c.mapaCorporal ?? MAPA_CORPORAL_VACIO),
    }));

  /** Al desmarcar se limpia el motivo: no debe quedar huérfano en la nota. */
  const setOmision = (activo: boolean) =>
    setContent((c) => ({
      ...c,
      signosVitalesOmitidos: activo,
      motivoOmisionSignosVitales: activo ? c.motivoOmisionSignosVitales : undefined,
    }));

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Encabezado */}
      {/* En teléfono el encabezado se parte en dos filas: no cabe la fila
          única de escritorio y provocaba scroll horizontal. */}
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={() => router.push('/sala-de-espera')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
            ← Sala
          </button>
          <div>
            <p className="font-semibold">{record.data?.patientNombre ?? 'Consulta'}</p>
            <p className="text-xs text-slate-500">
              {content.tipoNota === 'historia_clinica' ? 'Historia clínica' : 'Nota de evolución'} ·{' '}
              {normaDe(perfil)} {readOnly && '· cerrada'}
            </p>
            {plantillaV1 && (
              <p className="text-xs text-brand-blue" data-testid="plantilla-nota">
                Plantilla {esquema.plantillaVersion}
                {esquema.contextoNota && ` · ${ETIQUETA_CONTEXTO[esquema.contextoNota]}`} · {perfil.nombre}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
          {/* Solo si la clínica lo contrató y solo para quien firma la nota. */}
          {!readOnly && miPerfil.data?.asistenteIaActivo && user.rol !== 'asistente' && (
            <GrabadorIa
              token={token}
              appointmentId={appointmentId}
              contenidoActual={content}
              onSugerencia={aplicarSugerencia}
            />
          )}
          {!readOnly && (
            <span className="text-slate-400">
              {saveDraft.isPending ? 'Guardando…' : savedAt ? `Guardado ${hace(savedAt)}` : 'Autoguardado activo'}
            </span>
          )}
          {!readOnly && (
            <button
              onClick={firmar}
              disabled={finish.isPending}
              className="rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2 font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
            >
              {finish.isPending ? 'Cerrando…' : '✓ Firmar y cerrar'}
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_280px]">
        {/* Columna del editor */}
        <div className="space-y-5">
          {/* Lo primero que se ve, antes que cualquier campo: si el paciente es
              alérgico a algo hay que saberlo ANTES de infiltrar, no después. */}
          {record.data && (
            <AlertaAlergias
              historial={record.data.historial}
              onCapturar={patientId ? () => setModalHistorial(true) : undefined}
            />
          )}

          {intentoFirma && pendientes.length > 0 && (
            <div
              role="alert"
              data-testid="error-cierre"
              className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
            >
              No se pudo firmar: faltan {pendientes.length} requisito(s). Revisa la lista de pendientes.
            </div>
          )}

          {(camposDeIa.size > 0 || avisosIa.length > 0) && (
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
              {camposDeIa.size > 0 && (
                <p className="font-medium">
                  ✨ La IA llenó {camposDeIa.size} sección(es). Revísalas antes de firmar — tú eres
                  quien responde por lo que dice el expediente.
                </p>
              )}
              {avisosIa.map((aviso) => (
                <p key={aviso} className="mt-1 text-violet-800">
                  {aviso}
                </p>
              ))}
            </div>
          )}

          {pideVerificacion && (
            <Section title="Antecedentes" required missing={resaltadas.some((r) => r.startsWith('verificacionAntecedentes'))}>
              <VerificacionAntecedentes
                content={content}
                referencia={note.data?.referenciaAntecedentes ?? null}
                setContent={setContent}
                readOnly={readOnly}
                errores={erroresDe(pendientes, 'verificacionAntecedentes')}
                resaltar={intentoFirma}
              />
            </Section>
          )}

          {pideAntecedentes && (
            <Section
              title="Antecedentes"
              required
              missing={
                isMissing('antecedentesHeredofamiliares') ||
                isMissing('antecedentesPersonalesPatologicos') ||
                isMissing('antecedentesPersonalesNoPatologicos')
              }
            >
              <div className="space-y-3">
                <CampoAntecedente
                  label="Heredofamiliares"
                  value={content.antecedentesHeredofamiliares ?? ''}
                  onChange={(v) => setContent((c) => ({ ...c, antecedentesHeredofamiliares: v }))}
                  readOnly={readOnly}
                  missing={isMissing('antecedentesHeredofamiliares')}
                />
                <CampoAntecedente
                  label="Personales patológicos"
                  value={content.antecedentesPersonalesPatologicos ?? ''}
                  onChange={(v) => setContent((c) => ({ ...c, antecedentesPersonalesPatologicos: v }))}
                  readOnly={readOnly}
                  missing={isMissing('antecedentesPersonalesPatologicos')}
                />
                <CampoAntecedente
                  label="Personales no patológicos"
                  placeholder="Hábitos, higiene, vacunación…"
                  value={content.antecedentesPersonalesNoPatologicos ?? ''}
                  onChange={(v) => setContent((c) => ({ ...c, antecedentesPersonalesNoPatologicos: v }))}
                  readOnly={readOnly}
                  missing={isMissing('antecedentesPersonalesNoPatologicos')}
                />
              </div>
            </Section>
          )}

          <Section title="Padecimiento actual" required={requerido('padecimientoActual')} missing={isMissing('padecimientoActual')}>
            <RichTextEditor
              value={content.padecimientoActual}
              onChange={(html) => setContent((c) => ({ ...c, padecimientoActual: html }))}
              editable={!readOnly}
              placeholder={textoDe(perfil, 'padecimientoActual').placeholder}
            />
          </Section>

          <Section
            title="Exploración física · Signos vitales"
            required={requerido('signosVitales.ta') && !omitidos}
            missing={isMissing('signosVitales.ta')}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {/* El perfil decide CUÁLES y en qué orden; 'ta' va siempre porque
                  NOM-004 la exige para cerrar en cualquier especialidad. */}
              {perfil.signosVitales.map((key) => (
                <label key={key} className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-slate-500">
                    {ETIQUETA_VITAL[key]}{' '}
                    {key === 'ta' && !omitidos && <span className="text-red-500">*</span>}
                  </span>
                  <input
                    value={content.exploracionFisica.signosVitales[key] ?? ''}
                    onChange={(e) => setVital(key, e.target.value)}
                    disabled={readOnly || omitidos}
                    className={`w-full rounded-lg border px-3 py-2 outline-none focus:border-brand-blue disabled:bg-slate-50 disabled:text-slate-400 ${
                      key === 'ta' && isMissing('signosVitales.ta') ? 'border-red-300' : 'border-slate-300'
                    }`}
                  />
                </label>
              ))}
            </div>

            {/* Escape declarado, solo donde el perfil lo permite. No vuelve el
                campo opcional: cambia "no lo llené" por "decidí no tomarlos",
                que es lo que queda escrito en el expediente. */}
            {puedeOmitirVitales && (
              <div className="mt-4 rounded-lg bg-slate-50 p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={omitidos}
                    disabled={readOnly}
                    onChange={(e) => setOmision(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    No se tomaron signos vitales en esta consulta
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Queda asentado en la nota. Recuerda que la NOM-013 los pide al inicio de cada
                      cita, y la T/A es la revisión previa a cualquier anestesia con vasoconstrictor.
                    </span>
                  </span>
                </label>

                {omitidos && (
                  <input
                    value={content.motivoOmisionSignosVitales ?? ''}
                    onChange={(e) =>
                      setContent((c) => ({ ...c, motivoOmisionSignosVitales: e.target.value }))
                    }
                    disabled={readOnly}
                    placeholder="Motivo (opcional): revisión sin procedimiento, paciente no coopera…"
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                )}
              </div>
            )}

            {/* Hallazgos de la exploración. Cada especialidad lo reetiqueta a
                lo suyo: "Exploración bucal", "Examen mental", etc. */}
            <div className="mt-4">
              <span className="mb-1 block text-xs font-medium text-slate-500">
                {textoDe(perfil, 'hallazgos').label}
              </span>
              <textarea
                value={content.exploracionFisica.hallazgos ?? ''}
                onChange={(e) =>
                  setContent((c) => ({
                    ...c,
                    exploracionFisica: { ...c.exploracionFisica, hallazgos: e.target.value },
                  }))
                }
                disabled={readOnly}
                rows={3}
                placeholder={textoDe(perfil, 'hallazgos').placeholder}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue disabled:bg-slate-50"
              />
            </div>
          </Section>

          {/* Solo donde tiene sentido: el odontograma lo dibuja el catálogo de
              la especialidad, no un `if` suelto en la página. */}
          {perfil.key === 'odontologia' && (
            <Section title="Odontograma">
              <div className="mb-3 flex items-center gap-2 text-xs">
                <label className="text-slate-500">Dentición</label>
                <select
                  value={content.odontograma?.denticion ?? 'permanente'}
                  onChange={(e) =>
                    setOdontograma((previo) => ({
                      ...previo,
                      denticion: e.target.value as 'permanente' | 'temporal' | 'mixta',
                    }))
                  }
                  disabled={readOnly}
                  className="rounded-lg border border-slate-300 px-2 py-1 outline-none focus:border-brand-blue disabled:bg-slate-50"
                >
                  <option value="permanente">Permanente</option>
                  <option value="temporal">Temporal (infantil)</option>
                </select>
              </div>
              <Odontograma
                valor={content.odontograma ?? ODONTOGRAMA_VACIO}
                onChange={setOdontograma}
                readOnly={readOnly}
              />
              {!readOnly && patientId && (
                <PresupuestarHallazgos
                  token={token}
                  patientId={patientId}
                  odontograma={content.odontograma ?? ODONTOGRAMA_VACIO}
                />
              )}
            </Section>
          )}

          {perfil.key === 'podologia' && (
            <Section title="Mapa podológico">
              <Podograma
                valor={content.podograma ?? PODOGRAMA_VACIO}
                onChange={setPodograma}
                readOnly={readOnly}
              />
            </Section>
          )}

          {perfil.key === 'heridas_estomas' && (
            <Section
              title="Ubicación anatómica de heridas y estomas"
              required={requerido('mapaCorporal')}
              missing={isMissing('mapaCorporal')}
            >
              <MapaCorporal
                valor={content.mapaCorporal ?? MAPA_CORPORAL_VACIO}
                onChange={setMapaCorporal}
                readOnly={readOnly}
              />
              {isMissing('mapaCorporal') && (
                <p className="mt-2 text-xs font-medium text-red-600">
                  Marca al menos una ubicación anatómica para cerrar la nota.
                </p>
              )}
            </Section>
          )}

          {camposVisibles.length > 0 && (
            <Section
              title={perfil.nombre}
              missing={resaltadas.some((m) => m.startsWith('extension.'))}
            >
              <CamposEspecialidad
                campos={camposVisibles}
                esquema={esquema}
                pendientes={pendientes}
                valores={content.extension ?? {}}
                onChange={setCampoExtra}
                noCapturado={content.noCapturado ?? {}}
                onNoCapturado={setNoCapturado}
                readOnly={readOnly}
                faltantes={resaltadas}
              />
            </Section>
          )}

          {bloquesVisibles.map(({ def, campo }) => (
            <Section
              key={def.bloque}
              title={def.label}
              required={campo.requisito === 'requerido'}
              missing={resaltadas.some((r) => r === campo.ruta || r.startsWith(`${campo.ruta}.`))}
            >
              <BloqueNota
                def={def}
                campo={campo}
                bloques={content.bloques ?? {}}
                onChange={setBloques}
                readOnly={readOnly}
                errores={erroresDe(pendientes, campo.ruta)}
              />
            </Section>
          ))}

          <Section title={textoDe(perfil, 'diagnosticos').label} required={requerido('diagnosticos')} missing={isMissing('diagnosticos')}>
            <DiagnosticoPicker
              token={token}
              seleccionados={content.diagnosticos}
              onAdd={addDiagnostico}
              onRemove={removeDiagnostico}
              readOnly={readOnly}
            />
          </Section>

          <Section title={textoDe(perfil, 'planTerapeutico').label} required={requerido('planTerapeutico')} missing={isMissing('planTerapeutico')}>
            <textarea
              value={content.planTerapeutico}
              onChange={(e) => setContent((c) => ({ ...c, planTerapeutico: e.target.value }))}
              disabled={readOnly}
              rows={4}
              placeholder={textoDe(perfil, 'planTerapeutico').placeholder}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue disabled:bg-slate-50"
            />
          </Section>
        </div>

        {/* Panel lateral */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Progreso</p>
            {readOnly ? (
              <p className="text-xs text-slate-500">Nota cerrada.</p>
            ) : (
              <PendientesFirma
                esquema={esquema}
                pendientes={pendientes}
                perfil={perfil}
                guardando={saveDraft.isPending}
              />
            )}
            {readOnly && note.data?.contenido.firma && (
              <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-emerald-800">
                <p className="font-medium">Firmada</p>
                <p className="text-xs">{note.data.contenido.firma.medicoNombre} · céd. {note.data.contenido.firma.cedula ?? '—'}</p>
              </div>
            )}

            {/* Solo podología: la orden de plantillas es una hoja de pedido a
                un laboratorio, no un instrumento de la nota (ver docs/adr/0001).
                Va al costado de Progreso porque es lo que el médico va
                llenando a lo largo de TODA la consulta, no una sección más
                del formulario. */}
            {/* La receta NO va condicionada a la especialidad, a diferencia
                de la orden de plantillas: prescribir es transversal a
                cualquier consultorio. Vive aquí, al costado de Progreso,
                porque el médico la emite al final de la consulta pero sin
                cerrar la nota — la receta tiene su propio ciclo de vida. */}
            <button
              type="button"
              onClick={() => setModalReceta(true)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <IconPill size={14} />
              Emitir receta
            </button>

            {perfil.key === 'podologia' && (
              <button
                type="button"
                onClick={() => setModalPlantillas(true)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                <IconClipboardList size={14} />
                Orden de plantillas ortopédicas
              </button>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Consultas previas</p>
            {record.data && record.data.notas.filter((n) => n.estatus === 'cerrada' && n.appointmentId !== appointmentId).length > 0 ? (
              <ul className="space-y-2">
                {record.data.notas
                  .filter((n) => n.estatus === 'cerrada' && n.appointmentId !== appointmentId)
                  .slice(0, 3)
                  .map((n) => (
                    <li key={n.id} className="border-l-2 border-slate-200 pl-2 text-slate-600">
                      <p className="text-xs text-slate-400">
                        {n.cerradoEn ? new Date(n.cerradoEn).toLocaleDateString('es-MX') : ''}
                      </p>
                      <p className="text-xs">
                        {(n.contenido.diagnosticos ?? []).map((d) => d.cie10).join(', ') || 'Sin diagnósticos'}
                      </p>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">Primera consulta registrada.</p>
            )}
          </div>

          {/* Cotizar sin salir de la consulta: antes había que ir al
              expediente (y de paso a la alerta de alergias) solo para armar
              un presupuesto. Aquí queda a un clic. */}
          {puedeCotizar && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Presupuesto
              </p>
              {presupuestoCreado ? (
                <div className="rounded-lg bg-emerald-50 p-3 text-emerald-800">
                  <p className="font-medium">{presupuestoCreado.titulo} creado</p>
                  <p className="text-xs">Total {pesos(presupuestoCreado.totalCentavos)}</p>
                  <a
                    href={`/pacientes/${patientId}`}
                    className="mt-1 inline-block text-xs font-medium underline hover:text-emerald-900"
                  >
                    Ver en el expediente →
                  </a>
                </div>
              ) : (
                <>
                  <p className="mb-3 text-xs text-slate-400">
                    Cotiza el tratamiento sin salir de la nota.
                  </p>
                  <button
                    onClick={() => setModalPresupuesto(true)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:border-brand-blue hover:text-brand-blue"
                  >
                    + Nuevo presupuesto
                  </button>
                </>
              )}
            </div>
          )}
        </aside>
      </div>

      {modalPresupuesto && patientId && (
        <NuevoPresupuestoModal
          token={token}
          paciente={{ id: patientId, nombre: record.data?.patientNombre ?? 'Paciente' }}
          onClose={() => setModalPresupuesto(false)}
          onCreado={(p) => setPresupuestoCreado(p)}
        />
      )}

      {modalHistorial && record.data && (
        <Modal
          titulo="Alergias y antecedentes"
          subtitulo={record.data.patientNombre}
          onClose={() => setModalHistorial(false)}
          ancho="max-w-2xl"
        >
          <EditorHistorial
            inicial={record.data.historial}
            guardando={guardarHistorial.isPending}
            onGuardar={(h) => guardarHistorial.mutate(h)}
            onCancelar={() => setModalHistorial(false)}
          />
          {guardarHistorial.isError && (
            <p className="mt-3 text-sm text-red-600">
              No se pudo guardar. Revisa tu conexión e intenta de nuevo.
            </p>
          )}
        </Modal>
      )}

      {modalReceta && patientId && (
        <RecetaModal
          token={token}
          patientId={patientId}
          appointmentId={appointmentId}
          historial={record.data?.historial}
          // Los diagnósticos ya capturados en la nota: el médico no debe
          // teclear el CIE-10 dos veces.
          diagnosticosIniciales={content.diagnosticos}
          onClose={() => setModalReceta(false)}
        />
      )}

      {modalPlantillas && (
        <OrdenPlantillasModal
          token={token}
          appointmentId={appointmentId}
          onClose={() => setModalPlantillas(false)}
        />
      )}

      {modalCedula && miPerfil.data && (
        <CedulaModal
          token={token}
          especialidadKey={miPerfil.data.especialidadKey}
          onClose={() => setModalCedula(false)}
          onGuardada={() => {
            setModalCedula(false);
            void miPerfil.refetch();
            finish.mutate();
          }}
        />
      )}
    </div>
  );
}

/**
 * Pide la cédula profesional justo antes de firmar la primera nota, y la deja
 * guardada en el perfil: se pregunta UNA vez en la vida de la cuenta.
 *
 * Se captura aquí y no solo en Ajustes porque este es el momento en que el dato
 * importa y en que el médico lo tiene presente. Nadie entra a Ajustes a llenar
 * un campo que todavía no le duele.
 */
function CedulaModal({
  token,
  especialidadKey,
  onClose,
  onGuardada,
}: {
  token: string;
  especialidadKey: EspecialidadKey;
  onClose: () => void;
  onGuardada: () => void;
}) {
  const [cedula, setCedula] = useState('');
  const [error, setError] = useState<string | null>(null);

  const guardar = useMutation({
    // Solo se manda la cédula: el backend conserva la etiqueta de agenda que
    // ya tuviera (ver update-perfil.use-case.ts).
    mutationFn: () => api.updatePerfil(token, { especialidadKey, cedulaProfesional: cedula.trim() }),
    onSuccess: onGuardada,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar la cédula'),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!cedula.trim()) {
      setError('Escribe tu cédula profesional para poder firmar.');
      return;
    }
    guardar.mutate();
  };

  return (
    <Modal
      titulo="Tu cédula profesional"
      subtitulo="Se guarda una sola vez. No te la volveremos a pedir."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm leading-relaxed text-slate-600">
          La NOM-004 exige que cada nota lleve el nombre y la cédula de quien la firma. Se va a
          estampar en esta nota y en todas las que cierres después.
        </p>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Cédula profesional</span>
          <input
            value={cedula}
            onChange={(e) => setCedula(e.target.value)}
            placeholder="1234567"
            maxLength={40}
            autoFocus
            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
          />
          <span className="mt-1 block text-xs text-slate-400">
            Después la puedes corregir desde Ajustes.
          </span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardar.isPending}
            className="rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar y firmar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Convierte los hallazgos marcados en un presupuesto borrador.
 *
 * Está aquí, dentro de la consulta, porque es el momento en que el dentista
 * tiene la boca del paciente enfrente y sabe qué hay que hacer. Obligarlo a ir
 * al expediente y recapturar pieza por pieza es donde se pierde la venta.
 */
function PresupuestarHallazgos({
  token,
  patientId,
  odontograma,
}: {
  token: string;
  patientId: string;
  odontograma: OdontogramaData;
}) {
  const router = useRouter();
  const sugeridas = useMemo(() => partidasDesdeOdontograma(odontograma), [odontograma]);

  const crear = useMutation({
    mutationFn: () =>
      api.crearPresupuesto(token, {
        patientId,
        titulo: 'Plan de tratamiento',
        partidas: sugeridas,
      }),
    // Se manda al expediente porque ahí es donde se ponen los precios y se
    // presenta al paciente; el presupuesto nace en borrador y sin importes.
    onSuccess: () => router.push(`/pacientes/${patientId}`),
  });

  if (sugeridas.length === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3">
      <div className="text-sm">
        <p className="font-medium">
          {sugeridas.length} hallazgo{sugeridas.length === 1 ? '' : 's'} por tratar
        </p>
        <p className="text-xs text-slate-500">
          {sugeridas.map((p) => `${p.descripcion} ${p.piezas?.[0]}`).join(' · ')}
        </p>
      </div>
      <button
        type="button"
        onClick={() => crear.mutate()}
        disabled={crear.isPending}
        className="ml-auto rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {crear.isPending ? 'Creando…' : 'Presupuestar'}
      </button>
      {crear.isError && (
        <p className="w-full text-sm text-red-600">No se pudo crear el presupuesto.</p>
      )}
    </div>
  );
}

function Section({
  title,
  required,
  missing,
  children,
}: {
  title: string;
  required?: boolean;
  missing?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-2xl border bg-white p-5 ${missing ? 'border-red-300' : 'border-slate-200'}`}>
      <h2 className="mb-3 font-semibold">
        {title} {required && <span className="text-xs font-normal text-amber-600">· Obligatorio</span>}
      </h2>
      {children}
    </section>
  );
}

function CampoAntecedente({
  label,
  placeholder,
  value,
  onChange,
  readOnly,
  missing,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  missing?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-slate-500">
        {label} <span className="text-red-500">*</span>
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={readOnly}
        rows={2}
        placeholder={placeholder}
        className={`w-full rounded-lg border px-3 py-2 outline-none focus:border-brand-blue disabled:bg-slate-50 ${
          missing ? 'border-red-300' : 'border-slate-300'
        }`}
      />
    </label>
  );
}

function DiagnosticoPicker({
  token,
  seleccionados,
  onAdd,
  onRemove,
  readOnly,
}: {
  token: string;
  seleccionados: DiagnosticoCie10[];
  onAdd: (d: DiagnosticoCie10) => void;
  onRemove: (cie10: string) => void;
  readOnly?: boolean;
}) {
  const [q, setQ] = useState('');

  // Debounce ligero para no disparar una búsqueda por cada tecla (mismo
  // patrón que el buscador de pacientes).
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const busqueda = useQuery({
    queryKey: ['cie10', debounced],
    queryFn: () => api.buscarCie10(token, debounced),
    enabled: debounced.trim().length >= 2,
  });
  const resultados = busqueda.data ?? [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {seleccionados.map((d) => (
          <span key={d.cie10} className="inline-flex items-center gap-2 rounded-lg bg-brand-blue/10 px-2.5 py-1 text-sm text-brand-blue">
            <strong>{d.cie10}</strong> {d.descripcion}
            {!readOnly && (
              <button onClick={() => onRemove(d.cie10)} className="text-brand-blue/60 hover:text-brand-blue">✕</button>
            )}
          </span>
        ))}
        {seleccionados.length === 0 && <span className="text-sm text-slate-400">Sin diagnósticos.</span>}
      </div>
      {!readOnly && (
        <div className="relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar diagnóstico o código CIE-10…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue"
          />
          {debounced.trim().length >= 2 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
              {busqueda.isFetching ? (
                <li className="px-3 py-2 text-sm text-slate-400">Buscando…</li>
              ) : resultados.length > 0 ? (
                resultados.map((d) => (
                  <li key={d.cie10}>
                    <button
                      onClick={() => {
                        onAdd(d);
                        setQ('');
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold">{d.cie10}</span>
                      {d.descripcion}
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-sm text-slate-400">Sin resultados.</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

/**
 * ¿El médico ya escribió algo aquí? Sólo decide si la IA puede llenar el
 * campo sin pisar lo tecleado; qué exige la firma lo dice la API.
 */
function tieneValor(v: string | number | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  return stripHtml(v).length > 0;
}

function hace(date: Date): string {
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 5) return 'ahora';
  if (s < 60) return `hace ${s}s`;
  return `hace ${Math.round(s / 60)}min`;
}
