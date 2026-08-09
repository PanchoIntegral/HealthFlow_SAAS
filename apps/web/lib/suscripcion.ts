'use client';

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'healthflow.suscripcion-suspendida';

/**
 * Si la suscripción está vencida, la API responde 402 a cada escritura. Ese
 * 402 es la única señal que tiene el cliente, y llega en cualquier petición y
 * desde cualquier pantalla — por eso vive en un store propio fuera de React,
 * al que `request()` puede escribir sin ser un componente.
 *
 * Se guarda en sessionStorage para que el aviso sobreviva a la navegación
 * entre páginas (Next remonta el árbol) sin quedarse pegado para siempre:
 * al cerrar la pestaña se olvida, y cualquier escritura exitosa lo limpia.
 */
let suspendida = false;
const listeners = new Set<() => void>();

function emitir() {
  for (const l of listeners) l();
}

export function marcarSuspendida(): void {
  if (suspendida) return;
  suspendida = true;
  try {
    sessionStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Modo privado o storage lleno: el aviso sigue funcionando en memoria.
  }
  emitir();
}

/** Una escritura que pasa significa que ya está al corriente. */
export function marcarAlCorriente(): void {
  if (!suspendida) return;
  suspendida = false;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ver arriba */
  }
  emitir();
}

function suscribir(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function leer(): boolean {
  return suspendida;
}

/** En el servidor no hay sessionStorage y nunca hay 402: siempre false. */
function leerEnServidor(): boolean {
  return false;
}

/** Rehidrata desde sessionStorage al cargar la página. */
export function rehidratarSuscripcion(): void {
  try {
    if (sessionStorage.getItem(STORAGE_KEY) === '1') {
      suspendida = true;
      emitir();
    }
  } catch {
    /* ver arriba */
  }
}

export function useSuscripcionSuspendida(): boolean {
  return useSyncExternalStore(suscribir, leer, leerEnServidor);
}
