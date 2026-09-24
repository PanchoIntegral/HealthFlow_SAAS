import { buildOutboxJobs, outboxKey } from './outbox.service';
import { FakeMessagingProvider, LiveMessagingProvider, renderPrivacySafeBody, renderPrivacySafeEmail } from './providers';
import type { ProviderMessage, ScheduleMessagesInput } from './messaging.types';

const now = new Date('2026-09-10T12:00:00Z');
const startsAt = new Date('2026-09-15T17:00:00Z');

function input(overrides: Partial<ScheduleMessagesInput> = {}): ScheduleMessagesInput {
  return {
    appointmentId: 'cita-1', patientId: 'pac-1', startsAt,
    email: 'ana@example.mx', phone: '+526641234567', whatsappOptIn: true,
    preferredChannel: 'whatsapp', reminderHours: [48, 24], ...overrides,
  };
}

describe('claves de idempotencia del outbox (P0.1)', () => {
  it('los recordatorios de 48 h y 24 h son trabajos distintos con claves distintas', () => {
    const jobs = buildOutboxJobs(input(), 1, now);
    expect(jobs.map(j => j.kind)).toEqual(['confirmation', 'reminder', 'reminder']);
    const keys = jobs.map(j => j.key);
    expect(new Set(keys).size).toBe(3);
    expect(keys).toEqual([
      'cita-1:v1:confirmation:whatsapp',
      'cita-1:v1:reminder:48h:whatsapp',
      'cita-1:v1:reminder:24h:whatsapp',
    ]);
  });

  it('la clave no depende de la fecha: reprogramar A -> B -> A produce claves nuevas por versión', () => {
    const v1 = buildOutboxJobs(input(), 1, now).map(j => j.key);
    const v3 = buildOutboxJobs(input({ kind: 'rescheduled' }), 3, now).map(j => j.key);
    expect(v3.some(k => v1.includes(k))).toBe(false);
    expect(v3).toContain('cita-1:v3:rescheduled:whatsapp');
    expect(v3).toContain('cita-1:v3:reminder:24h:whatsapp');
  });

  it('confirmación, reprogramación y cancelación de la misma versión tienen claves diferentes', () => {
    const kinds = new Set([
      outboxKey('cita-1', 2, 'confirmation', 'email'),
      outboxKey('cita-1', 2, 'rescheduled', 'email'),
      outboxKey('cita-1', 2, 'cancelled', 'email'),
    ]);
    expect(kinds.size).toBe(3);
  });

  it('la cancelación no programa recordatorios y respeta el canal autorizado', () => {
    expect(buildOutboxJobs(input({ kind: 'cancelled' }), 1, now).map(j => j.kind)).toEqual(['cancelled']);
    expect(buildOutboxJobs(input({ whatsappOptIn: false }), 1, now)).toEqual([]);
    expect(buildOutboxJobs(input({ preferredChannel: 'email', email: null }), 1, now)).toEqual([]);
    expect(buildOutboxJobs(input({ preferredChannel: 'ninguno' }), 1, now)).toEqual([]);
  });

  it('omite recordatorios cuya hora ya pasó pero conserva la confirmación', () => {
    const soon = new Date(now.getTime() + 30 * 3_600_000);
    const jobs = buildOutboxJobs(input({ startsAt: soon }), 1, now);
    expect(jobs.map(j => j.kind)).toEqual(['confirmation', 'reminder']);
    expect(jobs[1]!.key).toBe('cita-1:v1:reminder:24h:whatsapp');
  });
});

describe('adaptadores de proveedor y clave de idempotencia (P0.1)', () => {
  const message: ProviderMessage = {
    channel: 'email', destination: 'ana@example.mx', clinicName: 'Sonrisa', timezone: 'America/Tijuana',
    kind: 'reminder', startsAt, manageUrl: 'https://app.example/cita/token', idempotencyKey: 'cita-1:v1:reminder:24h:email',
  };

  it('Resend recibe exactamente la clave guardada en el outbox, sin derivar otra', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'email_123' }) });
    const original = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      const result = await new LiveMessagingProvider().send(message);
      expect(result).toEqual({ outcome: 'accepted', providerMessageId: 'email_123' });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('cita-1:v1:reminder:24h:email');
      const payload = JSON.parse(init.body as string) as { subject: string; html: string; text: string };
      expect(payload.subject).toBe('Recordatorio: tu cita es pronto · Sonrisa');
      expect(payload.html).toContain('Te recordamos tu cita');
      expect(payload.html).toContain('Ver mi cita');
      expect(payload.text).toBe(renderPrivacySafeBody(message));
    } finally {
      global.fetch = original;
      delete process.env.RESEND_API_KEY;
    }
  });

  it('el fake provider expone metadatos sin destino ni cuerpo', async () => {
    const fake = new FakeMessagingProvider();
    await fake.send(message);
    await fake.send({ ...message, idempotencyKey: 'cita-1:v1:reminder:48h:email' });
    expect(fake.sent).toHaveLength(2);
    expect(fake.sent.map(s => s.idempotencyKey)).toEqual(['cita-1:v1:reminder:24h:email', 'cita-1:v1:reminder:48h:email']);
    expect(JSON.stringify(fake.sent)).not.toContain('ana@example.mx');
    expect(JSON.stringify(fake.sent)).not.toContain('manageUrl');
    fake.reset();
    expect(fake.sent).toHaveLength(0);
  });

  it('un recall sólo menciona clínica, revisión y reserva; nunca información clínica', () => {
    const body = renderPrivacySafeBody({
      channel: 'email', destination: 'ana@example.mx', clinicName: 'Sonrisa',
      timezone: 'America/Tijuana', kind: 'recall',
      bookingUrl: 'https://app.example/reservar/sonrisa', idempotencyKey: 'recall:r1:a1:email',
    });
    expect(body).toContain('Clínica Sonrisa');
    expect(body).toContain('https://app.example/reservar/sonrisa');
    expect(body).not.toMatch(/limpieza|tratamiento|diagnóstico|pieza|presupuesto/i);
  });

  it('el correo HTML tiene llamada a la acción y escapa los datos variables', () => {
    const html = renderPrivacySafeEmail({
      ...message,
      clinicName: 'Sonrisa <Centro>',
      manageUrl: 'https://app.example/cita?a=1&b=2',
    });
    expect(html).toContain('Sonrisa &lt;Centro&gt;');
    expect(html).not.toContain('Sonrisa <Centro>');
    expect(html).toContain('https://app.example/cita?a=1&amp;b=2');
    expect(html).toContain('Hora local de la clínica');
    expect(html).not.toMatch(/limpieza|tratamiento|diagnóstico|pieza|presupuesto/i);
  });
});

