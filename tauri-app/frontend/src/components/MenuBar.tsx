import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useMoveEditorStore } from '../store/useMoveEditorStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { useOscArmed } from '../hooks/useOscArmed';
import { importHolProject, loadShow, loadShowFromPath, saveShow, basename } from '../utils/showFileActions';
import { useSessionStore } from '../store/useSessionStore';
import { doSetPosition } from '../utils/liveActionsSpatial';
import { getGraphClipboardOps } from '../utils/clipboardBus';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  writePositionClipboard, readPositionClipboard,
  serializePositionClipboard, parsePositionClipboard,
} from '../utils/graphClipboard';
import {
  doCueGo,
  doCueNext,
  doCuePrev,
  doGesture,
  doGo,
  doPanic,
  doSoundcheck,
  doStop,
  doTcChase,
  doToggleSelectedSlot,
  doUnsolo,
} from '../utils/liveActions';
import { useScoreStore } from '../store/useScoreStore';
import { effectiveTrackIds } from '../utils/scoreResolve';
import { detachLaneFromClip, makeClipUnique } from '../utils/scoreDetach';
import { flattenCueClip, reportFlatten } from '../utils/scoreFlatten';
import { toast } from '../utils/toast-helpers';

/// Barre de menus applicative — squelette fixe (File/Edit/View/Show/Help,
/// mémoire musculaire) mais contenu contextuel à la surface, comme une
/// app desktop normale : le menu Show de CONDUITE parle cues (GO armé
/// nommé, recall next/prev, TC chase), celui de JEU parle jeu (gestes,
/// solo/unsolo), celui d'ATELIER reste sobre. Chaque entrée dispatch vers
/// la MÊME action que les raccourcis et les boutons — le menu est une
/// troisième porte, pas un troisième chemin de code.

interface Item {
  label: string;
  shortcut?: string;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
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
  const setActiveAppModal = useMoveEditorStore((s) => s.setActiveAppModal);
  const showDirty = useSessionStore((s) => s.dirty);
  const recentShows = useSessionStore((s) => s.recentShows);
  const undo = useGraphStore((s) => s.undo);
  const redo = useGraphStore((s) => s.redo);
  const canUndo = useGraphStore((s) => s.canUndo);
  const canRedo = useGraphStore((s) => s.canRedo);
  const editingSlotId = useGraphStore((s) => s.editingSlotId);
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const duplicateMoveSlot = useGraphStore((s) => s.duplicateMoveSlot);
  const selectedObjIndex = useGraphStore((s) => s.selectedObjIndex);
  const emittedPositions = useGraphStore((s) => s.emittedPositions);
  const pullShowFromHost = useGraphStore((s) => s.pullShowFromHost);
  // Score — sélection + transport pour les verbes Edit/Show score.
  const scorePlaying = useScoreStore((s) => s.playing);
  const scoreLoopArmed = useScoreStore((s) => s.loopStartMs != null && s.loopEndMs != null);
  const scoreSelectedId = useScoreStore((s) => s.selectedClipId);
  const scoreClips = useScoreStore((s) => s.clips);
  const scoreCursorMs = useScoreStore((s) => s.cursorMs);
  /// Navigateur distant via bridge — le snapshot du show vit sur l'hôte.
  const isRemote = typeof window !== 'undefined' && Boolean((window as { __STAGESPACE_BRIDGE__?: boolean }).__STAGESPACE_BRIDGE__);
  const cues = useCuelistStore((s) => s.cues);
  const armedCueId = useCuelistStore((s) => s.armedCueId);
  const tcChaseEnabled = useCuelistStore((s) => s.tcChaseEnabled);
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

  // Label dynamique du CUE GO — « fire '2 Ensemble' » quand une cue est
  // armée (convention console : le GO dit ce qu'il va tirer).
  const armedCue = armedCueId ? cues.find((c) => c.id === armedCueId) : undefined;
  const cueGoLabel = armedCue
    ? `CUE GO — fire "${armedCue.name}"`
    : 'CUE GO — next cue';

  // Pad sélectionné — label dynamique « Stop 'ZZTest' » / « Play 'Orbit' »
  // (convention app : le menu dit ce que l'action va faire).
  const editingSlot = editingSlotId ? moveSlots.find((s) => s.id === editingSlotId) : undefined;
  const padToggleEntry: Item = editingSlot
    ? {
        label: `${editingSlot.movementId ? 'Stop' : 'Play'} "${editingSlot.name}"`,
        shortcut: 'Space',
        onClick: () => doToggleSelectedSlot('menu'),
      }
    : {
        label: 'Play/Stop pad — no move selected',
        shortcut: 'Space',
        disabled: true,
        disabledReason: 'Click a pad name first',
      };

