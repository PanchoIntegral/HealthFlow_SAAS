import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { HuecoDisponible, ReagendaCitaView } from '@healthflow/shared-types';
import { ReagendarCitaUseCase } from '../application/reagendar-cita.use-case';
import { ReagendarDto } from './dto/reagendar.dto';

/**
 * Página pública de reagendado. **Sin JWT**: el paciente no tiene cuenta y el
 * enlace que recibió por WhatsApp es la credencial.
 *
 * Dos cuidados que valen por todo lo demás:
 *
 *  - **El token va en el PATH, nunca en query string.** Las URLs con query
 *    acaban en logs de proxies, en el Referer al cargar recursos y en el
 *    historial compartido del navegador.
 *  - **Nada de lo que se devuelve aquí es información clínica.** El enlace vive
 *    para siempre en el historial de un WhatsApp, y ese teléfono puede acabar
 *    prestado, vendido o compartido.
 *
 * Límite estrecho por IP: es una ruta anónima que escribe en la agenda.
 */
@Controller('publico/reagendar')
@Throttle({ default: { ttl: 60_000, limit: 10 }, burst: { ttl: 1_000, limit: 3 } })
export class ReagendaController {
  constructor(private readonly reagendar: ReagendarCitaUseCase) {}

  /** Datos mínimos de la cita, para que el paciente reconozca cuál es. */
  @Get(':token')
  ver(@Param('token') token: string): Promise<ReagendaCitaView> {
    return this.reagendar.ver(token);
  }

  /** Horarios libres del mismo médico. */
  @Get(':token/huecos')
  huecos(
    @Param('token') token: string,
    @Query('desde') desde?: string,
  ): Promise<HuecoDisponible[]> {
    return this.reagendar.huecos(token, fecha(desde) ?? new Date());
  }

  /** Mueve la cita. Consume el token: solo funciona una vez. */
  @Post(':token')
  confirmar(@Param('token') token: string, @Body() dto: ReagendarDto): Promise<ReagendaCitaView> {
    const inicio = fecha(dto.inicio);
    if (!inicio) throw new BadRequestException('Fecha inválida');
    return this.reagendar.reagendar(token, inicio);
  }
}

function fecha(valor: string | undefined): Date | null {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}
