import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../../../config/env';
import { construirPrompt } from '../../application/prompt-builder';
import { mapearRespuesta } from '../../application/mapear-respuesta';
import { AsistenteIaNoDisponibleError } from '../../domain/asistente-ia.errors';
import type {
  AsistenteClinicoIaPort,
  ExtraccionClinicaRequest,
  ExtraccionClinicaResult,
} from '../../domain/asistente-clinico-ia.port';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
/** Una consulta de 20 min tarda bastante más que un timbrado: 10s no alcanzan. */
const TIMEOUT_MS = 120_000;
/** Backoff: reintento solo ante red/5xx, NUNCA ante 4xx. */
const RETRY_DELAYS_MS = [1_000, 3_000];

/**
 * Adaptador de la API de Gemini (Google).
 *
 * REST directo con `fetch` en vez del SDK, igual que el PAC y Resend: el
 * timeout, el retry y el manejo de errores quedan explícitos y bajo control,
 * en vez de escondidos tras las decisiones de una librería que además hay que
 * mantener al día.
 *
 * Privacidad, que aquí es el punto delicado:
 * - El audio se manda inline en la petición y NUNCA se escribe a disco ni a
 *   storage: vive en el buffer de esta llamada y muere con ella.
 * - Los logs llevan tamaño del audio y status HTTP. Jamás el audio, la
 *   transcripción, el prompt ni el nombre del paciente.
 * - GEMINI_API_KEY solo por variable de entorno, con getter lazy: arrancar con
 *   el adaptador fake no la exige.
 */
@Injectable()
export class GeminiAdapter implements AsistenteClinicoIaPort {
  private readonly logger = new Logger(GeminiAdapter.name);

  private get apiKey(): string {
    return env.geminiApiKey;
  }

  /**
   * Flash y no Pro: la tarea es transcribir y acomodar lo dicho en campos, no
   * razonar. Cuesta una fracción y responde mucho más rápido, y aquí hay un
   * médico esperando frente al paciente.
   *
   * Configurable por entorno porque el catálogo de modelos de Google cambia
   * varias veces al año: cuando salga el siguiente Flash, se cambia una
   * variable y no un despliegue de código.
   */
  private get model(): string {
    return env.geminiModel;
  }

  async extraer(req: ExtraccionClinicaRequest): Promise<ExtraccionClinicaResult> {
    const payload = {
      contents: [
        {
          // camelCase: es como lo documenta Google para REST.
          parts: [
            { text: construirPrompt(req.perfil, req.camposYaLlenados) },
            { inlineData: { mimeType: req.mimeType, data: req.audio.toString('base64') } },
          ],
        },
      ],
      generationConfig: {
        // Fuerza JSON del lado del modelo. Aun así la respuesta se valida en
        // mapearRespuesta: esto reduce el ruido, no sustituye la validación.
        responseMimeType: 'application/json',
        // Bajo a propósito: se quiere fidelidad a lo que se dijo, no prosa.
        temperature: 0.1,
      },
    };

    const body = await this.request(payload, req.audio.byteLength);
    return mapearRespuesta(extraerTexto(body), req.perfil);
  }

  private async request(payload: unknown, audioBytes: number): Promise<unknown> {
    const url = `${BASE_URL}/models/${this.model}:generateContent`;

    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            // En header y no en query string: la URL termina en logs de
            // proxies y trazas; el header no.
            'x-goog-api-key': this.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (res.ok) return res.json();

        this.logger.error(`Gemini respondió ${res.status} (audio ${audioBytes} bytes)`);
        if (res.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]!);
          continue;
        }
        // Un 4xx es una petición mal armada o una key inválida: reintentarlo
        // solo quema dinero y tiempo del médico.
        throw new AsistenteIaNoDisponibleError();
      } catch (err) {
        if (err instanceof AsistenteIaNoDisponibleError) throw err;
        this.logger.error(`Error de red hacia Gemini (intento ${attempt + 1}, audio ${audioBytes} bytes)`);
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]!);
          continue;
        }
        throw new AsistenteIaNoDisponibleError();
      }
    }
  }
}

/** Saca el texto de la primera candidata de la respuesta de Gemini. */
function extraerTexto(body: unknown): string {
  const candidato = (body as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
    ?.candidates?.[0];
  return candidato?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
