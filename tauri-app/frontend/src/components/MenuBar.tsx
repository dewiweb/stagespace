import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useMoveEditorStore } from '../store/useMoveEditorStore';
import { useOscArmed } from '../hooks/useOscArmed';
import { importHolProject, loadShow, saveShow } from '../utils/showFileActions';
import { doCueGo, doGo, doPanic, doStop } from '../utils/liveActions';

/// Barre de menus applicative — File/Edit/View/Show/Help, la convention
/// de toute app desktop. Chaque entrée dispatch vers la MÊME action que
/// les raccourcis et les boutons (liveActions / showFileActions) — le
/// menu est une troisième porte, pas un troisième chemin de code. Les
/// menus affichent l'état live (✓ surface courante, ✓ OSC LIVE) là où
/// une toolbar ne le peut pas.

interface Item {
  label: string;
  shortcut?: string;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  separator?: false;
}
interface Sep {
  separator: true;
}
type Entry = Item | Sep;

interface Menu {
  label: string;
  entries: Entry[];
}

export const MenuBar: React.FC = () => {
  const [openMenu, setOpenMenu] = React.useState<string | null>(null);
  const barRef = React.useRef<HTMLDivElement | null>(null);

  const surface = useMoveEditorStore((s) => s.surface);
  const setSurface = useMoveEditorStore((s) => s.setSurface);
  const showExpert = useMoveEditorStore((s) => s.showExpert);
  const setShowExpert = useMoveEditorStore((s) => s.setShowExpert);
  const setShortcutsOpen = useMoveEditorStore((s) => s.setShortcutsOpen);
  // editorFocus reste un state local d'AppMain — le menu bascule Expert,
  // le split 50/50 est accessible ensuite via le bouton Focus existant.
  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);
  const canUndo = useGraphStore((s) => s.canUndo);
  const canRedo = useGraphStore((s) => s.canRedo);
  const [armed, setArmed] = useOscArmed();

  // Clic dehors / Esc ferment le menu ouvert.
  React.useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  const menus: Menu[] = [
    {
      label: 'File',
      entries: [
        { label: 'Save Show…', onClick: () => void saveShow() },
        { label: 'Load Show…', onClick: () => void loadShow() },
        { separator: true },
        { label: 'Import Holophonix project…', onClick: () => void importHolProject() },
      ],
    },
    {
      label: 'Edit',
      entries: [
        { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !canUndo, onClick: undo },
        { label: 'Redo', shortcut: 'Ctrl+Y', disabled: !canRedo, onClick: redo },
      ],
    },
    {
      label: 'View',
      entries: [
        { label: 'Atelier — composer', checked: surface === 'atelier', onClick: () => setSurface('atelier') },
        { label: 'Conduite — run the show', checked: surface === 'conduite', onClick: () => setSurface('conduite') },
        { label: 'Jeu — perform live', checked: surface === 'jeu', onClick: () => setSurface('jeu') },
        { separator: true },
        {
          label: 'Expert graph editor',
          checked: showExpert,
          onClick: () => setShowExpert(!showExpert),
        },
      ],
    },
    {
      label: 'Show',
      entries: [
        { label: 'SETLIST GO — next move', shortcut: 'Enter', onClick: () => doGo('menu') },
        { label: 'CUE GO — fire armed cue', onClick: () => doCueGo('menu') },
        { label: 'Stop all moves', onClick: () => doStop() },
        { separator: true },
        {
          label: armed ? 'OSC LIVE — click for DRY-RUN' : 'OSC DRY-RUN — click to go LIVE',
          checked: armed,
          onClick: () => setArmed(!armed),
        },
        { separator: true },
        { label: 'PANIC — stop + reset positions', shortcut: 'Esc', danger: true, onClick: () => doPanic() },
      ],
    },
    {
      label: 'Help',
      entries: [
        { label: 'Keyboard shortcuts', shortcut: '?', onClick: () => setShortcutsOpen(true) },
      ],
    },
  ];

  const run = (item: Item) => {
    setOpenMenu(null);
    item.onClick?.();
  };

  return (
    <div ref={barRef} className="flex items-center" role="menubar">
      {menus.map((menu) => (
        <div key={menu.label} className="relative">
          <button
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openMenu === menu.label}
            onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
            // Un menu ouvert suit le survol — comportement standard des
            // menubars desktop (pas de re-clic pour changer de menu).
            onMouseEnter={() => openMenu && setOpenMenu(menu.label)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              openMenu === menu.label
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {menu.label}
          </button>
          {openMenu === menu.label && (
            <div
              role="menu"
              className="absolute left-0 top-full mt-0.5 min-w-[240px] bg-gray-850 bg-gray-900 border border-gray-700 rounded-md shadow-xl py-1 z-50"
            >
              {menu.entries.map((entry, i) =>
                'separator' in entry && entry.separator ? (
                  <div key={i} className="my-1 border-t border-gray-700/60" />
                ) : (
                  <button
                    key={i}
                    role="menuitem"
                    disabled={(entry as Item).disabled}
                    onClick={() => run(entry as Item)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                      (entry as Item).disabled
                        ? 'text-gray-600 cursor-default'
                        : (entry as Item).danger
                          ? 'text-red-400 hover:bg-red-900/30'
                          : 'text-gray-300 hover:bg-gray-700/60'
                    }`}
                  >
                    <span className="w-3 text-center text-[10px]">
                      {(entry as Item).checked ? '✓' : ''}
                    </span>
                    <span className="flex-1">{(entry as Item).label}</span>
                    {(entry as Item).shortcut && (
                      <span className="text-[10px] text-gray-500">{(entry as Item).shortcut}</span>
                    )}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
