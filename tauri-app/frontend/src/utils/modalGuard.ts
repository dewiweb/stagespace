import React from 'react';

/// Compteur global de modals/pickers ouverts.
///
/// Les raccourcis live (Esc=panic, Enter=GO, Space=play/stop, Backspace=cue
/// précédent) sont attachés à window — un modal ouvert doit les bloquer,
/// sinon une seule frappe déclenche DEUX actions (ex: Esc ferme le modal
/// Settings ET panique le show).
///
/// Usage : `useModalGuard()` dans tout composant modal/overlay (il
/// incrémente au mount, décrémente au unmount). Le handler de raccourcis
/// vérifie `isModalOpen()` en premier.
let modalDepth = 0;

export function isModalOpen(): boolean {
  return modalDepth > 0;
}

/// Hook : marque le composant comme modal tant qu'il est monté.
/// Idempotent et sûr en StrictMode (le double mount/unmount se compense).
export function useModalGuard(): void {
  React.useEffect(() => {
    modalDepth += 1;
    return () => {
      modalDepth = Math.max(0, modalDepth - 1);
    };
  }, []);
}

/// Variante conditionnelle : pour les overlays rendus inline (un flag dans
/// le composant parent plutôt qu'un composant dédié monté/démonté).
export function useModalGuardOn(open: boolean): void {
  React.useEffect(() => {
    if (!open) return;
    modalDepth += 1;
    return () => {
      modalDepth = Math.max(0, modalDepth - 1);
    };
  }, [open]);
}
