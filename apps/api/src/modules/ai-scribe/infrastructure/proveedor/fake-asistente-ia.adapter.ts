import { Injectable } from '@nestjs/common';
import type { SignosVitales } from '@healthflow/shared-types';
import { construirPrompt } from '../../application/prompt-builder';
import { AsistenteIaNoDisponibleError } from '../../domain/asistente-ia.errors';
import type {
  AsistenteClinicoIaPort,
  ExtraccionClinicaRequest,
  ExtraccionClinicaResult,
} from '../../domain/asistente-clinico-ia.port';

/**
 * Asistente simulado: sin red, sin costo, determinista.
 *
 * Es el adaptador por omisión en dev y en tests. Devuelve una extracción de
 * ejemplo coherente con el perfil recibido, para poder recorrer el flujo
 * completo —grabar, subir, mezclar en el formulario, revisar y firmar— sin
 * mandarle un solo byte a Google ni gastar en cada recarga de la página.
 *
 * Expone estado inspeccionable (`lastRequest`, `lastPrompt`, `nextResult`,
 * `shouldFail`) igual que FakePacAdapter: los tests afirman sobre lo que se le
 * pidió al modelo, no solo sobre lo que devolvió.
 */
@Injectable()
export class FakeAsistenteClinicoIaAdapter implements AsistenteClinicoIaPort {
  /** Lo que devolverá la próxima llamada. Null ⇒ ejemplo derivado del perfil. */
  nextResult: ExtraccionClinicaResult | null = null;
  shouldFail = false;
  lastRequest: ExtraccionClinicaRequest | null = null;
  /** El prompt exacto que se habría mandado — para afirmar sobre él en tests. */
  lastPrompt: string | null = null;

  async extraer(req: ExtraccionClinicaRequest): Promise<ExtraccionClinicaResult> {
    this.lastRequest = req;
    this.lastPrompt = construirPrompt(req.perfil, req.camposYaLlenados);

    if (this.shouldFail) throw new AsistenteIaNoDisponibleError();
    if (this.nextResult) return this.nextResult;

    return ejemploPara(req);
  }
}

/**
 * Ejemplo con la forma correcta para el perfil recibido: llena los signos
 * vitales de esa especialidad y sus campos obligatorios, para que probar en
 * dev se parezca a lo que hará el modelo real.
 */
function ejemploPara(req: ExtraccionClinicaRequest): ExtraccionClinicaResult {
  const { perfil } = req;

  const signosVitales: Partial<SignosVitales> = Object.fromEntries(
    perfil.signosVitales.filter((v) => VALORES_DEMO[v]).map((v) => [v, VALORES_DEMO[v]!]),
  );

  const extension = Object.fromEntries(
    perfil.camposExtra
      .filter((c) => c.obligatorio)
      .map((c) => [
        c.key,
        c.tipo === 'numero'
          ? 1
          : c.tipo === 'seleccion'
            ? (c.opciones?.[0] ?? null)
            : `Ejemplo de ${c.label.toLowerCase()} (simulado).`,
      ]),
  );

  return {
    contenido: {
      padecimientoActual:
        '<p>Transcripción simulada: el paciente refiere el motivo de consulta descrito durante la grabación.</p>',
      // Texto plano: se captura en un textarea simple, no en el editor rico.
      hallazgos: 'Exploración sin datos patológicos aparentes (simulado).',
      signosVitales,
      planTerapeutico: '<p>Plan simulado por el adaptador de desarrollo.</p>',
      ...(Object.keys(extension).length > 0 ? { extension } : {}),
    },
    advertencias: ['Extracción simulada: GEMINI_PROVIDER=fake, no se llamó a ningún modelo.'],
  };
}

const VALORES_DEMO: Record<string, string> = {
  ta: '120/80',
  fc: '72',
  fr: '16',
  temp: '36.5',
  spo2: '98',
  peso: '70',
  talla: '1.70',
};
