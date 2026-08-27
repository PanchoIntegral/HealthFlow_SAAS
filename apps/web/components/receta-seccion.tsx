'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CONFIG_RECETA_DEFAULT,
  MIME_TYPES_LOGO_CLINICA,
  type ConfigReceta,
  type MimeTypeLogoClinica,
} from '@healthflow/shared-types';
import { api, ApiError } from '../lib/api';
import { ErrorSubidaDirecta, subirArchivoDirecto } from '../lib/subida-directa';
import {
  CampoFirma,
  ControlesApariencia,
  PreviaReceta,
  recetaDeEjemplo,
} from './receta-personalizacion';

const CAMPO =
  'w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 disabled:bg-slate-50';
const BOTON =
  'rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2.5 font-semibold text-white transition hover:opacity-95 disabled:opacity-50';

/**
 * Personalización de la receta impresa: nombre y logo de la clínica, leyenda
 * al pie y apariencia de la hoja, con vista previa en vivo.
 * Solo el titular la ve (mismo filtro que Facturación en ajustes/page.tsx).
 *
 * La subida del logo NUNCA pasa por nuestro API — mismo patrón que
 * RadiografiaPanel: se pide una política prefirmada, el navegador sube el
 * archivo DIRECTO a storage, y solo entonces se confirma la metadata.
 */
