import React from 'react';
import Modal from './ui/Modal';
import { useMoveEditorStore } from '../store/useMoveEditorStore';

/// Aide raccourcis live — overlay `?` + bouton Toolbar. La liste doit
/// rester en sync avec hooks/useLiveShortcuts.ts.
const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Space', action: 'Play / stop the selected move' },
  { keys: 'Enter', action: 'GO — crossfade to the next move in the setlist' },
  { keys: 'Shift+Enter', action: 'RECALL next cue — kills all moves, respawns the snapshot' },
  { keys: 'Backspace', action: 'Recall previous cue' },
  { keys: 'Esc', action: 'PANIC — stop all moves, send origin positions' },
  { keys: 'Ctrl+Z', action: 'Undo graph edit' },
  { keys: 'Ctrl+Y / Ctrl+Shift+Z', action: 'Redo graph edit' },
  { keys: 'Ctrl+K', action: 'Quick-add node — searchable palette (also: double-click the canvas)' },
  { keys: '?', action: 'This shortcuts panel' },
];

/// Gestes souris — la moitié "live" de l'interface n'est pas au clavier.
const MOUSE_GESTURES: { gesture: string; action: string }[] = [
  { gesture: 'Drag object (3D / radar)', action: 'Grab → manual position (engine loses control)' },
  { gesture: 'MANUAL bar / radar × badge', action: 'Release object(s) — engine resumes trajectory' },
  { gesture: 'Ctrl+click object', action: 'Release a held object (same as the bar)' },
  { gesture: 'Click radar (near object)', action: 'Select nearest object → inspect bar (state, release/park)' },
  { gesture: 'Assign mode (3D)', action: 'Click objects to toggle their track in the move' },
  { gesture: 'Draw mode (3D)', action: 'Draw a freehand spline trajectory' },
  { gesture: 'Manipulate mode (3D)', action: 'Grab objects directly — proximity grab (~40px)' },
];

export const ShortcutsModal: React.FC = () => {
  const setOpen = useMoveEditorStore((s) => s.setShortcutsOpen);
  return (
    <Modal title="Shortcuts & gestures" onClose={() => setOpen(false)}>
      <div className="px-5 py-4">
        <table className="w-full text-xs">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys} className="border-b border-gray-800/50 last:border-0">
                <td className="py-1.5 pr-4 whitespace-nowrap">
                  <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-200 font-mono text-xs">
                    {s.keys}
                  </kbd>
                </td>
                <td className="py-1.5 text-gray-400">{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 pt-3 border-t border-gray-800">
          <div className="text-gray-300 text-xs font-semibold mb-1">Mouse</div>
          <table className="w-full text-xs">
            <tbody>
              {MOUSE_GESTURES.map((g) => (
                <tr key={g.gesture} className="border-b border-gray-800/50 last:border-0">
                  <td className="py-1.5 pr-4 whitespace-nowrap text-gray-200">{g.gesture}</td>
                  <td className="py-1.5 text-gray-400">{g.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-gray-400 text-xs mt-3">
          Shortcuts are inactive while typing in a field. Esc closes any open panel before panicking.
        </p>
      </div>
    </Modal>
  );
};

export default ShortcutsModal;
