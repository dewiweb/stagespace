/// Throttle trailing-edge — pour les hot paths IPC (slider drags appellent à
/// chaque pointermove). Garantit : au plus un appel par `intervalMs`, et le
/// DERNIER appel est toujours exécuté (trailing) — l'état final n'est jamais
/// perdu.
///
/// Usage : `const push = throttleTrailing((v) => invoke(...), 33)`
export function throttleTrailing<Args extends unknown[]>(
  fn: (...args: Args) => void,
  intervalMs: number,
): (...args: Args) => void {
  let lastRun = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Args | null = null;

  return (...args: Args) => {
    pendingArgs = args;
    const now = Date.now();
    const elapsed = now - lastRun;
    if (elapsed >= intervalMs && !timer) {
      lastRun = now;
      const a = pendingArgs;
      pendingArgs = null;
      fn(...a);
      return;
    }
    if (!timer) {
      timer = setTimeout(
        () => {
          timer = null;
          lastRun = Date.now();
          const a = pendingArgs;
          pendingArgs = null;
          if (a) fn(...a);
        },
        intervalMs - elapsed,
      );
    }
    // Un timer tourne déjà → pendingArgs écrasé, la dernière valeur gagne.
  };
}

/// Version keyed : un throttle indépendant par clé (ex: par movementId) —
/// deux sliders sur deux slots différents ne s'écrasent pas mutuellement.
export function throttleTrailingKeyed<K, Args extends unknown[]>(
  fn: (key: K, ...args: Args) => void,
  intervalMs: number,
): (key: K, ...args: Args) => void {
  const throttles = new Map<K, (...args: Args) => void>();
  return (key, ...args) => {
    let t = throttles.get(key);
    if (!t) {
      t = throttleTrailing((...a: Args) => fn(key, ...a), intervalMs);
      throttles.set(key, t);
    }
    t(...args);
  };
}
