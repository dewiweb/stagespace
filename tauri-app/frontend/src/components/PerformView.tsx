import React from 'react';
import { Play } from 'lucide-react';
import Scene3D from './viewer3d/Scene3D';
import CuelistPanel from './panels/CuelistPanel';
import EmptyState from './ui/EmptyState';
import { StatusChip } from './ui/StatusChip';
import { SlotTile } from './show/SlotTile';
import { LiveDrawer } from './perform/LiveDrawer';
import { ParkedChip } from './perform/ParkedChip';
import { useShowStatusStore, startShowStatusPolling } from '../store/useShowStatusStore';
import { cueLabel, tcStr } from '../utils/showFormat';
import { useGraphStore } from '../store/useGraphStore';
import { useMoveEditorStore } from '../store/useMoveEditorStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { doSolo, doStop, doUnsolo, getSoloRestoreIds, doAttention } from '../utils/liveActions';
import { Radar2D } from './jeu/Radar2D';
import { GestureStrip } from './jeu/GestureStrip';
import { isDetachedWindow } from '../utils/safeStorage';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { PanicButton } from './ui/PanicButton';
import { OscArmToggle } from './ui/OscArmToggle';

/// ── PERFORM VIEW ──
/// Surface live réduite : setlist + cues + canvas + params live à la demande.
/// Ce qui est volontairement absent : node editor, templates/bibliothèque,
/// config OSC, suppression/renommage — tout ce qui peut casser le show.
///
/// Sémantique : tap ▶/■ = layer parallèle · GO = setlist crossfade ·
/// RECALL cue = Shift+Enter (ou double-clic cue) · Esc = panic.

