import React from 'react';
import Modal from './ui/Modal';
import { useAnimationStore } from '../store/useAnimationStore';

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
  { keys: '?', action: 'This shortcuts panel' },
];

export const ShortcutsModal: React.FC = () => {
  const setOpen = useAnimationStore((s) => s.setShortcutsOpen);
  return (
    <Modal title="Keyboard shortcuts" onClose={() => setOpen(false)}>
      <div className="px-5 py-4">
        <table className="w-full text-xs">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys} className="border-b border-gray-800/50 last:border-0">
                <td className="py-1.5 pr-4 whitespace-nowrap">
                  <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-200 font-mono text-[10px]">
                    {s.keys}
                  </kbd>
                </td>
                <td className="py-1.5 text-gray-400">{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-gray-600 text-[10px] mt-3">
          Shortcuts are inactive while typing in a field. Esc closes any open panel before panicking.
        </p>
      </div>
    </Modal>
  );
};

export default ShortcutsModal;
