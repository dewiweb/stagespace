/// Taille réelle d'un élément via ResizeObserver — pour les SVG
/// dont le viewBox doit épouser les pixels affichés (évite les
/// déformations de preserveAspectRatio="none"). En environnement
/// sans ResizeObserver (jsdom), retourne {0,0} — l'appelant choisit
/// un placeholder raisonnable.
import { useEffect, useRef, useState } from 'react';

export function useElementSize<T extends Element>(): [
  React.RefObject<T>,
  { width: number; height: number },
] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      // setState fonctionnel : `size` de la closure serait périmé.
      if (r) setSize((prev) => (prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}
