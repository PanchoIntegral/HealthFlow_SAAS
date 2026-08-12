import { CloudApiWhatsappAdapter, sanear } from './cloud-api-whatsapp.adapter';
import { variablesEnOrden } from '../../application/despachar-outbox.use-case';
import type { CredencialesWhatsapp, MensajePlantilla } from '../../application/whatsapp-sender.port';

const CREDENCIALES: CredencialesWhatsapp = {
  phoneNumberId: '1234567890',
  accessToken: 'EAAG-token-secretisimo',
};

const MENSAJE: MensajePlantilla = {
  aE164: '+525551234567',
  plantilla: 'recordatorio_cita',
  idioma: 'es_MX',
  variables: ['Ana', 'Clínica del Valle', 'lunes 14 de septiembre', '10:00 a.m.', 'Dr. Pérez'],
  botones: ['confirmar', 'cancelar', 'reagendar'],
};

/** Sustituye `fetch` por una respuesta fija. Devuelve lo que se envió. */
function mockFetch(status: number, body: unknown) {
  const llamadas: { url: string; init: RequestInit }[] = [];
  jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      llamadas.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  return llamadas;
}

describe('CloudApiWhatsappAdapter', () => {
  const adaptador = new CloudApiWhatsappAdapter();

  afterEach(() => jest.restoreAllMocks());

  describe('envío exitoso', () => {
    it('devuelve el id de mensaje que asignó Meta', async () => {
      mockFetch(200, { messages: [{ id: 'wamid.ABC123' }] });
      const r = await adaptador.enviarPlantilla(CREDENCIALES, MENSAJE);
      expect(r).toEqual({ ok: true, metaMessageId: 'wamid.ABC123' });
    });

    it('manda la plantilla con sus variables en orden', async () => {
      const llamadas = mockFetch(200, { messages: [{ id: 'wamid.X' }] });
      await adaptador.enviarPlantilla(CREDENCIALES, MENSAJE);

      const cuerpo = JSON.parse(String(llamadas[0]!.init.body));
      expect(cuerpo.to).toBe('+525551234567');
      expect(cuerpo.template.name).toBe('recordatorio_cita');
      expect(cuerpo.template.language.code).toBe('es_MX');
      expect(cuerpo.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(
        MENSAJE.variables,
      );
    });

    it('usa el phone_number_id de las credenciales recibidas', async () => {
      const llamadas = mockFetch(200, { messages: [{ id: 'wamid.X' }] });
      await adaptador.enviarPlantilla(CREDENCIALES, MENSAJE);
      expect(llamadas[0]!.url).toContain('/1234567890/messages');
    });
  });

  describe('qué se reintenta y qué no', () => {
    // Reintentar lo que nunca va a funcionar solo gasta cuota y retrasa los
    // mensajes que sí pueden salir.
    it.each([
      ['número sin WhatsApp', 131026],
      ['fuera de la ventana de 24h', 131047],
      ['plantilla no aprobada', 132001],
      ['token revocado', 190],
    ])('NO reintenta: %s', async (_caso, code) => {
      mockFetch(400, { error: { code, message: 'nope' } });
      const r = await adaptador.enviarPlantilla(CREDENCIALES, MENSAJE);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error.reintentable).toBe(false);
      expect(r.ok === false && r.error.codigo).toBe(String(code));
    });

    it.each([
      ['límite de tasa', 429, 130429],
      ['error interno de Meta', 500, 1],
      ['servicio no disponible', 503, 2],
    ])('sí reintenta: %s', async (_caso, status, code) => {
      mockFetch(status, { error: { code, message: 'reintenta luego' } });
      const r = await adaptador.enviarPlantilla(CREDENCIALES, MENSAJE);
      expect(r.ok === false && r.error.reintentable).toBe(true);
    });

    // Ante un código que aún no está catalogado se prefiere gastar un intento
    // de más a descartar un recordatorio por un fallo pasajero.
    it('reintenta ante un código desconocido', async () => {
      mockFetch(400, { error: { code: 999999, message: 'nuevo' } });
      const r = await adaptador.enviarPlantilla(CREDENCIALES, MENSAJE);
      expect(r.ok === false && r.error.reintentable).toBe(true);
    });

    it('trata la caída de red como reintentable', async () => {
      jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
      const r = await adaptador.enviarPlantilla(CREDENCIALES, MENSAJE);
      expect(r.ok === false && r.error.codigo).toBe('red');
      expect(r.ok === false && r.error.reintentable).toBe(true);
    });

    it('no da por bueno un 200 sin id de mensaje', async () => {
      mockFetch(200, { messages: [] });
      const r = await adaptador.enviarPlantilla(CREDENCIALES, MENSAJE);
      expect(r.ok).toBe(false);
    });

    it('sobrevive a una respuesta que no es JSON', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('<html>502</html>', { status: 502 }));
      const r = await adaptador.enviarPlantilla(CREDENCIALES, MENSAJE);
      expect(r.ok === false && r.error.reintentable).toBe(true);
    });
  });

  // `ultimo_error` se guarda en la base y se muestra en Ajustes: un token
  // filtrado ahí es un token comprometido.
  describe('el access token nunca llega al error persistido', () => {
    it('lo tacha si Meta lo devuelve en el mensaje', async () => {
      mockFetch(400, {
        error: { code: 190, message: `Invalid token: ${CREDENCIALES.accessToken} on request` },
      });
      const r = await adaptador.enviarPlantilla(CREDENCIALES, MENSAJE);
      expect(r.ok === false && r.error.mensaje).not.toContain(CREDENCIALES.accessToken);
      expect(r.ok === false && r.error.mensaje).toContain('***');
    });

    it('lo tacha también en un error de red', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error(`falló con Bearer ${CREDENCIALES.accessToken}`));
      const r = await adaptador.enviarPlantilla(CREDENCIALES, MENSAJE);
      expect(r.ok === false && r.error.mensaje).not.toContain(CREDENCIALES.accessToken);
    });
  });
});

describe('sanear', () => {
  it('sustituye todas las apariciones del token', () => {
    const texto = `a ${CREDENCIALES.accessToken} b ${CREDENCIALES.accessToken} c`;
    expect(sanear(texto, CREDENCIALES)).toBe('a *** b *** c');
  });

  it('recorta a 500 caracteres: ultimo_error lo lee una persona', () => {
    expect(sanear('x'.repeat(2000), CREDENCIALES)).toHaveLength(500);
  });

  it('deja intacto un texto sin secretos', () => {
    expect(sanear('Rate limit hit', CREDENCIALES)).toBe('Rate limit hit');
  });
});

describe('variablesEnOrden', () => {
  // Meta numera las variables del cuerpo y las espera en orden; un objeto JSON
  // no garantiza el orden de sus claves.
  it('ordena numéricamente, no alfabéticamente', () => {
    expect(variablesEnOrden({ '10': 'diez', '2': 'dos', '1': 'uno' })).toEqual([
      'uno',
      'dos',
      'diez',
    ]);
  });

  it('devuelve lista vacía si no hay variables', () => {
    expect(variablesEnOrden({})).toEqual([]);
  });
});
