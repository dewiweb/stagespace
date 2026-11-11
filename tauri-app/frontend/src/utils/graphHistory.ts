/// Historique undo/redo pour les stores de graphe standalone
/// (Global FX / Modulation) — le store sub a le sien dans
/// useGraphStore ; celui-ci partage la même sémantique : un burst de
/// mutations (drag continu, splice node+edges, multi-delete dans un même
/// geste) fusionne en UNE entrée via une fenêtre de merge.
///
/// Usage : appeler `record(get().nodes, get().edges)` AVANT chaque
/// mutation du store — la capture coûte O(1) (références, pas de copie :
/// les arrays sont immutables par convention).
export function createGraphHistory<N, E>(maxEntries = 50, mergeMs = 400) {
  const past: { nodes: N[]; edges: E[] }[] = [];
  const future: { nodes: N[]; edges: E[] }[] = [];
  let lastAt = 0;

  return {
    /// Capture l'état courant comme cible d'undo — avant la mutation.
    /// Les mutations dans la fenêtre de merge n'ajoutent pas d'entrée.
    record(nodes: N[], edges: E[]): void {
      const now = Date.now();
      if (now - lastAt < mergeMs) return;
      lastAt = now;
      past.push({ nodes, edges });
      if (past.length > maxEntries) past.shift();
      future.length = 0;
    },

    /// Dépile la dernière entrée et pousse l'état courant sur `future` —
    /// retourne le snapshot à appliquer, ou null (rien à défaire).
    undo(nodes: N[], edges: E[]): { nodes: N[]; edges: E[] } | null {
      const prev = past.pop();
      if (!prev) return null;
      future.push({ nodes, edges });
      lastAt = 0; // la mutation qui suit repart sur une fenêtre neuve
      return prev;
    },

    redo(nodes: N[], edges: E[]): { nodes: N[]; edges: E[] } | null {
      const next = future.pop();
      if (!next) return null;
      past.push({ nodes, edges });
      lastAt = 0;
      return next;
    },

    /// Le graphe chargé a changé d'identité (setContext, reset) —
    /// l'historique du graphe précédent ne doit pas le restaurer ici.
    clear(): void {
      past.length = 0;
      future.length = 0;
      lastAt = 0;
    },

    /// Profondeur de pile — tests/diagnostic uniquement.
    depth(): { past: number; future: number } {
      return { past: past.length, future: future.length };
    },
  };
}
