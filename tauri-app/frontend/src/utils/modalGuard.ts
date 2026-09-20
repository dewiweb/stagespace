import React from 'react';

/// Registre global des modals/pickers ouverts (stack — le dernier ouvert
/// est "on top" et consomme Esc en premier).
///
/// Les raccourcis live (Esc=panic, Enter=GO, Space=play/stop, Backspace=cue
/// précédent) sont attachés à window — un modal ouvert doit les bloquer,
/// sinon une seule frappe déclenche DEUX actions (ex: Esc ferme le modal
/// Settings ET panique le show).
///
/// Usage : `useModalGuard(onClose)` dans tout composant modal/overlay.
/// Esc sur le modal = `closeTopModal()` (appelle `onClose` du modal au
/// sommet de la stack) — jamais le panic.
interface ModalEntry {
  close?: () => void;
}
const modalStack: ModalEntry[] = [];

export function isModalOpen(): boolean {
  return modalStack.length > 0;
}

/// Ferme le modal au sommet de la stack. Retourne true si un modal a été
/// fermé (Esc consommé), false si aucun modal n'était ouvert ou si le
/// modal n'a pas de close handler.
export function closeTopModal(): boolean {
  const top = modalStack[modalStack.length - 1];
  if (!top?.close) return false;
  top.close();
  return true;
}

function pushModal(entry: ModalEntry): () => void {
  modalStack.push(entry);
  return () => {
    const i = modalStack.indexOf(entry);
    if (i >= 0) modalStack.splice(i, 1);
  };
}

/// Hook : marque le composant comme modal tant qu'il est monté.
/// `onClose` : appelé quand Esc est pressé alors que ce modal est on top.
/// Idempotent et sûr en StrictMode (le double mount/unmount se compense).
export function useModalGuard(onClose?: () => void): void {
  // onClose est lu via ref pour éviter de re-pusher la stack à chaque render
  // quand le caller passe une closure inline.
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => {
    return pushModal({ close: () => closeRef.current?.() });
  }, []);
}

/// Variante conditionnelle : pour les overlays rendus inline (un flag dans
/// le composant parent plutôt qu'un composant dédié monté/démonté).
export function useModalGuardOn(open: boolean, onClose?: () => void): void {
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => {
    if (!open) return;
    return pushModal({ close: () => closeRef.current?.() });
  }, [open]);
}
