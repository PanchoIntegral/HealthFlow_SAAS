import {
  DatoSensibleError,
  asegurarDetalleAuditable,
  asegurarPayloadDeEvento,
} from './datos-sensibles';

describe('Clasificación de datos sensibles', () => {
  describe('detalle de auditoría', () => {
    it('acepta lo que la bitácora necesita para identificar el acto', () => {
      // Exactamente lo que ya guardan los casos de uso existentes.
      expect(() =>
        asegurarDetalleAuditable({ nombre: 'Roberto Fernández', curp: 'FEGR800101HDFRNB09' }),
      ).not.toThrow();
      expect(() => asegurarDetalleAuditable({ cambioTelefono: true })).not.toThrow();
      expect(() => asegurarDetalleAuditable({ checkinAt: '2026-09-11T10:00:00.000Z' })).not.toThrow();
      expect(() => asegurarDetalleAuditable({ motivo: 'El paciente reprogramó' })).not.toThrow();
      expect(() => asegurarDetalleAuditable({ folio: 'REC-000123', medicamentos: 3 })).not.toThrow();
      expect(() => asegurarDetalleAuditable(undefined)).not.toThrow();
    });

    it('rechaza credenciales aunque la clave parezca inocente', () => {
      expect(() => asegurarDetalleAuditable({ token: 'abc' })).toThrow(DatoSensibleError);
      expect(() => asegurarDetalleAuditable({ enlace: 'a'.repeat(43) })).toThrow(/token o una credencial/);
      expect(() =>
        asegurarDetalleAuditable({ h: 'eyJhbGciOi.eyJzdWIiOiIxMjM0.SflKxwRJSM' }),
      ).toThrow(/token o una credencial/);
    });

    it('rechaza destinos de contacto (§5.3)', () => {
      expect(() => asegurarDetalleAuditable({ destino: 'ana@clinica.mx' })).toThrow(/correo/);
      expect(() => asegurarDetalleAuditable({ destino: '+52 686 123 4567' })).toThrow(/telefónico/);
    });

    it('no confunde un importe ni una fecha con un teléfono', () => {
      expect(() => asegurarDetalleAuditable({ total: '12345678.90' })).not.toThrow();
      expect(() => asegurarDetalleAuditable({ fecha: '2026-09-11' })).not.toThrow();
    });

    it('rechaza el cuerpo clínico completo o el payload crudo del proveedor', () => {
      expect(() => asegurarDetalleAuditable({ nota: 'x'.repeat(2001) })).toThrow(/2001 caracteres/);
      expect(() => asegurarDetalleAuditable({ rawPayload: { a: 1 } })).toThrow(/prohibida/);
    });

    it('encuentra el campo aunque esté anidado, y dice dónde', () => {
      try {
        asegurarDetalleAuditable({ proveedor: { respuesta: { apiKey: 'x' } } });
        fail('debió lanzar');
      } catch (error) {
        expect((error as DatoSensibleError).ruta).toBe('proveedor.respuesta.apiKey');
      }
    });
  });

  describe('payload de evento interno', () => {
    it('acepta identificadores y estado', () => {
      expect(() =>
        asegurarPayloadDeEvento({
          appointmentId: '3f1d2c9e-4a5b-4c6d-8e7f-0a1b2c3d4e5f',
          patientId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
          status: 'scheduled',
          importeCentavos: 125000,
        }),
      ).not.toThrow();
    });

    it('rechaza el nombre del paciente: el consumidor lo busca en su dueño', () => {
      expect(() => asegurarPayloadDeEvento({ nombre: 'Ana' })).toThrow(/prohibida/);
      expect(() => asegurarPayloadDeEvento({ diagnostico: 'K05.3' })).toThrow(/prohibida/);
      expect(() => asegurarPayloadDeEvento({ mediciones: [1, 2, 3] })).toThrow(/prohibida/);
    });

    it('rechaza prosa: un evento no transporta texto libre', () => {
      expect(() => asegurarPayloadDeEvento({ motivo: 'x'.repeat(121) })).toThrow(/máximo 120/);
      expect(() => asegurarPayloadDeEvento({ motivo: 'no_show' })).not.toThrow();
    });

    it('acota anidamiento y tamaño como el CHECK de la migración', () => {
      expect(() => asegurarPayloadDeEvento({ a: { b: { c: { d: 1 } } } })).toThrow(/anidamiento/);
      const grande: Record<string, unknown> = {};
      for (let i = 0; i < 300; i++) grande[`campo${i}`] = 'valor_corto';
      expect(() => asegurarPayloadDeEvento(grande)).toThrow(/máximo 4096/);
    });
  });
});
