import { lastValueFrom, of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { FeatureFlag } from '@healthflow/shared-types';
import { CapacidadInterceptor } from './capacidad.interceptor';
import { ModuloNoDisponibleError } from './capacidad.errors';
import type { CapacidadService } from './capacidad.service';
import type { Capacidad } from './capacidad';

function contexto(
  modulo: FeatureFlag | undefined,
  autenticado = true,
  tipo = 'http',
): { ctx: ExecutionContext; reflector: Reflector } {
  const reflector = { getAllAndOverride: () => modulo } as unknown as Reflector;
  const ctx = {
    getType: () => tipo,
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => (autenticado ? { user: { userId: 'u1' } } : {}) }),
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

const siguiente: CallHandler = { handle: () => of('resultado') };

function servicio(capacidad: Capacidad, espia?: FeatureFlag[]): CapacidadService {
  return {
    evaluarSuelto: async (modulo: FeatureFlag) => {
      espia?.push(modulo);
      return capacidad;
    },
  } as unknown as CapacidadService;
}

describe('CapacidadInterceptor', () => {
  it('deja pasar la ruta cuando la clínica puede usar el módulo', async () => {
    const { ctx, reflector } = contexto('dental_recalls');
    const interceptor = new CapacidadInterceptor(reflector, servicio({ disponible: true }));
    await expect(lastValueFrom(interceptor.intercept(ctx, siguiente))).resolves.toBe('resultado');
  });

  it.each([['entitlement'], ['rollout'], ['configuracion']] as const)(
    'responde ModuloNoDisponible (404) por %s',
    async (razon) => {
      const { ctx, reflector } = contexto('dental_recalls');
      const interceptor = new CapacidadInterceptor(
        reflector,
        servicio({ disponible: false, razon }),
      );
      const error = await lastValueFrom(interceptor.intercept(ctx, siguiente)).catch((e) => e);
      expect(error).toBeInstanceOf(ModuloNoDisponibleError);
      // 404 y no 403: para esta clínica el módulo no existe.
      expect((error as ModuloNoDisponibleError).httpStatus).toBe(404);
      expect((error as ModuloNoDisponibleError).code).toBe('ModuloNoDisponible');
      expect((error as ModuloNoDisponibleError).details()).toEqual({
        flag: 'dental_recalls',
        razon,
      });
    },
  );

  it('deja pasar una suscripción vencida: de eso se encarga el 402, y sólo en escrituras', async () => {
    // Cortarle a un médico el historial de recalls de sus pacientes por un
    // tema de cobranza sería el mismo error que ya se decidió no cometer con
    // el expediente clínico.
    const { ctx, reflector } = contexto('dental_recalls');
    const interceptor = new CapacidadInterceptor(
      reflector,
      servicio({ disponible: false, razon: 'suscripcion' }),
    );
    await expect(lastValueFrom(interceptor.intercept(ctx, siguiente))).resolves.toBe('resultado');
  });

  it('no consulta nada en rutas sin @RequiereModulo', async () => {
    const consultados: FeatureFlag[] = [];
    const { ctx, reflector } = contexto(undefined);
    const interceptor = new CapacidadInterceptor(
      reflector,
      servicio({ disponible: false, razon: 'entitlement' }, consultados),
    );
    await expect(lastValueFrom(interceptor.intercept(ctx, siguiente))).resolves.toBe('resultado');
    expect(consultados).toEqual([]);
  });

  it('no intenta resolver capacidad en rutas públicas: ahí no hay tenant en contexto', async () => {
    const consultados: FeatureFlag[] = [];
    const { ctx, reflector } = contexto('patient_portal', false);
    const interceptor = new CapacidadInterceptor(
      reflector,
      servicio({ disponible: false, razon: 'entitlement' }, consultados),
    );
    await expect(lastValueFrom(interceptor.intercept(ctx, siguiente))).resolves.toBe('resultado');
    expect(consultados).toEqual([]);
  });

  it('ignora contextos que no son HTTP (websocket de la sala de espera)', async () => {
    const { ctx, reflector } = contexto('dental_recalls', true, 'ws');
    const interceptor = new CapacidadInterceptor(
      reflector,
      servicio({ disponible: false, razon: 'entitlement' }),
    );
    await expect(lastValueFrom(interceptor.intercept(ctx, siguiente))).resolves.toBe('resultado');
  });
});
