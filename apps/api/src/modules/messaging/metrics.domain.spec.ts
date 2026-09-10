import { BadRequestException } from '@nestjs/common';
import { metricsPeriod } from './messaging.controller';

describe('Periodo de métricas',()=>{
  const now=new Date('2026-09-10T20:00:00.000Z');

  it('usa una ventana móvil de 30 días por defecto',()=>{
    const {from,to}=metricsPeriod(undefined,undefined,now);
    expect(to).toEqual(now);
    expect(to.getTime()-from.getTime()).toBe(30*86_400_000);
  });

  it('acepta un periodo explícito',()=>{
    expect(metricsPeriod('2026-09-01T00:00:00Z','2026-10-01T00:00:00Z',now)).toEqual({
      from:new Date('2026-09-01T00:00:00Z'),to:new Date('2026-10-01T00:00:00Z'),
    });
  });

  it.each([
    ['fecha inválida','nada','2026-10-01T00:00:00Z'],
    ['orden inverso','2026-10-02T00:00:00Z','2026-10-01T00:00:00Z'],
    ['más de 366 días','2025-01-01T00:00:00Z','2026-10-01T00:00:00Z'],
  ])('rechaza %s',(_name,from,to)=>{
    expect(()=>metricsPeriod(from,to,now)).toThrow(BadRequestException);
  });
});
