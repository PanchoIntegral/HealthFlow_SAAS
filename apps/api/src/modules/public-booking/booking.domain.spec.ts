import { BookingServiceApp, normalizePhone } from './booking.service';
import { renderPrivacySafeBody } from '../messaging/providers';

describe('reserva pública y privacidad de mensajería', () => {
  it('normaliza teléfonos mexicanos antes de comparar pacientes', () => {
    expect(normalizePhone('(664) 123-45-67')).toBe('+526641234567');
    expect(normalizePhone('+52 664 123 4567')).toBe('+526641234567');
    expect(normalizePhone('123')).toBeNull();
  });

  it('el mensaje solo contiene clínica, fecha y enlace, no información clínica', () => {
    const body = renderPrivacySafeBody({
      channel: 'whatsapp', destination: '+526641234567', clinicName: 'Sonrisa',
      timezone: 'America/Tijuana',
      kind: 'reminder', startsAt: new Date('2026-09-10T17:00:00Z'),
      manageUrl: 'https://app.example/cita/token',
    });
    expect(body).toContain('Clínica Sonrisa, mediante HealthFlow');
    expect(body).toContain('https://app.example/cita/token');
    expect(body).not.toMatch(/diagnóstico|motivo|servicio|tratamiento/i);
    expect(body).not.toContain('+526641234567');
  });

  it('el directorio solo mapea el perfil público y acota la paginación', async () => {
    const db={execute:jest.fn().mockResolvedValue({rows:[{
      slug:'clinica-centro',clinic_name:'Clínica Centro',clinic_address:'Zona Río',
      doctor_id:'8b38ee56-d68b-4cc4-8528-97ab4823fa27',doctor_name:'Dra. Ana López',
      specialty:'Pediatría',total_count:'1',
    }]})};
    const booking=new BookingServiceApp(db as never,{} as never,{} as never);

    await expect(booking.directory(' pediatría ',1,100)).resolves.toEqual({
      items:[{clinicName:'Clínica Centro',clinicAddress:'Zona Río',slug:'clinica-centro',
        doctorId:'8b38ee56-d68b-4cc4-8528-97ab4823fa27',doctorName:'Dra. Ana López',specialty:'Pediatría'}],
      total:1,page:1,pageSize:24,
    });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
