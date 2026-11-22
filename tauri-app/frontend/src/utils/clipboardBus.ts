/// Bus d'enregistrement du clipboard graphe — useGraphClipboard (monté
/// dans NodeEditor) enregistre ses ops ici pour que le menu Edit de la
/// barre de menus appelle EXACTEMENT les mêmes actions que les raccourcis
/// (MenuBar = troisième porte, pas troisième chemin de code).
/// Pas de store zustand : le menu lit l'état à chaque ouverture (re-render
/// sur openMenu), la réactivité live n'est pas nécessaire.

export interface GraphClipboardOps {
  copy: () => void;
  cut: () => void;
  paste: () => void;
  duplicate: () => void;
  /// Vrai s'il y a une sélection copiable — Copy/Cut/Duplicate désactivés sinon.
  hasSelection: () => boolean;
}

let registered: GraphClipboardOps | null = null;

export function registerGraphClipboard(ops: GraphClipboardOps): () => void {
  registered = ops;
  return () => {
    if (registered === ops) registered = null;
  };
}

export function getGraphClipboardOps(): GraphClipboardOps | null {
  return registered;
}
