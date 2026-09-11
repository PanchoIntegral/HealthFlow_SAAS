import { lastValueFrom, of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { FeatureFlag } from '@healthflow/shared-types';
import { FeatureFlagInterceptor } from './feature-flag.interceptor';
import { ModuloNoDisponibleError } from './feature-flags.errors';
import type { FeatureFlagsService } from './feature-flags.service';

function contexto(flag: FeatureFlag | undefined, autenticado = true, tipo = 'http'): {
  ctx: ExecutionContext;
  reflector: Reflector;
} {
  const reflector = { getAllAndOverride: () => flag } as unknown as Reflector;
  const ctx = {
    getType: () => tipo,
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => (autenticado ? { user: { userId: 'u1' } } : {}) }),
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

const siguiente: CallHandler = { handle: () => of('resultado') };

function servicio(habilitado: boolean, espia?: FeatureFlag[]): FeatureFlagsService {
  return {
    leer: async (flag: FeatureFlag) => {
      espia?.push(flag);
      return habilitado;
    },
  } as unknown as FeatureFlagsService;
}

describe('FeatureFlagInterceptor', () => {
  it('deja pasar la ruta cuando la clínica tiene el módulo encendido', async () => {
    const { ctx, reflector } = contexto('dental_recalls');
    const interceptor = new FeatureFlagInterceptor(reflector, servicio(true));
    await expect(lastValueFrom(interceptor.intercept(ctx, siguiente))).resolves.toBe('resultado');
  });

  it('responde ModuloNoDisponible (404) cuando está apagado', async () => {
    const { ctx, reflector } = contexto('dental_recalls');
    const interceptor = new FeatureFlagInterceptor(reflector, servicio(false));
    const error = await lastValueFrom(interceptor.intercept(ctx, siguiente)).catch((e) => e);
    expect(error).toBeInstanceOf(ModuloNoDisponibleError);
    // 404 y no 403: para esta clínica el módulo aún no existe.
    expect((error as ModuloNoDisponibleError).httpStatus).toBe(404);
    expect((error as ModuloNoDisponibleError).code).toBe('ModuloNoDisponible');
    expect((error as ModuloNoDisponibleError).details()).toEqual({ flag: 'dental_recalls' });
  });

  it('no consulta nada en rutas sin @RequiereFlag', async () => {
    const consultados: FeatureFlag[] = [];
    const { ctx, reflector } = contexto(undefined);
    const interceptor = new FeatureFlagInterceptor(reflector, servicio(false, consultados));
    await expect(lastValueFrom(interceptor.intercept(ctx, siguiente))).resolves.toBe('resultado');
    expect(consultados).toEqual([]);
  });

  it('no intenta resolver el flag en rutas públicas: ahí no hay tenant en contexto', async () => {
    const consultados: FeatureFlag[] = [];
    const { ctx, reflector } = contexto('patient_portal', false);
    const interceptor = new FeatureFlagInterceptor(reflector, servicio(false, consultados));
    await expect(lastValueFrom(interceptor.intercept(ctx, siguiente))).resolves.toBe('resultado');
    expect(consultados).toEqual([]);
  });

  it('ignora contextos que no son HTTP (websocket de la sala de espera)', async () => {
    const { ctx, reflector } = contexto('dental_recalls', true, 'ws');
    const interceptor = new FeatureFlagInterceptor(reflector, servicio(false));
    await expect(lastValueFrom(interceptor.intercept(ctx, siguiente))).resolves.toBe('resultado');
  });
});