  // OSC arm — même entrée sur toutes les surfaces, l'état reste visible.
  const oscArmEntry: Item = {
    label: armed ? 'OSC LIVE — click for DRY-RUN' : 'OSC DRY-RUN — click to go LIVE',
    checked: armed,
    onClick: () => setArmed(!armed),
  };
  const panicEntry: Item = {
    label: 'PANIC — stop + reset positions',
    shortcut: 'Esc',
    danger: true,
    onClick: () => doPanic(),
  };
  // Soundcheck — la sonde cyclique d'identification des enceintes n'avait
  // AUCUN accès UI direct (clips score ou OSC uniquement — audit U2).
  // Le ping saute dans le radar/3D : le feedback est visuel par nature.
  const soundcheckEntries: Entry[] = [
    { separator: true },
    { label: 'Soundcheck: start — ping each track', onClick: () => doSoundcheck('start') },
    { label: 'Soundcheck: stop', onClick: () => doSoundcheck('stop') },
    { label: 'Soundcheck: next track', onClick: () => doSoundcheck('next') },
    { label: 'Soundcheck: previous track', onClick: () => doSoundcheck('prev') },
  ];

  // Menu Show contextuel — les verbes qui ont du sens SUR la surface.
  const showMenu: Menu =
    surface === 'conduite'
      ? {
          label: 'Show',
          entries: [
            { label: cueGoLabel, onClick: () => doCueGo('menu') },
            { label: 'Recall next cue', shortcut: 'Shift+Enter', onClick: () => doCueNext('menu') },
            { label: 'Recall previous cue', shortcut: 'Backspace', onClick: () => doCuePrev('menu') },
            { separator: true },
            {
              label: 'Chase timecode',
              checked: tcChaseEnabled,
              onClick: () => doTcChase(!tcChaseEnabled, 'menu'),
            },
            ...soundcheckEntries,
            { separator: true },
            oscArmEntry,
            { separator: true },
            panicEntry,
          ],
        }
      : surface === 'jeu'
        ? {
            label: 'Show',
            entries: [
              { label: 'SETLIST GO — next move', shortcut: 'Enter', onClick: () => doGo('menu') },
              padToggleEntry,
              { separator: true },
              { label: 'Gesture: Explode', onClick: () => doGesture('explode', 3.0, 'menu') },
              { label: 'Gesture: Converge', onClick: () => doGesture('converge', 3.0, 'menu') },
              { label: 'Gesture: Orbit', onClick: () => doGesture('orbit', 3.0, 'menu') },
              { label: 'Gesture: Front', onClick: () => doGesture('front', 3.0, 'menu') },
              ...soundcheckEntries,
              { separator: true },
              // Unsolo — promis par le commentaire du menu mais absent :
              // après un solo, le chemin de retour doit exister partout.
              { label: 'Unsolo — replay slots stopped by solo', onClick: () => doUnsolo('menu') },
              { separator: true },
              { label: 'Stop all moves', onClick: () => doStop() },
              { separator: true },
              oscArmEntry,
              { separator: true },
              panicEntry,
            ],
          }
      : surface === 'score'
        ? {
            // Score — transport du séquenceur backend + loop ; mêmes
            // actions que les boutons de la surface.
            label: 'Show',
            entries: [
              {
                label: scorePlaying ? 'Stop score' : 'Play score',
                onClick: () => (scorePlaying ? useScoreStore.getState().stopScore() : void useScoreStore.getState().playScore()),
              },
              {
                label: scoreLoopArmed ? 'Disarm loop region' : 'Disarm loop region',
                disabled: !scoreLoopArmed,
                disabledReason: 'No loop armed — right-click the ruler to set bounds',
                onClick: () => useScoreStore.getState().setLoop(undefined, undefined),
              },
              { separator: true },
              { label: 'Stop all moves', onClick: () => doStop() },
              { separator: true },
              oscArmEntry,
              { separator: true },
              panicEntry,
            ],
          }
        : {
            // Atelier — transport de répétition : les mêmes verbes mais
            // sans les gestes ni la navigation de cues de la conduite.
            label: 'Show',
            entries: [
              { label: 'SETLIST GO — next move', shortcut: 'Enter', onClick: () => doGo('menu') },
              { label: 'Stop all moves', onClick: () => doStop() },
              { separator: true },
              oscArmEntry,
              { separator: true },
              panicEntry,
            ],
          };

