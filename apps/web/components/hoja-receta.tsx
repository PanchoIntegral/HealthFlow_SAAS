'use client';

import {
  CONFIG_RECETA_DEFAULT,
  ETIQUETAS_SEXO,
  nombreConTitulo,
  type ConfigReceta,
  type RecetaDetalle,
} from '@healthflow/shared-types';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

/** Alto del logo por tamaño configurado. Clases literales: Tailwind no ve las interpoladas. */
const CLASE_LOGO: Record<ConfigReceta['logoTamano'], string> = {
  chico: 'h-12 w-12 print:h-10 print:w-10',
  mediano: 'h-16 w-16 print:h-14 print:w-14',
  grande: 'h-24 w-24 print:h-20 print:w-20',
};

/**
 * La hoja impresa de la receta. Componente propio y no parte de la página
 * porque Ajustes lo usa TAL CUAL para la vista previa: si la previa fuera una
 * copia del maquetado, se separarían al primer cambio y el médico configuraría
 * mirando algo que no es lo que se imprime.
 *
 * `config` gobierna la APARIENCIA. Los datos que exige el art. 64 del RIS
 * —nombre y cédula del médico, institución del título, domicilio del
 * establecimiento— se imprimen siempre y no dependen de ella.
 */
export function HojaReceta({ receta }: { receta: RecetaDetalle }) {
  const { emisor, paciente, diagnosticos, medicamentos, indicacionesGenerales, alergiasSnapshot } =
    receta.contenido;
  // Recetas emitidas antes de que la apariencia fuera configurable no traen
  // config: se imprimen con los valores de siempre.
  const config = emisor.config ?? CONFIG_RECETA_DEFAULT;
  const acento = config.colorAcento ?? undefined;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-8 text-sm print:rounded-none print:border-0 print:p-0">
      {/* La marca de cancelación se imprime TAMBIÉN en papel: ocultarla no
          borra la copia que ya circula, y quien reciba esta hoja tiene que
          poder ver que dejó de ser válida. */}
      {receta.cancelacion && (
        <div className="mb-6 rounded-lg border-2 border-red-600 px-4 py-3 text-center">
          <p className="text-base font-bold uppercase tracking-wide text-red-700">
            Receta cancelada
          </p>
          <p className="mt-0.5 text-xs text-red-700">
            {receta.cancelacion.motivo} · {fecha(receta.cancelacion.fecha)}
          </p>
        </div>
      )}

      {/* Papel con membrete preimpreso: se reserva el espacio de arriba para
          que el encabezado del sistema no caiga encima del que ya trae la hoja. */}
      {config.papelMembretado && <div className="h-24 print:h-32" aria-hidden />}

      <header
        className="mb-6 flex gap-4 border-b pb-4"
        style={{ borderColor: acento ?? undefined }}
      >
        {!config.papelMembretado && emisor.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={emisor.logoUrl}
            alt=""
            className={`shrink-0 object-contain ${CLASE_LOGO[config.logoTamano]}`}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Receta médica</p>
          {/* Con papel membretado, la hoja ya trae el nombre y el domicilio del
              establecimiento: repetirlos duplicaría el encabezado. */}
          {!config.papelMembretado && (
            <h1 className="mt-1 text-xl font-bold" style={{ color: acento }}>
              {emisor.nombreClinica}
            </h1>
          )}
          {/* Se omite la línea entera si faltan los datos, en vez de imprimir
              "—": un membrete con guiones se ve como un documento a medias. */}
          {!config.papelMembretado && (emisor.domicilioEstablecimiento || emisor.telefonoClinica) && (
            <p className="mt-0.5 text-xs text-slate-500">
              {[
                emisor.domicilioEstablecimiento,
                emisor.telefonoClinica ? `Tel: ${emisor.telefonoClinica}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          <div className="mt-3 flex items-end justify-between gap-6">
            <div>
              <p className="font-semibold text-slate-800">
                {/* Recetas emitidas antes de este campo no traen título: se
                    imprimen igual que siempre, solo con el nombre. */}
                {nombreConTitulo(emisor.titulo, emisor.medicoNombre)}
              </p>
              {config.mostrarEspecialidad && emisor.especialidad && (
                <p className="text-xs text-slate-500">{emisor.especialidad}</p>
              )}
              {/* Los tres datos que exige el art. 64 del RIS, juntos. */}
              <p className="mt-0.5 text-xs text-slate-600">
                Céd. prof. {emisor.cedulaProfesional}
                {emisor.cedulaEspecialidad ? ` · Céd. esp. ${emisor.cedulaEspecialidad}` : ''}
              </p>
              <p className="text-xs text-slate-600">{emisor.institucionTitulo}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs uppercase tracking-wide text-slate-400">Folio</p>
              <p className="font-mono font-semibold text-slate-800">{receta.folio}</p>
              <p className="mt-0.5 text-xs text-slate-500">{fecha(receta.createdAt)}</p>
            </div>
          </div>
        </div>
      </header>

      <section className="mb-5 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        <Dato label="Paciente" ancho={2}>
          {paciente.nombre}
        </Dato>
        <Dato label="Edad">{paciente.edad} años</Dato>
        <Dato label="Sexo">{ETIQUETAS_SEXO[paciente.sexo]}</Dato>
      </section>

      {diagnosticos.length > 0 && (
        <section className="mb-5">
          <h2
            className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400"
            style={{ color: acento }}
          >
            Diagnóstico
          </h2>
          {diagnosticos.map((d) => (
            <p key={d.cie10} className="text-slate-800">
              {d.descripcion} <span className="text-slate-400">({d.cie10})</span>
            </p>
          ))}
        </section>
      )}

      {alergiasSnapshot.length > 0 && (
        <section className="mb-5 rounded-lg border border-red-300 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Alergias</p>
          <p className="text-red-800">{alergiasSnapshot.join(' · ')}</p>
        </section>
      )}

      <section className="mb-6">
        <h2
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400"
          style={{ color: acento }}
        >
          Prescripción
        </h2>
        <ol className="space-y-3">
          {medicamentos.map((m, i) => (
            // break-inside-avoid: un medicamento partido entre dos hojas es
            // exactamente el error que causa una dosis mal leída.
            <li key={i} className="break-inside-avoid border-l-2 border-slate-200 pl-3">
              <p className="font-semibold text-slate-900">
                {m.denominacionGenerica}
                {m.denominacionDistintiva && (
                  <span className="font-normal text-slate-500"> ({m.denominacionDistintiva})</span>
                )}
              </p>
              <p className="text-slate-700">{m.presentacion}</p>
              {/* Los datos del art. 29 en un renglón, en el orden en que se
                  leen en voz alta al paciente. */}
              <p className="text-slate-700">
                {m.dosis} · vía {m.via.toLowerCase()} · {m.frecuencia} · {m.duracion}
              </p>
              {m.indicaciones && (
                <p className="mt-0.5 text-xs italic text-slate-600">{m.indicaciones}</p>
              )}
            </li>
          ))}
        </ol>
      </section>

      {indicacionesGenerales && (
        <section className="mb-6 break-inside-avoid">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Indicaciones generales
          </h2>
          <p className="whitespace-pre-line text-slate-800">{indicacionesGenerales}</p>
        </section>
      )}

      <footer className="mt-16 break-inside-avoid">
        <div className="mx-auto w-72 border-t border-slate-400 pt-1 text-center text-xs text-slate-500">
          Firma autógrafa del médico
        </div>
        {config.mostrarLeyendaPie && emisor.leyendaPie && (
          <p className="mt-8 whitespace-pre-line text-center text-xs text-slate-400">
            {emisor.leyendaPie}
          </p>
        )}
      </footer>
    </article>
  );
}

/**
 * Las clases de ancho van literales y no interpoladas: Tailwind escanea el
 * código fuente y no detecta `sm:col-span-${n}`.
 */
function Dato({
  label,
  children,
  ancho = 1,
}: {
  label: string;
  children: React.ReactNode;
  ancho?: 1 | 2 | 4;
}) {
  const span = ancho === 4 ? 'sm:col-span-4' : ancho === 2 ? 'sm:col-span-2' : '';
  return (
    <div className={span}>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-slate-800">{children}</p>
    </div>
  );
}
