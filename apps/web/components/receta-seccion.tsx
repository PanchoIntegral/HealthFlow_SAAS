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
  ControlesApariencia,
  EtiquetasSecciones,
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
  const [config, setConfig] = useState<ConfigReceta>(CONFIG_RECETA_DEFAULT);
  const [guardadoLeyenda, setGuardadoLeyenda] = useState(false);

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
    setConfig(datos.data.configReceta);
  }, [datos.data]);

  // El perfil da los datos del MÉDICO que la previa necesita (nombre, cédulas,
  // institución): el membrete no es solo de la clínica.
  const perfil = useQuery({
    queryKey: ['perfil-para-previa'],
    queryFn: () => api.getMyProfile(token),
  });

  const refrescar = () => qc.invalidateQueries({ queryKey: ['datos-clinica-logo'] });

  const guardarLeyenda = useMutation({
    mutationFn: () =>
      api.actualizarDatosClinica(token, {
        leyendaPie: leyendaPie.trim(),
        nombreClinica: nombreClinica.trim(),
        configReceta: config,
      }),
    onSuccess: () => {
      setGuardadoLeyenda(true);
      refrescar();
    },
  });

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

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 font-semibold">Logo de la clínica</h2>
        <p className="mb-4 text-sm text-slate-500">
          Se imprime en el membrete de cada receta nueva. Las recetas ya emitidas conservan el
          membrete con el que se imprimieron — es un documento congelado, no se actualiza
          retroactivamente.
        </p>

        <div className="flex items-center gap-4">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50">
            {loading ? (
              <span className="text-xs text-slate-400">…</span>
            ) : datos.data?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={datos.data.logoUrl} alt="Logo de la clínica" className="h-full w-full object-contain" />
            ) : (
              <span className="px-2 text-center text-xs text-slate-400">Sin logo</span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="cursor-pointer text-sm font-medium text-brand-blue hover:underline">
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
                className="text-left text-sm font-medium text-slate-400 hover:text-red-600 disabled:opacity-50"
              >
                {quitarLogo.isPending ? 'Quitando…' : 'Quitar logo'}
              </button>
            )}
            <span className="text-xs text-slate-400">JPEG o PNG, máximo 2MB.</span>
          </div>
        </div>

        {errorLogo && <p className="mt-3 text-sm text-red-600">{errorLogo}</p>}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 font-semibold">Nombre de la clínica</h2>
        <p className="mb-3 text-sm text-slate-500">
          Encabeza el membrete de la receta. El artículo 64 del Reglamento de Insumos para la
          Salud lo exige, así que no puede quedar vacío.
        </p>
        <input
          value={nombreClinica}
          onChange={(e) => {
            setNombreClinica(e.target.value);
            setGuardadoLeyenda(false);
          }}
          disabled={loading}
          maxLength={120}
          placeholder="p.ej. Unidad Médica Pisada Sana"
          className={CAMPO}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 font-semibold">Leyenda al pie</h2>
        <p className="mb-4 text-sm text-slate-500">
          Texto libre para el pie de la receta impresa — horario de atención, redes sociales, un
          aviso legal. Opcional.
        </p>
        <textarea
          value={leyendaPie}
          onChange={(e) => {
            setLeyendaPie(e.target.value);
            setGuardadoLeyenda(false);
          }}
          disabled={loading}
          maxLength={300}
          rows={3}
          placeholder="p.ej. Horario de atención: lunes a viernes 9:00–18:00"
          className={CAMPO}
        />
        <div className="mt-1 flex justify-between text-xs text-slate-400">
          <span>{300 - leyendaPie.length} caracteres restantes</span>
        </div>

        {guardarLeyenda.error && (
          <p className="mt-2 text-sm text-red-600">
            {guardarLeyenda.error instanceof ApiError ? guardarLeyenda.error.message : 'Error de conexión'}
          </p>
        )}
        {guardadoLeyenda && <p className="mt-2 text-sm text-emerald-600">Cambios guardados.</p>}

        <button
          type="button"
          disabled={loading || guardarLeyenda.isPending}
          onClick={() => guardarLeyenda.mutate()}
          className={`mt-4 ${BOTON}`}
        >
          {guardarLeyenda.isPending ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>

      {/*
        Apariencia y previa, lado a lado: el médico ve el efecto de cada
        control en la hoja real —el mismo componente que se imprime— en vez de
        configurar a ciegas y tener que emitir una receta para enterarse.
      */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 font-semibold">Apariencia de la receta</h2>
        <p className="mb-4 text-sm text-slate-500">
          Cambia cómo se ve la hoja impresa. Los datos que la ley exige —tu nombre, tu cédula, la
          institución de tu título y el domicilio del consultorio— se imprimen siempre.
        </p>

        <div className="grid gap-6 lg:grid-cols-2">
          <ControlesApariencia
            config={config}
            disabled={loading}
            onChange={(actualizar) => {
              setConfig(actualizar);
              setGuardadoLeyenda(false);
            }}
          />

          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-600">Títulos de la receta</h3>
            <EtiquetasSecciones
              config={config}
              disabled={loading}
              onChange={(actualizar) => {
                setConfig(actualizar);
                setGuardadoLeyenda(false);
              }}
            />
            <p className="mt-2 text-xs text-slate-400">
              Déjalos vacíos para usar los títulos por omisión.
            </p>
          </div>
        </div>

        {/* La previa va a lo ancho, debajo de los controles: es una hoja tamaño
            carta, y en media columna se deformaba. */}
        {perfil.data && (
          <div className="mt-6">
            <PreviaReceta
              receta={recetaDeEjemplo(
                {
                  nombreClinica,
                  direccion: datos.data?.direccion ?? null,
                  telefono: datos.data?.telefono ?? null,
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

        <p className="mt-4 text-xs text-slate-400">
          Los cambios aplican a las recetas que emitas de ahora en adelante. Las ya emitidas
          conservan el diseño con el que se firmaron.
        </p>
      </div>
    </div>
  );
}