export function RecetaSeccion({ token }: { token: string }) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [errorLogo, setErrorLogo] = useState<string | null>(null);
  const [leyendaPie, setLeyendaPie] = useState('');
  const [nombreClinica, setNombreClinica] = useState('');
  const [direccion, setDireccion] = useState('');
  const [telefono, setTelefono] = useState('');
  const [config, setConfig] = useState<ConfigReceta>(CONFIG_RECETA_DEFAULT);
  const [guardado, setGuardado] = useState(false);
  /** Marca que hay cambios sin guardar: enciende el botón y avisa al salir. */
  const [sucio, setSucio] = useState(false);

  const datos = useQuery({
    queryKey: ['datos-clinica-logo'],
    queryFn: () => api.obtenerDatosClinica(token),
  });

  // Se sincroniza el textarea solo cuando llega el valor guardado, sin pisar
  // lo que el usuario ya esté tecleando si react-query refresca detrás.
  useEffect(() => {
    if (!datos.data) return;
    setLeyendaPie(datos.data.leyendaPie ?? '');
    setNombreClinica(datos.data.nombreClinica);
    setDireccion(datos.data.direccion ?? '');
    setTelefono(datos.data.telefono ?? '');
    setConfig(datos.data.configReceta);
  }, [datos.data]);

  // El perfil da los datos del MÉDICO que la previa necesita (nombre, cédulas,
  // institución): el membrete no es solo de la clínica.
  const perfil = useQuery({
    queryKey: ['perfil-para-previa'],
    queryFn: () => api.getMyProfile(token),
  });

  const refrescar = () => qc.invalidateQueries({ queryKey: ['datos-clinica-logo'] });

  const guardar = useMutation({
    mutationFn: () =>
      api.actualizarDatosClinica(token, {
        leyendaPie: leyendaPie.trim(),
        nombreClinica: nombreClinica.trim(),
        direccion: direccion.trim(),
        telefono: telefono.trim(),
        configReceta: config,
      }),
    onSuccess: () => {
      setGuardado(true);
      setSucio(false);
      refrescar();
    },
  });

  /** Un solo punto de cambio: cualquier control marca sucio y borra el "guardado". */
  const editar = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setSucio(true);
    setGuardado(false);
  };

  const quitarLogo = useMutation({
    mutationFn: () => api.eliminarLogo(token),
    onSuccess: refrescar,
  });

  async function onArchivoSeleccionado(file: File) {
    setErrorLogo(null);
    if (!MIME_TYPES_LOGO_CLINICA.includes(file.type as MimeTypeLogoClinica)) {
      setErrorLogo('Solo se aceptan imágenes JPEG o PNG.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setErrorLogo('El logo no puede superar 2MB.');
      return;
    }

    setSubiendo(true);
    try {
      const mimeType = file.type as MimeTypeLogoClinica;
      const { uploadUrl, headers, storageKey } = await api.requestLogoUploadUrl(token, { mimeType });

      await subirArchivoDirecto(uploadUrl, headers, file);

      await api.confirmLogo(token, { storageKey, mimeType });
      refrescar();
    } catch (e) {
      if (e instanceof ErrorSubidaDirecta) console.error('[logo] subida fallida:', e.causa, e.detalle);
      setErrorLogo(
        e instanceof ErrorSubidaDirecta || e instanceof ApiError ? e.message : 'No se pudo subir el logo',
      );
    } finally {
      setSubiendo(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }


  const loading = datos.isLoading;

  /*
    Dos columnas solo a partir de 2xl: con el menú de la app y la navegación de
    ajustes, en 1280px a la hoja le quedaban 240px y volvía a partir el nombre
    del médico en tres renglones — justo el problema que este rediseño venía a
    resolver. Por debajo de ese ancho la previa baja y se lleva la fila entera.

    `grid-cols-[minmax(0,1fr)]` y no `grid-cols-1`: una columna de grid mide por
    omisión su contenido mínimo, y la hoja de 794px estiraba la página entera en
    pantallas angostas en vez de desplazarse dentro de su propia caja.
  */
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-6 2xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      {/* ── Columna de controles ───────────────────────────────────── */}
      {/* max-w mientras van en una sola columna: un campo de texto de mil
          píxeles de ancho es incómodo de leer y de llenar. */}
      <div className="w-full max-w-2xl space-y-4 2xl:max-w-none">
        <Bloque
          titulo="Membrete"
          ayuda="Encabeza cada receta. Las ya emitidas conservan el suyo: son documentos congelados."
        >
          <div className="flex items-start gap-4">
            <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50">
              {loading ? (
                <span className="text-xs text-slate-400">…</span>
              ) : datos.data?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={datos.data.logoUrl}
                  alt="Logo de la clínica"
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="px-2 text-center text-xs text-slate-400">Sin logo</span>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Nombre de la clínica</span>
                <input
                  value={nombreClinica}
                  onChange={(e) => editar(setNombreClinica)(e.target.value)}
                  disabled={loading}
                  maxLength={120}
                  placeholder="p.ej. Unidad Médica Pisada Sana"
                  className={CAMPO}
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Dirección</span>
                  <input
                    value={direccion}
                    onChange={(e) => editar(setDireccion)(e.target.value)}
                    disabled={loading}
                    maxLength={200}
                    placeholder="Av. Madero #1327, Col. Centro"
                    className={CAMPO}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Teléfono</span>
                  <input
                    value={telefono}
                    onChange={(e) => editar(setTelefono)(e.target.value)}
                    disabled={loading}
                    maxLength={40}
                    placeholder="686 554 1920"
                    className={CAMPO}
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="cursor-pointer font-medium text-brand-blue hover:underline">
                  {subiendo ? 'Subiendo…' : datos.data?.logoUrl ? 'Cambiar logo' : 'Subir logo'}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={MIME_TYPES_LOGO_CLINICA.join(',')}
                    disabled={subiendo || loading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void onArchivoSeleccionado(file);
                    }}
                    className="hidden"
                  />
                </label>
                {datos.data?.logoUrl && (
                  <button
                    type="button"
                    disabled={quitarLogo.isPending}
                    onClick={() => quitarLogo.mutate()}
                    className="font-medium text-slate-400 hover:text-red-600 disabled:opacity-50"
                  >
                    {quitarLogo.isPending ? 'Quitando…' : 'Quitar'}
                  </button>
                )}
                <span className="text-xs text-slate-400">JPEG o PNG, máx. 2MB</span>
              </div>
            </div>
          </div>

          {errorLogo && <p className="mt-3 text-sm text-red-600">{errorLogo}</p>}
        </Bloque>

        <Bloque
          titulo="Apariencia"
          ayuda="Los datos que la ley exige —tu nombre, tu cédula, la institución de tu título y el domicilio del consultorio— se imprimen siempre."
        >
          <ControlesApariencia
            config={config}
            disabled={loading}
            onChange={editar(setConfig)}
          />
        </Bloque>

        <Bloque titulo="Pie de la receta">
          <div className="space-y-4">
            <CampoFirma config={config} disabled={loading} onChange={editar(setConfig)} />
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Leyenda al pie</span>
              <textarea
                value={leyendaPie}
                onChange={(e) => editar(setLeyendaPie)(e.target.value)}
                disabled={loading}
                maxLength={300}
                rows={3}
                placeholder="p.ej. Horario de atención: lunes a viernes 9:00–18:00"
                className={CAMPO}
              />
              <span className="mt-1 block text-xs text-slate-400">
                Horario, redes sociales o un aviso legal. {300 - leyendaPie.length} caracteres
                restantes.
              </span>
            </label>
          </div>
        </Bloque>

        {/* Barra de guardado: pegada abajo mientras se configura, porque los
            controles son más altos que la pantalla y el botón quedaba fuera. */}
        <div className="sticky bottom-0 -mx-1 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {guardar.error ? (
                <span className="text-red-600">
                  {guardar.error instanceof ApiError
                    ? guardar.error.message
                    : 'Error de conexión'}
                </span>
              ) : guardado ? (
                <span className="text-emerald-600">Cambios guardados.</span>
              ) : sucio ? (
                'Tienes cambios sin guardar.'
              ) : (
                'Aplica a las recetas que emitas de ahora en adelante.'
              )}
            </p>
            <button
              type="button"
              disabled={loading || guardar.isPending || !sucio}
              onClick={() => guardar.mutate()}
              className={BOTON}
            >
              {guardar.isPending ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Vista previa ───────────────────────────────────────────── */}
      {perfil.data && (
        <div className="min-w-0 2xl:sticky 2xl:top-8">
          <PreviaReceta
            receta={recetaDeEjemplo(
              {
                nombreClinica,
                direccion: direccion || null,
                telefono: telefono || null,
                leyendaPie,
                logoUrl: datos.data?.logoUrl ?? null,
                medicoNombre: perfil.data.nombre,
                titulo: perfil.data.titulo,
                cedulaProfesional: perfil.data.cedulaProfesional ?? '',
                cedulaEspecialidad: perfil.data.cedulaEspecialidad,
                especialidad: perfil.data.especialidad,
                institucionTitulo: perfil.data.institucionTitulo ?? '',
              },
              config,
            )}
          />
        </div>
      )}
    </div>
  );
}

/** Tarjeta de un grupo de opciones. Un solo patrón para toda la sección. */
function Bloque({
  titulo,
  ayuda,
  children,
}: {
  titulo: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-semibold text-slate-800">{titulo}</h3>
      {ayuda && <p className="mb-4 mt-0.5 text-sm text-slate-500">{ayuda}</p>}
      {!ayuda && <div className="mb-4" />}
      {children}
    </section>
  );
}
