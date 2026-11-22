/// Modale "unsaved changes" — trois choix, convention desktop :
/// Save first (sauve puis exécute l'action), Discard, Cancel.
/// Pilotée par sessionSafety.setPendingUnsavedAction — un seul point
/// de montage dans App couvre Quit/Load/Recent/window-close.
import React from 'react';
import { Modal } from './Modal';
import {
  getPendingUnsavedAction, clearPendingUnsavedAction,
  subscribePendingUnsaved,
} from '../../utils/sessionSafety';
import { saveShow } from '../../utils/showFileActions';

export const UnsavedChangesModal: React.FC = () => {
  const [, force] = React.useReducer((n) => n + 1, 0);
  React.useEffect(() => subscribePendingUnsaved(force), []);
  const pending = getPendingUnsavedAction();
  if (!pending) return null;

  const run = () => {
    const action = pending.run;
    clearPendingUnsavedAction();
    action();
  };

  return (
    <Modal title="Unsaved changes" onClose={clearPendingUnsavedAction} widthClass="max-w-sm">
      <div className="text-sm text-gray-300 mb-4">
        The show has unsaved changes. <span className="text-white font-medium">{pending.label}</span>{' '}
        will lose them.
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={clearPendingUnsavedAction}
          className="px-3 py-1.5 text-xs rounded bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={run}
          className="px-3 py-1.5 text-xs rounded bg-red-900/60 text-red-200 hover:bg-red-800/70 transition-colors"
        >
          Discard changes
        </button>
        <button
          autoFocus
          onClick={() => {
            const action = pending.run;
            // Save d'abord — l'action ne court que si le fichier a été
            // écrit (un dialog annulé ne DOIT pas quitter quand même).
            void saveShow().then((ok) => {
              if (ok) { clearPendingUnsavedAction(); action(); }
            });
          }}
          className="px-3 py-1.5 text-xs rounded bg-cyan-800 text-white hover:bg-cyan-700 transition-colors"
        >
          Save first
        </button>
      </div>
    </Modal>
  );
};
