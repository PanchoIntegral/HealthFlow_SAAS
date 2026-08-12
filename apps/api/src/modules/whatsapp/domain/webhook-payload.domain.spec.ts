import { esBaja, normalizarAccion, normalizarRemitente, parsearWebhook } from './webhook-payload';
import { esAvanceDeEstado } from '@healthflow/shared-types';

/** Envuelve un `value` en la estructura de sobres que usa Meta. */
const sobre = (value: unknown) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '123', changes: [{ field: 'messages', value }] }],
});

describe('parsearWebhook · estados de entrega', () => {
  it('traduce los estados de Meta a los nuestros', () => {
    const eventos = parsearWebhook(
      sobre({
        statuses: [
          { id: 'wamid.1', status: 'sent' },
          { id: 'wamid.2', status: 'delivered' },
          { id: 'wamid.3', status: 'read' },
        ],
      }),
    );
    expect(eventos).toEqual([
      { tipo: 'estado', metaMessageId: 'wamid.1', estado: 'enviado', error: null },
      { tipo: 'estado', metaMessageId: 'wamid.2', estado: 'entregado', error: null },
      { tipo: 'estado', metaMessageId: 'wamid.3', estado: 'leido', error: null },
    ]);
  });

  it('recoge el detalle de un fallo', () => {
    const [evento] = parsearWebhook(
      sobre({
        statuses: [
          {
            id: 'wamid.9',
            status: 'failed',
            errors: [{ code: 131026, title: 'Receiver incapable' }],
          },
        ],
      }),
    );
    expect(evento).toMatchObject({ estado: 'fallido', error: '131026: Receiver incapable' });
  });

  it('ignora un estado que no conocemos', () => {
    expect(parsearWebhook(sobre({ statuses: [{ id: 'wamid.1', status: 'deleted' }] }))).toEqual([]);
  });

  it('ignora un estado sin id: sin él no hay a qué mensaje atribuirlo', () => {
    expect(parsearWebhook(sobre({ statuses: [{ status: 'sent' }] }))).toEqual([]);
  });
});

describe('parsearWebhook · botones', () => {
  const botonPlantilla = (payload: string, contextId: string | null = 'wamid.orig') => ({
    messages: [
      {
        from: '525551234567',
        id: 'wamid.resp',
        type: 'button',
        ...(contextId ? { context: { id: contextId } } : {}),
        button: { payload, text: 'Confirmar' },
      },
    ],
  });

  it.each([
    ['confirmar', 'confirmar'],
    ['cancelar', 'cancelar'],
    ['reagendar', 'reagendar'],
  ])('reconoce el botón %s', (payload, accion) => {
    const [evento] = parsearWebhook(sobre(botonPlantilla(payload)));
    expect(evento).toEqual({ tipo: 'boton', contextMessageId: 'wamid.orig', accion });
  });

  it('acepta la forma interactiva (button_reply.id)', () => {
    const [evento] = parsearWebhook(
      sobre({
        messages: [
          {
            from: '525551234567',
            type: 'interactive',
            context: { id: 'wamid.orig' },
            interactive: { type: 'button_reply', button_reply: { id: 'cancelar', title: 'Cancelar' } },
          },
        ],
      }),
    );
    expect(evento).toMatchObject({ tipo: 'boton', accion: 'cancelar' });
  });

  // Sin `context.id` no hay forma legítima de saber de qué clínica se trata, y
  // resolverlo por el teléfono sería una fuga entre tenants.
  it('DESCARTA un botón sin context.id', () => {
    expect(parsearWebhook(sobre(botonPlantilla('confirmar', null)))).toEqual([]);
  });

  it('descarta un payload que no corresponde a ninguna acción', () => {
    expect(parsearWebhook(sobre(botonPlantilla('borrar_expediente')))).toEqual([]);
  });

  it('ignora un mensaje de texto cualquiera', () => {
    const eventos = parsearWebhook(
      sobre({
        messages: [
          { from: '525551234567', type: 'text', text: { body: 'gracias' }, context: { id: 'x' } },
        ],
      }),
    );
    expect(eventos).toEqual([]);
  });
});