describe('clasificación de fallos del proveedor (P0.2)', () => {
  // Se importan aquí para mantener el archivo autocontenido.
  const { classifyHttpFailure, classifyNetworkError } = require('./providers') as typeof import('./providers');

  it('429 y 5xx son transitorios en ambos proveedores', () => {
    expect(classifyHttpFailure('twilio', 429).outcome).toBe('retryable');
    expect(classifyHttpFailure('twilio', 503).outcome).toBe('retryable');
    expect(classifyHttpFailure('resend', 500).outcome).toBe('retryable');
    expect(classifyHttpFailure('resend', 429, 'rate_limit_exceeded')).toEqual({ outcome: 'retryable', code: 'resend_rate_limit_exceeded' });
  });

  it('destino o plantilla inválidos son permanentes y conservan el código', () => {
    expect(classifyHttpFailure('twilio', 400, 21211)).toEqual({ outcome: 'permanent', code: 'twilio_21211' });
    expect(classifyHttpFailure('twilio', 400, 63016).outcome).toBe('permanent');
    expect(classifyHttpFailure('resend', 422, 'validation_error')).toEqual({ outcome: 'permanent', code: 'resend_validation_error' });
    expect(classifyHttpFailure('resend', 401).outcome).toBe('permanent');
  });

  it('un límite de tasa reportado como 4xx por Twilio sigue siendo transitorio', () => {
    expect(classifyHttpFailure('twilio', 400, 20429).outcome).toBe('retryable');
  });

  it('timeout o conexión cortada son inciertos; conexión rechazada es reintentable', () => {
    const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    expect(classifyNetworkError(timeout)).toEqual({ outcome: 'uncertain', code: 'net_TimeoutError' });
    expect(classifyNetworkError(Object.assign(new Error('reset'), { cause: { code: 'ECONNRESET' } })).outcome).toBe('uncertain');
    expect(classifyNetworkError(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })).outcome).toBe('retryable');
  });
});

describe('worker: cierra cada intento con el resultado clasificado (P0.2)', () => {
  const { MessagingWorker } = require('./worker.service') as typeof import('./worker.service');
  const row = { id: 'msg-1', tenant_id: 't', channel: 'whatsapp', kind: 'reminder', clinic_name: 'Sonrisa', clinic_timezone: 'America/Tijuana', destination: '+526641234567', appointment_id: 'a', starts_at: startsAt.toISOString(), attempts: 1, idempotency_key: 'a:v1:reminder:24h:whatsapp' };

  async function run(provider: { send: jest.Mock }) {
    const execute = jest.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValue({ rows: [] });
    const worker = new MessagingWorker({ execute } as never, provider as never);
    await worker.tick();
    return execute.mock.calls.slice(1).map(([query]) => JSON.stringify(query)).join('\n');
  }

  it('un resultado incierto se persiste como uncertain y no se reintenta', async () => {
    const q = await run({ send: jest.fn().mockResolvedValue({ outcome: 'uncertain', code: 'net_TimeoutError' }) });
    expect(q).toContain('"uncertain"');
    expect(q).toContain('net_TimeoutError');
    expect(q).toContain('ensure_public_appointment_manage_token');
  });

  it('un adaptador que lanza se trata como incierto, nunca como reintentable', async () => {
    const q = await run({ send: jest.fn().mockRejectedValue(new Error('boom')) });
    expect(q).toContain('"uncertain"');
  });

  it('un rechazo permanente llega como permanent con su código', async () => {
    const q = await run({ send: jest.fn().mockResolvedValue({ outcome: 'permanent', code: 'twilio_21211' }) });
    expect(q).toContain('"permanent"');
    expect(q).toContain('twilio_21211');
  });

  it('un recall usa la reserva pública y no fabrica un enlace de cita', async () => {
    const recallRow = {
      ...row,
      kind: 'recall',
      appointment_id: null,
      recall_attempt_id: 'ra-1',
      starts_at: null,
      booking_slug: 'clinica-sonrisa',
      idempotency_key: 'recall:r1:a1:whatsapp',
    };
    const execute = jest.fn().mockResolvedValueOnce({ rows: [recallRow] }).mockResolvedValue({ rows: [] });
    const send = jest.fn().mockResolvedValue({ outcome: 'accepted', providerMessageId: 'msg-recall' });
    const worker = new MessagingWorker({ execute } as never, { send } as never);
    await worker.tick();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'recall',
      bookingUrl: expect.stringContaining('/reservar/clinica-sonrisa'),
    }));
    expect(send.mock.calls[0]![0]).not.toHaveProperty('manageUrl');
    expect(send.mock.calls[0]![0]).not.toHaveProperty('startsAt');
  });
});
