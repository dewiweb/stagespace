import React from 'react';
import { safeGetItem, safeSetItem } from './safeStorage';

/// useState persisté en localStorage — pour l'état de layout (largeurs de
/// panneaux, collapse, splits) : un opérateur qui ajuste son workspace
/// s'attend à le retrouver au prochain lancement.
///
/// Validation : la valeur stockée doit être du même type que `initial`
/// (string/number/boolean) — sinon on retombe sur le défaut plutôt que
/// d'injecter un état corrompu.
export function usePersistedState<T extends string | number | boolean>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = React.useState<T>(() => {
    const raw = safeGetItem(key);
    if (raw === null) return initial;
    try {
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === typeof initial ? (parsed as T) : initial;
    } catch {
      return initial;
    }
  });

  const set: React.Dispatch<React.SetStateAction<T>> = React.useCallback(
    (next) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        safeSetItem(key, JSON.stringify(v));
        return v;
      });
    },
    [key],
  );

  return [value, set];
}