describe('parsearWebhook · baja', () => {
  const texto = (body: string) => sobre({ messages: [{ from: '525551234567', type: 'text', text: { body } }] });

  it.each([['BAJA'], ['baja'], ['Stop'], ['STOP'], ['alto'], ['  BAJA  '], ['baja.']])(
    'reconoce «%s» como petición de baja',
    (body) => {
      const [evento] = parsearWebhook(texto(body));
      expect(evento).toMatchObject({ tipo: 'baja', deE164: '+525551234567' });
    },
  );

  // Se evalúa antes que cualquier otra rama: si alguien pide que dejen de
  // escribirle, eso gana sobre lo demás que traiga el mensaje.
  it('gana sobre un botón en el mismo mensaje', () => {
    const [evento] = parsearWebhook(
      sobre({
        messages: [
          {
            from: '525551234567',
            type: 'button',
            context: { id: 'wamid.orig' },
            text: { body: 'BAJA' },
            button: { payload: 'confirmar' },
          },
        ],
      }),
    );
    expect(evento!.tipo).toBe('baja');
  });

  it.each([['bajar de peso'], ['stopper'], ['ya no puedo ir']])(
    'no confunde «%s» con una baja',
    (body) => {
      expect(parsearWebhook(texto(body))).toEqual([]);
    },
  );
});

describe('parsearWebhook · payloads malformados', () => {
  // Es un endpoint público: cualquier cosa puede llegar, y nada de lo que
  // llegue debe tumbar el handler.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['cadena', 'hola'],
    ['número', 42],
    ['objeto vacío', {}],
    ['entry que no es lista', { entry: 'x' }],
    ['changes que no es lista', { entry: [{ changes: {} }] }],
    ['value nulo', { entry: [{ changes: [{ value: null }] }] }],
    ['statuses con basura', sobre({ statuses: [null, 3, 'x'] })],
    ['messages con basura', sobre({ messages: [null, [], 'x'] })],
  ])('devuelve lista vacía ante %s', (_caso, payload) => {
    expect(parsearWebhook(payload)).toEqual([]);
  });

  it('procesa varios sobres y varios cambios en una sola entrega', () => {
    const eventos = parsearWebhook({
      entry: [
        { changes: [{ value: { statuses: [{ id: 'a', status: 'sent' }] } }] },
        { changes: [{ value: { statuses: [{ id: 'b', status: 'read' }] } }] },
      ],
    });
    expect(eventos).toHaveLength(2);
  });
});

describe('normalizarAccion', () => {
  it.each([
    ['confirmar', 'confirmar'],
    ['confirmar:abc-123', 'confirmar'],
    ['CONFIRMAR', 'confirmar'],
    ['  Cancelar  ', 'cancelar'],
    ['otra_cosa', null],
    ['', null],
    [null, null],
  ])('%s → %s', (payload, esperado) => {
    expect(normalizarAccion(payload)).toBe(esperado);
  });
});

describe('normalizarRemitente', () => {
  it.each([
    ['525551234567', '+525551234567'],
    ['+52 555 123 4567', '+525551234567'],
    ['', null],
    [null, null],
    ['sin dígitos', null],
  ])('%s → %s', (from, esperado) => {
    expect(normalizarRemitente(from)).toBe(esperado);
  });
});

describe('esAvanceDeEstado', () => {
  // Meta no garantiza el orden de los webhooks: un 'delivered' que llega tarde
  // no debe hacer retroceder un mensaje que el paciente ya leyó.
  it.each([
    ['enviado → entregado', 'enviado', 'entregado', true],
    ['entregado → leido', 'entregado', 'leido', true],
    ['leido → entregado (tardío)', 'leido', 'entregado', false],
    ['entregado → enviado (tardío)', 'entregado', 'enviado', false],
    ['leido → leido (duplicado)', 'leido', 'leido', false],
    ['enviado → fallido', 'enviado', 'fallido', true],
    ['fallido → fallido', 'fallido', 'fallido', false],
    ['pendiente → enviado', 'pendiente', 'enviado', true],
  ] as const)('%s → %s', (_caso, actual, nuevo, esperado) => {
    expect(esAvanceDeEstado(actual, nuevo)).toBe(esperado);
  });
});