  const menus: Menu[] = [
    {
      label: 'File',
      entries: [
        // La modale de confirmation est montée au niveau App — le menu ne
        // fait qu'armer le flag (un New show vide TOUT, jamais sans
        // confirmation).
        { label: 'New Show', shortcut: 'Ctrl+N', onClick: () => setActiveAppModal('new-show') },
        { separator: true },
        // Save direct si le show a déjà un chemin (convention Ctrl+S) —
        // le • signale des changements non sauvés (dirty session store).
        { label: `Save${showDirty ? ' •' : ''}`, shortcut: 'Ctrl+S', onClick: () => void saveShow() },
        { label: 'Save As…', onClick: () => void saveShow(true) },
        { label: 'Load Show…', shortcut: 'Ctrl+O', onClick: () => void loadShow() },
        // Shows récents — même chemin que loadShow sans dialog
        // (garde dirty via guardDirty, comme tout load).
        ...(recentShows.length > 0
          ? [
              { separator: true } as const,
              ...recentShows.slice(0, 5).map((p) => ({
                label: `Recent: ${basename(p)}`,
                title: p,
                onClick: () => loadShowFromPath(p),
              })),
            ]
          : []),
        // Remote UI : le store local est vide au premier accès — le
        // snapshot poussé par l'hôte au save/load fait foi.
        ...(isRemote
          ? [{ label: 'Sync show from host', onClick: () => void pullShowFromHost() }]
          : []),
        { separator: true },
        { label: 'Import Holophonix project…', onClick: () => void importHolProject() },
        // Quit — desktop uniquement (un remote navigateur ne peut pas
        // fermer la fenêtre hôte ; la croix de la titlebar a le même chemin).
        ...(isRemote ? [] : [
          { separator: true } as const,
          { label: 'Quit', onClick: () => void getCurrentWindow().close() },
        ]),
      ],
    },
    {
      label: 'Edit',
      entries: [
        {
          label: 'Undo',
          shortcut: 'Ctrl+Z',
          disabled: !canUndo,
          disabledReason: 'Nothing to undo',
          onClick: undo,
        },
        {
          label: 'Redo',
          shortcut: 'Ctrl+Y',
          disabled: !canRedo,
          disabledReason: 'Nothing to redo',
          onClick: redo,
        },
        { separator: true },
        // Clipboard nœuds — les ops viennent du bus : useGraphClipboard
        // les enregistre tant que l'éditeur est monté. Le menu appelle
        // les MÊMES fonctions que Ctrl+C/X/V/D (troisième porte).
        ...((): Entry[] => {
          const ops = getGraphClipboardOps();
          const hasSel = ops?.hasSelection() ?? false;
          const dis = (reason: string): Pick<Item, 'disabled' | 'disabledReason'> => ({
            disabled: true,
            disabledReason: reason,
          });
          const noSel = !ops ? dis('Open the graph editor first') : !hasSel ? dis('Select nodes first') : {};
          return [
            { label: 'Cut', shortcut: 'Ctrl+X', ...(!ops ? dis('Open the graph editor first') : noSel), onClick: () => ops?.cut() },
            { label: 'Copy', shortcut: 'Ctrl+C', ...noSel, onClick: () => ops?.copy() },
            { label: 'Paste', shortcut: 'Ctrl+V', ...(ops ? {} : dis('Open the graph editor first')), onClick: () => ops?.paste() },
            { label: 'Duplicate', shortcut: 'Ctrl+D', ...noSel, onClick: () => ops?.duplicate() },
          ];
        })(),
        { separator: true },
        // Duplicate move — cible le slot en cours d'édition, même chemin
        // que le bouton ⧉ de MovesTable.
        {
          label: editingSlot ? `Duplicate move "${editingSlot.name}"` : 'Duplicate move — no slot selected',
          ...(editingSlotId ? { onClick: () => duplicateMoveSlot(editingSlotId) } : { disabled: true, disabledReason: 'Select a move first' }),
        },
        // Score — verbes du clip sélectionné (sélection dans le store :
        // même cible que la toolbar et le menu contextuel). Détacher
        // par piste = une entrée par lane couverte.
        ...(surface === 'score'
          ? ((): Entry[] => {
              const sc = useScoreStore.getState();
              const c = scoreClips.find((x) => x.id === scoreSelectedId);
              if (!c) {
                return [{
                  label: 'Score clip — none selected',
                  disabled: true,
                  disabledReason: 'Select a clip in the score timeline',
                }];
              }
              const eff = effectiveTrackIds(c);
              const isSlot = c.ref.type === 'slot';
              const canSplit =
                isSlot && scoreCursorMs > c.startMs &&
                (c.durationMs == null || scoreCursorMs < c.startMs + c.durationMs);
              const canDetach = isSlot && eff.length > 1;
              const detachDis = { disabled: true, disabledReason: 'Only on multi-object slot clips' };
              return [
                { separator: true },
                {
                  label: 'Split clip at cursor',
                  disabled: !canSplit,
                  disabledReason: 'Cursor outside the clip (or instant marker)',
                  onClick: () => sc.splitClip(c.id, scoreCursorMs),
                },
                { label: 'Duplicate clip', onClick: () => sc.duplicateClip(c.id) },
                {
                  label: 'Delete clip',
                  shortcut: 'Del',
                  onClick: () => { sc.removeClip(c.id); sc.clearScoreSelection(); },
                },
                { separator: true },
                ...eff.flatMap((tid): Entry[] => [
                  {
                    label: `Detach T${tid} to own clip`,
                    ...(canDetach ? { onClick: () => detachLaneFromClip(c.id, tid, false) } : detachDis),
                  },
                  {
                    label: `Detach T${tid} → new move`,
                    ...(canDetach ? { onClick: () => detachLaneFromClip(c.id, tid, true) } : detachDis),
                  },
                ]),
                { separator: true },
                {
                  label: c.ref.type === 'cue' ? 'Make unique — duplicate cue' : 'Make unique — clone move',
                  disabled: !isSlot && c.ref.type !== 'cue',
                  disabledReason: 'Slot/cue clips only',
                  onClick: () => makeClipUnique(c.id),
                },
                {
                  label: 'Flatten cue → clips',
                  disabled: c.ref.type !== 'cue',
                  disabledReason: 'Cue clips only',
                  onClick: () => {
                    const r = flattenCueClip(c.id);
                    if (r) { const rep = reportFlatten(r); toast[rep.kind](rep.message); }
                  },
                },
                {
                  label: c.trackIds === undefined ? 'Freeze coverage (override)' : 'Follow live entity',
                  onClick: () => sc.setClipTrackIds(c.id, c.trackIds === undefined ? eff : undefined),
                },
              ];
            })()
          : []),
        // Copier/coller la position de l'objet sélectionné — mêmes ops
        // que Ctrl+C/V sur la vue 3D.
        ...(selectedObjIndex != null
          ? ([
              {
                label: `Copy position of object ${selectedObjIndex}`,
                shortcut: 'Ctrl+C',
                ...(emittedPositions[selectedObjIndex]
                  ? {
                      onClick: () => {
                        const p = emittedPositions[selectedObjIndex];
                        const pos: [number, number, number] = [p[0], p[1], p[2]];
                        writePositionClipboard(pos);
                        navigator.clipboard?.writeText(serializePositionClipboard(pos)).catch(() => {});
                      },
                    }
                  : { disabled: true, disabledReason: 'No emitted position yet' }),
              },
              {
                label: `Paste position to object ${selectedObjIndex}`,
                shortcut: 'Ctrl+V',
                onClick: () => {
                  const clip = readPositionClipboard();
                  if (clip) {
                    doSetPosition(selectedObjIndex, clip[0], clip[1], clip[2]);
                    return;
                  }
                  navigator.clipboard
                    ?.readText()
                    .then((text) => {
                      const parsed = parsePositionClipboard(text);
                      if (parsed) doSetPosition(selectedObjIndex, parsed[0], parsed[1], parsed[2]);
                    })
                    .catch(() => {});
                },
              },
            ] as Entry[])
          : [{
              label: 'Copy/Paste position — no object selected',
              disabled: true,
              disabledReason: 'Select an object in the 3D view or radar first',
            } as Entry]),
        { separator: true },
        { label: 'Preferences…', onClick: () => setActiveAppModal('settings') },
      ],
    },
    {
      label: 'View',
      entries: [
        { label: 'Atelier — composer', checked: surface === 'atelier', onClick: () => setSurface('atelier') },
        { label: 'Jeu — perform live', checked: surface === 'jeu', onClick: () => setSurface('jeu') },
        { label: 'Score — séquencer dans le temps', checked: surface === 'score', onClick: () => setSurface('score') },
        { label: 'Conduite — run the show', checked: surface === 'conduite', onClick: () => setSurface('conduite') },
        { separator: true },
        {
          label: 'Expert graph editor',
          checked: showExpert,
          disabled: surface !== 'atelier',
          disabledReason: 'Atelier only',
          onClick: () => setShowExpert(!showExpert),
        },
      ],
    },
    showMenu,
    {
      label: 'Help',
      entries: [
        { label: 'Keyboard shortcuts', shortcut: '?', onClick: () => setShortcutsOpen(true) },
        { separator: true },
        { label: 'About STAGESPACE', onClick: () => setActiveAppModal('about') },
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
              className="absolute left-0 top-full mt-0.5 min-w-[240px] bg-gray-900 border border-gray-700 rounded-md shadow-xl py-1 z-50"
            >
              {menu.entries.map((entry, i) =>
                'separator' in entry && entry.separator ? (
                  <div key={i} className="my-1 border-t border-gray-700/60" />
                ) : (
                  <button
                    key={i}
                    role="menuitem"
                    disabled={(entry as Item).disabled}
                    title={(entry as Item).disabled ? (entry as Item).disabledReason : undefined}
                    onClick={() => run(entry as Item)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                      (entry as Item).disabled
                        ? 'text-gray-600 cursor-default'
                        : (entry as Item).danger
                          ? 'text-stagespace-danger hover:bg-stagespace-danger/15'
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