export const PerformView: React.FC = () => {
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const setlistOrder = useGraphStore((s) => s.setlistOrder);
  const currentSetlistIndex = useGraphStore((s) => s.currentSetlistIndex);
  const editingSlotId = useGraphStore((s) => s.editingSlotId);
  const selectSlotForEditing = useGraphStore((s) => s.selectSlotForEditing);
  const playSlot = useGraphStore((s) => s.playSlot);
  const stopSlotWithFade = useGraphStore((s) => s.stopSlotWithFade);
  const goToNextMove = useGraphStore((s) => s.goToNextMove);
  const pendingPlays = useGraphStore((s) => s.pendingPlays);
  const addMoveSlot = useGraphStore((s) => s.addMoveSlot);
  const addToSetlist = useGraphStore((s) => s.addToSetlist);
  const isRecalling = useCuelistStore((s) => s.isRecalling);
  const cues = useCuelistStore((s) => s.cues);
  const currentCueIndex = useCuelistStore((s) => s.currentCueIndex);
  const lastTimecode = useCuelistStore((s) => s.lastTimecode);
  const lastTimecodeAt = useCuelistStore((s) => s.lastTimecodeAt);
  const tcChaseEnabled = useCuelistStore((s) => s.tcChaseEnabled);
  const tcFps = useGraphStore((s) => s.timecodeFps);
  const [goFeedback, setGoFeedback] = React.useState<{ ok: boolean; message: string } | null>(null);
  // Mode touch : pads numérotés (busking) + cibles agrandies (tablette).
  // Mode tactile/busking plein écran supprimés — la surface Jeu EST
  // l'instrument (pads permanents au centre, gestes en strip). La
  // conduite est une surface de première classe (nav ATELIER/CONDUITE/
  // JEU) — le bouton y navigue au lieu de l'overlay interne redondant.
  const setSurface = useMoveEditorStore((s) => s.setSurface);
  // État de santé show (parked / consoleAge / armed) — poll unique partagé
  // via useShowStatusStore au lieu d'un setInterval par composant.
  const parked = useShowStatusStore((s) => s.parked);
  const consoleAge = useShowStatusStore((s) => s.consoleAge);
  // Source-de-contrôle par track (badges pads) + solo actif — même
  // sémantique que l'ex-RunView : objectStates keyed par obj_index.
  const objectStates = useGraphStore((s) => s.objectStates);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const soloSavedIds = useGraphStore((s) => s.soloSavedIds);
  // Panneau central : pads (l'instrument, défaut) ou canvas 3D.
  const [centerView, setCenterView] = React.useState<'pads' | '3d'>('pads');
  // Fenêtre détachée (?view=run) — l'édition pure est masquée : le
  // storage est read-only là-bas, créer divergerait sans persister.
  const detached = isDetachedWindow();
  React.useEffect(() => { startShowStatusPolling(); }, []);

  const playingCount = moveSlots.filter((s) => s.movementId).length;

  const nextSetlistSlotId =
    currentSetlistIndex >= 0 && currentSetlistIndex + 1 < setlistOrder.length
      ? setlistOrder[currentSetlistIndex + 1]
      : setlistOrder.length > 0 && currentSetlistIndex < 0
        ? setlistOrder[0]
        : null;
  const nextSetlistSlot = nextSetlistSlotId
    ? moveSlots.find((s) => s.id === nextSetlistSlotId)
    : null;

  // Slot armé (tap dans la liste) — la cible du transport PLAY/STOP.
  const armedSlot = editingSlotId
    ? moveSlots.find((s) => s.id === editingSlotId) ?? null
    : null;
  const armedPlaying = !!armedSlot?.movementId || (armedSlot ? pendingPlays.includes(armedSlot.id) : false);

  // Conduite : cue courante + suivante (affichage console dans la top bar).
  const curCue = currentCueIndex >= 0 ? cues[currentCueIndex] : null;
  const nextCue = currentCueIndex + 1 < cues.length ? cues[currentCueIndex + 1] : null;
  // Timecode : HH:MM:SS:FF au fps configuré, "lost" si silence >1s.
  const tcActive = lastTimecode != null && Date.now() - lastTimecodeAt < 1000;
  const tc = lastTimecode == null ? 'TC —' : tcStr(lastTimecode, tcFps);

  const handleGO = async () => {
    const res = await goToNextMove();
    setGoFeedback(res);
    setTimeout(() => setGoFeedback(null), 3000);
  };

  // Deux collections distinctes : la setlist est une VUE ordonnée (le flux
  // du show), les layers sont des slots ad-hoc joués en parallèle.
  const setlistSlots = setlistOrder
    .map((id) => moveSlots.find((s) => s.id === id))
    .filter(Boolean) as typeof moveSlots;
  const layerSlots = moveSlots.filter((s) => !setlistOrder.includes(s.id));

  // Pad jeu — SlotTile + badges source-de-contrôle (P/H/S) + attention ◎.
  // objectStates est keyed par obj_index : trackId → indexOf(manualOscIds).
  const srcOf = (trackId: number) => objectStates[manualOscIds.indexOf(trackId)];
  const soloId =
    soloSavedIds.length > 0 ? (moveSlots.find((s) => s.movementId)?.id ?? null) : null;
  const renderPad = (slot: (typeof moveSlots)[number], big = false) => {
    const isPlaying = !!slot.movementId || pendingPlays.includes(slot.id);
    const oscNum = slot.oscIndex || moveSlots.indexOf(slot) + 1;
    const parkedTracks = slot.trackIds.filter((t) => srcOf(t) === 'park');
    const heldTracks = slot.trackIds.filter((t) => srcOf(t) === 'hold');
    const firstObj = manualOscIds.indexOf(slot.trackIds[0]);
    return (
      <SlotTile
        key={slot.id}
        slot={slot}
        oscNum={oscNum}
        density="pad"
        big={big}
        isPlaying={isPlaying}
        isSolo={soloId === slot.id}
        canSolo={playingCount > 1}
        parkedTracks={parkedTracks}
        heldTracks={heldTracks}
        onAttention={firstObj >= 0 ? () => doAttention(firstObj) : undefined}
        onPlay={() => void playSlot(slot.id)}
        onStop={() => void stopSlotWithFade(slot.id, slot.fadeOut ?? 1)}
        onSolo={() => (soloId === slot.id ? doUnsolo() : doSolo(oscNum))}
      />
    );
  };

  // Row partagée setlist/layers — même interactions (tap = params, ▶/■ = layer)
  const renderSlotRow = (slot: (typeof moveSlots)[number], showSetlistAdd = false) => {
    const isPlaying = !!slot.movementId || pendingPlays.includes(slot.id);
    const isSelected = editingSlotId === slot.id;
    const setlistIdx = setlistOrder.indexOf(slot.id);
    const oscNum = slot.oscIndex || moveSlots.indexOf(slot) + 1;
    return (
      <SlotTile
        key={slot.id}
        slot={slot}
        oscNum={oscNum}
        density="row"
        isPlaying={isPlaying}
        isSelected={isSelected}
        isCurrentSetlist={setlistIdx === currentSetlistIndex}
        isNextSetlist={setlistIdx === currentSetlistIndex + 1 || (currentSetlistIndex < 0 && setlistIdx === 0)}
        canSolo={playingCount > 1}
        showSetlistAdd={showSetlistAdd}
        onPlay={() => void playSlot(slot.id)}
        onStop={() => void stopSlotWithFade(slot.id, slot.fadeOut ?? 1)}
        onSolo={() => doSolo(oscNum)}
        onSelect={() => selectSlotForEditing(isSelected ? null : slot.id)}
        onAddToSetlist={() => addToSetlist(slot.id)}
      />
    );
  };

  return (
    <div className="live-mode flex-1 flex flex-col overflow-hidden bg-stagespace-bg">
      {/* ═══ Top bar — contexte setlist + transport ═══
          Les métriques moteur (FPS/OSC/CPU) vivent dans la StatusBar
          partagée en bas — ici on ne garde que le contexte du show. */}
      <div className="h-16 flex items-center gap-4 px-4 border-b border-stagespace-border bg-stagespace-panel flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-4 h-4 rounded-full ${
              playingCount > 0 ? 'bg-green-500 animate-pulse' : 'bg-gray-600'
            }`}
          />
          <span className="text-white text-lg font-black tabular-nums tracking-wide">
            {playingCount > 0 ? `${playingCount} LIVE` : 'IDLE'}
          </span>
        </div>

        <div className="w-px h-8 bg-stagespace-border" />

        {/* Position setlist + feedback GO */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-gray-400 text-xs uppercase tracking-wider flex-shrink-0">
            Setlist {currentSetlistIndex + 1}/{setlistOrder.length}
          </span>
          {parked.length > 0 && <ParkedChip parked={parked} compact />}
          {isRecalling && (
            <span className="text-purple-400 text-xs font-bold animate-pulse flex-shrink-0">
              RECALLING…
            </span>
          )}
          {cues.length > 0 && (
            <span
              className="text-xs flex-shrink-0 min-w-0"
              title="Conduite — cue courante / cue suivante (armée)"
            >
              <span className="text-gray-500 uppercase">Cue </span>
              <span className="text-amber-300 font-semibold truncate">{cueLabel(curCue, currentCueIndex)}</span>
              <span className="text-gray-500 mx-1">→</span>
              <span className="text-gray-400 truncate">{nextCue ? cueLabel(nextCue, currentCueIndex + 1) : '—'}</span>
            </span>
          )}
          {goFeedback && (
            <span
              className={`text-sm font-bold animate-pulse truncate ${
                goFeedback.ok ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {goFeedback.message}
            </span>
          )}
        </div>

        {/* PLAY/STOP — transport du slot armé (tap dans la liste).
            Symétrique au GO : GO avance la setlist, PLAY démarre ou
            stoppe le move sélectionné — sans gros bouton, jouer un layer
            demandait de viser un ▶ de 36px dans une rangée. (Space) */}
        <button
          onClick={() => {
            if (!armedSlot) return;
            if (armedPlaying) stopSlotWithFade(armedSlot.id, armedSlot.fadeOut ?? 1);
            else playSlot(armedSlot.id);
          }}
          disabled={!armedSlot}
          className={`px-6 py-2.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 text-left min-w-[140px] text-white ${
            armedPlaying
              ? 'bg-red-600 hover:bg-red-500'
              : 'bg-indigo-600 hover:bg-indigo-500'
          }`}
          title={armedSlot
            ? `${armedPlaying ? 'Stop' : 'Play'} "${armedSlot.name}" — layered, autres moves continuent (Space)`
            : 'Tap a move in the list to arm it, then play/stop it here (Space)'}
        >
          <div className="text-lg font-black leading-tight">
            {armedPlaying ? 'STOP ■' : 'PLAY ▶'}
          </div>
          <div className={`text-xs font-medium truncate leading-tight ${armedPlaying ? 'text-red-100/80' : 'text-indigo-100/80'}`}>
            {armedSlot ? armedSlot.name : 'tap a move'}
          </div>
        </button>

        {/* SETLIST GO — crossfade vers le prochain move de la setlist.
            Distinct du GO de la station Conduite (cue recall) : même
            couleur, sémantique opposée — le label DOIT différer. */}
        <button
          onClick={handleGO}
          disabled={!nextSetlistSlotId}
          className="px-6 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 text-left min-w-[160px]"
          title="SETLIST GO — crossfade vers le prochain move, les layers continuent (Enter). Cue recall (tue la scène) = Shift+Enter ou Conduite"
        >
          <div className="text-lg font-black leading-tight">SETLIST ▶</div>
          <div className="text-xs font-medium text-green-100/80 truncate leading-tight">
            {nextSetlistSlot ? nextSetlistSlot.name : 'end of setlist'}
          </div>
        </button>
        {tcChaseEnabled && (
          <span
            className={`font-mono text-xs px-1.5 py-0.5 rounded border flex-shrink-0 ${
              tcActive ? 'border-emerald-600 text-emerald-400' : 'border-gray-600 text-gray-500'
            }`}
            title={tcActive ? 'Timecode actif (chase on)' : 'TC lost — pas de message depuis >1s'}
          >
            {tcActive ? tc : 'TC lost'}
          </span>
        )}
        <button
          onClick={() => {
            // Fenêtre détachable : même vue conduite, propre process
            // webview — posée sur un écran dédié au FOH.
            WebviewWindow.getByLabel('conduite').then((w) => {
              if (w) void w.setFocus();
              else new WebviewWindow('conduite', {
                url: '/?view=conduite',
                title: 'STAGESPACE — Conduite',
                width: 1100,
                height: 720,
                resizable: true,
              });
            });
          }}
          className="px-3 py-2.5 rounded-lg flex-shrink-0 bg-amber-800/40 hover:bg-amber-700/60 text-amber-200/80 transition-colors active:scale-95"
          title="Conduite dans une fenêtre détachable (écran dédié)"
        >
          ⧉
        </button>
        <button
          onClick={() => {
            // Surface de jeu détachable — pads + radar + transport sur
            // écran dédié (la surface à jouer, pas l'admin).
            WebviewWindow.getByLabel('run').then((w) => {
              if (w) void w.setFocus();
              else new WebviewWindow('run', {
                url: '/?view=run',
                title: 'STAGESPACE — Run',
                width: 1200,
                height: 760,
                resizable: true,
              });
            });
          }}
          className="px-3 py-2.5 rounded-lg flex-shrink-0 bg-green-800/40 hover:bg-green-700/60 text-green-200/80 transition-colors active:scale-95"
          title="Surface de jeu (pads + radar) dans une fenêtre détachable"
        >
          ▶
        </button>
        {!detached && (
          <button
            onClick={() => setSurface('conduite')}
            className="px-3 py-2.5 rounded-lg flex-shrink-0 bg-amber-800/60 hover:bg-amber-700/80 text-amber-100 text-xs font-bold uppercase tracking-wide transition-colors active:scale-95"
            title="Vue conduite plein écran — NOW/NEXT cue, TC, ARM (lisible à distance)"
          >
            Conduite
          </button>
        )}
        {consoleAge !== null && (
          <StatusChip
            variant={consoleAge < 5 ? 'live' : 'dim'}
            className="flex-shrink-0"
            title={consoleAge < 5 ? 'Console connectée — dernière commande OSC show-control' : `Console idle — dernière commande il y a ${consoleAge.toFixed(0)}s`}
          >
            CONSOLE {consoleAge < 5 ? '●' : '○'}
          </StatusChip>
        )}
        <OscArmToggle />
        <PanicButton size="lg" />
      </div>

      {/* ═══ Strip gestes — les gestes du jeu (spatial, attention
          release) + les actions de secours ex-busking (unsolo/stop all). ═══ */}
      <div className="flex gap-3 px-4 py-2 border-b border-stagespace-border flex-shrink-0 items-stretch">
        <div className="flex-1">
          <GestureStrip />
        </div>
        {getSoloRestoreIds().length > 0 && (
          <button
            onClick={() => doUnsolo()}
            className="px-4 rounded-lg bg-orange-700/80 hover:bg-orange-600 text-orange-100 text-xs font-bold active:scale-95"
            title={`UNSOLO — rejoue les ${getSoloRestoreIds().length} slots stoppés par le solo`}
          >
            UNSOLO
          </button>
        )}
        {playingCount > 0 && (
          <button
            onClick={() => doStop()}
            className="px-4 rounded-lg bg-red-800/70 hover:bg-red-700 text-red-100 text-xs font-bold active:scale-95"
            title="Stop all moves en fondu — moins brutal que PANIC (le renderer reste armé)"
          >
            STOP ALL
          </button>
        )}
      </div>

      {/* ═══ Corps : setlist | canvas ═══ */}
      <div className="flex-1 flex overflow-hidden">
        {/* Colonne gauche : SETLIST (flux du show) + LAYERS (ad-hoc) + cues */}
        <div className="w-80 flex-shrink-0 border-r border-stagespace-border flex flex-col bg-stagespace-panel min-h-0">
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="px-3 py-2 text-gray-400 text-xs uppercase tracking-wider border-b border-stagespace-border bg-purple-950/20 flex items-center justify-between">
              <span>Setlist — GO avance ici</span>
              {/* "+ Move" masqué en fenêtre détachée — créer un slot y
                  serait non persisté (read-only storage) et divergerait
                  de la fenêtre principale. L'édition vit à l'atelier. */}
              {!detached && (
                <button
                  onClick={() => {
                    addMoveSlot();
                    const ms = useGraphStore.getState().moveSlots; const last = ms[ms.length - 1];
                    if (last) addToSetlist(last.id);
                  }}
                  className="px-1.5 py-0.5 rounded text-[10px] text-indigo-300 hover:bg-indigo-600/30 hover:text-white transition-colors normal-case"
                  title="New move added to the setlist"
                >
                  + Move
                </button>
              )}
            </div>
            {setlistSlots.map((slot) => renderSlotRow(slot))}
            {setlistSlots.length === 0 && moveSlots.length > 0 && (
              <div className="px-3 py-4">
                <EmptyState size="sm" title="Empty setlist" hint="+ Move creates one, or use → on a layer." />
              </div>
            )}
            {layerSlots.length > 0 && (
              <>
                <div className="px-3 py-2 text-gray-400 text-xs uppercase tracking-wider border-b border-stagespace-border">
                  Layers — <Play size={9} className="inline -mt-0.5" /> joue en parallèle
                </div>
                {layerSlots.map((slot) => renderSlotRow(slot, true))}
              </>
            )}
            {moveSlots.length === 0 && (
              <div className="px-3 py-4">
                <EmptyState
                  title="No moves yet"
                  hint="A circular trajectory on all tracks — press Space or ▶ to launch it, Enter/GO to advance the setlist."
                  actionLabel="+ Create your first move"
                  onAction={() => {
                    addMoveSlot();
                    const ms = useGraphStore.getState().moveSlots; const last = ms[ms.length - 1];
                    if (last) addToSetlist(last.id);
                  }}
                />
              </div>
            )}
          </div>
          {/* Cues — arm + double-clic recall (déjà protégé). Partage
              flexible de la colonne : la cue list est l'objet central du
              show, elle ne tient pas en 224px (ex-h-56 confiné). */}
          <div className="flex-1 min-h-0 basis-2/5 border-t border-stagespace-border flex flex-col">
            <CuelistPanel readonly />
          </div>
        </div>

        {/* Centre — l'instrument : pads permanents (ex-busking, la
            surface EST le jeu) ou canvas 3D via toggle, + radar. */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-2 px-3 py-1 border-b border-stagespace-border flex-shrink-0">
            <button
              onClick={() => setCenterView('pads')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${centerView === 'pads' ? 'bg-indigo-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Pads
            </button>
            <button
              onClick={() => setCenterView('3d')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${centerView === '3d' ? 'bg-indigo-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            >
              3D
            </button>
          </div>
          {/* Scene3D reste MONTÉ en permanence (hidden quand pads) —
              le ternaire détruisait le contexte WebGL à chaque bascule
              (perte caméra, positions, marqueurs .hol, re-init). Même
              pattern que focusActive dans App.tsx. */}
          <div className={`flex-1 min-h-0 ${centerView === '3d' ? '' : 'hidden'}`}>
            <Scene3D width="100%" height="100%" />
          </div>
          {centerView === 'pads' && (
            <div className={`flex-1 overflow-y-auto p-3 grid gap-3 auto-rows-min content-start ${
              moveSlots.length > 12 ? 'grid-cols-4' : moveSlots.length > 6 ? 'grid-cols-3' : 'grid-cols-2'
            }`}>
              {moveSlots.map((slot) => renderPad(slot))}
              {moveSlots.length === 0 && (
                <div className="col-span-4 py-16">
                  <EmptyState title="Aucun slot" hint="Crée des moves pour remplir les pads." />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Radar — positions réellement émises + grab & throw. */}
        <div className="w-64 flex-shrink-0 border-l border-stagespace-border bg-gray-900/50 p-2 flex flex-col">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1 flex justify-between">
            <span>radar · top</span>
            <span className="normal-case text-gray-600">drag = throw</span>
          </div>
          <Radar2D />
        </div>
      </div>

      {/* ═══ Bottom : chips live + drawer params ═══ */}
      <LiveDrawer />

    </div>
  );
};

export default PerformView;

