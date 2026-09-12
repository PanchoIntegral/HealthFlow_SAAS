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
      idempotencyKey: 'cita:v1:reminder:24h:whatsapp',
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
    const booking=new BookingServiceApp(db as never,{} as never,{} as never,{} as never);

    await expect(booking.directory(' pediatría ','Pediatría',1,100)).resolves.toEqual({
      items:[{clinicName:'Clínica Centro',clinicAddress:'Zona Río',slug:'clinica-centro',
        doctorId:'8b38ee56-d68b-4cc4-8528-97ab4823fa27',doctorName:'Dra. Ana López',specialty:'Pediatría'}],
      total:1,page:1,pageSize:24,
    });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('convierte una especialidad vacía en NULL para no filtrar de más', async () => {
    const db={execute:jest.fn().mockResolvedValue({rows:[]})};
    const booking=new BookingServiceApp(db as never,{} as never,{} as never,{} as never);

    await expect(booking.directory('centro','   ',1,12)).resolves.toEqual({
      items:[],total:0,page:1,pageSize:12,
    });
    // El parámetro debe viajar como NULL, no como cadena vacía: la función SQL
    // distingue "sin filtro" de "especialidad literalmente vacía".
    // En el `sql` de drizzle los trozos literales son StringChunk (value: string[])
    // y los parámetros van crudos; nos quedamos con estos últimos.
    const bound=(db.execute.mock.calls[0][0] as {queryChunks:unknown[]}).queryChunks
      .filter(chunk=>!Array.isArray((chunk as {value?:unknown})?.value));
    expect(bound).toEqual(['centro',null,12,0]);
  });

  it('mapea el catálogo de especialidades con totales numéricos', async () => {
    const db={execute:jest.fn().mockResolvedValue({rows:[
      {specialty:'Pediatría',total:'3'},{specialty:'Cardiología',total:1},
    ]})};
    const booking=new BookingServiceApp(db as never,{} as never,{} as never,{} as never);

    await expect(booking.directorySpecialties()).resolves.toEqual([
      {specialty:'Pediatría',total:3},{specialty:'Cardiología',total:1},
    ]);
  });
});
