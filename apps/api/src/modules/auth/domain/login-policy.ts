/**
 * Política de bloqueo progresivo tras fallos de login. Función pura: toda la
 * decisión sale del contador de fallos y de la marca de tiempo del último,
 * sin estado propio ni acceso a la base — así se puede razonar y probar sola
 * (ver login-policy.spec.ts).
 */

export type LoginScope = 'email' | 'ip';

interface Step {
  /** A partir de este número de fallos... */
  attempts: number;
  /** ...se bloquea este tiempo, contado desde el último intento. */
  lockMs: number;
}

interface ScopePolicy {
  /** Escalones de castigo, de menor a mayor. */
  steps: Step[];
  /**
   * Sin fallos nuevos durante este tiempo, el contador vuelve a cero. Evita
   * que un usuario legítimo arrastre para siempre los tropiezos de hace meses.
   */
  decayMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const POLICIES: Record<LoginScope, ScopePolicy> = {
  /**
   * Cuenta concreta. Deliberadamente suave: el email es público y adivinable,
   * así que un bloqueo largo aquí es un arma de denegación de servicio CONTRA
   * el usuario. Frena la fuerza bruta (5 intentos/minuto no rompen ninguna
   * contraseña) sin llegar a dejar a nadie fuera de su consulta.
   */
  email: {
    steps: [
      { attempts: 5, lockMs: MINUTE },
      { attempts: 10, lockMs: 5 * MINUTE },
      { attempts: 15, lockMs: 15 * MINUTE },
    ],
    decayMs: HOUR,
  },
  /**
   * Origen del ataque. Aquí sí conviene ser severo: quien falla 100 veces
   * desde la misma IP no es un médico que no recuerda su contraseña.
   */
  ip: {
    steps: [
      { attempts: 10, lockMs: MINUTE },
      { attempts: 25, lockMs: 5 * MINUTE },
      { attempts: 50, lockMs: 30 * MINUTE },
      { attempts: 100, lockMs: 2 * HOUR },
    ],
    decayMs: 2 * HOUR,
  },
};

export function decayMsFor(scope: LoginScope): number {
  return POLICIES[scope].decayMs;
}

/**
 * Segundos que faltan para que el ámbito vuelva a aceptar intentos.
 * 0 = no está bloqueado.
 */
export function retryAfterSeconds(
  scope: LoginScope,
  attempts: number,
  lastAttemptAt: Date,
  now: Date = new Date(),
): number {
  const policy = POLICIES[scope];
  const sinceLast = now.getTime() - lastAttemptAt.getTime();

  // Contador caducado: se considera un historial limpio.
  if (sinceLast >= policy.decayMs) return 0;

  let lockMs = 0;
  for (const step of policy.steps) {
    if (attempts >= step.attempts) lockMs = step.lockMs;
  }
  if (lockMs === 0) return 0;

  const remainingMs = lockMs - sinceLast;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}
