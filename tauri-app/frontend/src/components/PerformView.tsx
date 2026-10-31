import React from 'react';
import { Play, Globe, SlidersHorizontal, ListOrdered, AudioLines, Pin } from 'lucide-react';
import { TrackGrid } from './TrackGrid';
import { AudioModList } from './AudioModControls';
import Scene3D from './Scene3D';
import CuelistPanel from './CuelistPanel';
import { Slider } from './ui/Slider';
import EmptyState from './ui/EmptyState';
import { StatusChip } from './ui/StatusChip';
import { ShowTransport } from './show/ShowTransport';
import { SlotTile } from './show/SlotTile';
import { MacrosSurface } from './show/MacrosSurface';
import { useShowStatusStore, startShowStatusPolling } from '../store/useShowStatusStore';
import { cueLabel, tcStr } from '../utils/showFormat';
import { useGraphStore } from '../store/useGraphStore';
import { useMoveEditorStore } from '../store/useMoveEditorStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { doSolo, doUnpark, doStop, doUnsolo, getSoloRestoreIds } from '../utils/liveActions';
import { safeInvoke } from '../utils/tauri';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { toast } from '../utils/toast-helpers';
import { type NodeParamValue } from './nodeParamSchema';
import { NodeParamsPanel } from './NodeParamsPanel';
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
  const stopSlot = useGraphStore((s) => s.stopSlot);
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
  const pending = useCuelistStore((s) => s.pending);
  const goToNextCue = useCuelistStore((s) => s.goToNextCue);
  const goToPreviousCue = useCuelistStore((s) => s.goToPreviousCue);

  const [goFeedback, setGoFeedback] = React.useState<{ ok: boolean; message: string } | null>(null);
  // Mode touch : pads numérotés (busking) + cibles agrandies (tablette).
  // Mode tactile supprimé — il doublait buskingMode (pads gros doigt
  // en colonne vs plein écran). Deux surfaces de focus restantes :
  // busking (pads) et conduite (transport).
  // Mode conduite : vue plein écran readable à distance — NOW/NEXT cue,
  // TC, armé, pending timers. Le reste du show continue derrière.
  const [conduiteMode, setConduiteMode] = React.useState(false);
  // Mode busking plein écran : grille de pads géante (tir au doigt).
  const [buskingMode, setBuskingMode] = React.useState(false);
  // État de santé show (parked / consoleAge / armed) — poll unique partagé
  // via useShowStatusStore au lieu d'un setInterval par composant.
  const parked = useShowStatusStore((s) => s.parked);
  const consoleAge = useShowStatusStore((s) => s.consoleAge);
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
  // Lookahead console : la cue après la suivante, en grisé sous NEXT.
  const nextNextCue = currentCueIndex + 2 < cues.length ? cues[currentCueIndex + 2] : null;
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

  // Pad busking (mode touch) — cible 80px+, # = index OSC, tap = play/stop,
  // coin S = solo (fade les autres).
  // Pad busking (mode touch) — délégué à SlotTile (rendu partagé).
  const renderPad = (slot: (typeof moveSlots)[number], big = false) => {
    const isPlaying = !!slot.movementId || pendingPlays.includes(slot.id);
    const oscNum = slot.oscIndex || moveSlots.indexOf(slot) + 1;
    return (
      <SlotTile
        key={slot.id}
        slot={slot}
        oscNum={oscNum}
        density="pad"
        big={big}
        isPlaying={isPlaying}
        canSolo={playingCount > 1}
        onPlay={() => void playSlot(slot.id)}
        onStop={() => void stopSlot(slot.id)}
        onSolo={() => doSolo(oscNum)}
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
        onStop={() => void stopSlot(slot.id)}
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
            if (armedPlaying) stopSlot(armedSlot.id);
            else playSlot(armedSlot.id);
          }}
          disabled={!armedSlot}
          className={`px-6 py-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 text-left min-w-[140px] text-white ${
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

        {/* GO — affiche sa cible comme sur une console de show :
            l'opérateur sait ce qui part avant d'appuyer. */}
        <button
          onClick={handleGO}
          disabled={!nextSetlistSlotId}
          className="px-6 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 text-left min-w-[160px]"
          title="GO : prochain move de la setlist (Enter) — RECALL cue = Shift+Enter"
        >
          <div className="text-lg font-black leading-tight">GO ▶</div>
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
          onClick={() => setBuskingMode(true)}
          className="px-3 py-2 rounded-lg flex-shrink-0 bg-green-800/60 hover:bg-green-700/80 text-green-100 text-xs font-bold uppercase tracking-wide transition-colors active:scale-95"
          title="Busking plein écran — pads géants, tir au doigt (concert non-timecodé)"
        >
          Busking
        </button>
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
          className="px-3 py-2 rounded-lg flex-shrink-0 bg-amber-800/40 hover:bg-amber-700/60 text-amber-200/80 transition-colors active:scale-95"
          title="Conduite dans une fenêtre détachable (écran dédié)"
        >
          ⧉
        </button>
        <button
          onClick={() => setConduiteMode(true)}
          className="px-3 py-2 rounded-lg flex-shrink-0 bg-amber-800/60 hover:bg-amber-700/80 text-amber-100 text-xs font-bold uppercase tracking-wide transition-colors active:scale-95"
          title="Vue conduite plein écran — NOW/NEXT cue, TC, ARM (lisible à distance)"
        >
          Conduite
        </button>
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

      {/* ═══ Corps : setlist | canvas ═══ */}
      <div className="flex-1 flex overflow-hidden">
        {/* Colonne gauche : SETLIST (flux du show) + LAYERS (ad-hoc) + cues */}
        <div className="w-80 flex-shrink-0 border-r border-stagespace-border flex flex-col bg-stagespace-panel min-h-0">
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="px-3 py-2 text-gray-400 text-xs uppercase tracking-wider border-b border-stagespace-border bg-purple-950/20 flex items-center justify-between">
              <span>Setlist — GO avance ici</span>
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
            <CuelistPanel />
          </div>
        </div>

        {/* Canvas 3D */}
        <div className="flex-1 min-w-0">
          <Scene3D width="100%" height="100%" />
        </div>
      </div>

      {/* ═══ Bottom : chips live + drawer params ═══ */}
      <LiveDrawer />

      {/* ═══ Busking plein écran — pads géants pour le tir au doigt ═══ */}
      {buskingMode && (
        <div className="absolute inset-0 z-menu bg-stagespace-bg flex flex-col">
          <div className="flex items-center justify-between px-6 py-3 border-b border-stagespace-border">
            <div className="flex items-center gap-4">
              <span className="text-gray-400 text-sm uppercase tracking-widest">Busking</span>
              <span className={`text-xl font-black ${playingCount > 0 ? 'text-green-400' : 'text-gray-600'}`}>
                {playingCount > 0 ? `${playingCount} LIVE` : 'IDLE'}
              </span>
              {isRecalling && <span className="text-purple-400 font-bold animate-pulse">RECALLING…</span>}
            </div>
            <div className="flex items-center gap-4">
              {getSoloRestoreIds().length > 0 && (
                <button
                  onClick={() => doUnsolo()}
                  className="px-5 py-3 rounded-xl bg-orange-700/80 hover:bg-orange-600 text-orange-100 text-base font-bold active:scale-95"
                  title={`UNSOLO — rejoue les ${getSoloRestoreIds().length} slots stoppés par le solo`}
                >
                  UNSOLO
                </button>
              )}
              {playingCount > 0 && (
                <button
                  onClick={() => doStop()}
                  className="px-5 py-3 rounded-xl bg-red-800/70 hover:bg-red-700 text-red-100 text-base font-bold active:scale-95"
                  title="Stop all moves en fondu — moins brutal que PANIC (le renderer reste armé)"
                >
                  STOP ALL
                </button>
              )}
              <OscArmToggle />
              <PanicButton size="lg" />
              <button
                onClick={() => setBuskingMode(false)}
                className="px-6 py-3 rounded-xl bg-gray-800 text-gray-200 text-lg font-semibold"
              >
                Fermer ✕
              </button>
            </div>
          </div>
          <div className={`flex-1 overflow-y-auto p-4 grid gap-3 auto-rows-min content-start ${
            moveSlots.length > 12 ? 'grid-cols-4' : moveSlots.length > 6 ? 'grid-cols-3' : 'grid-cols-2'
          }`}>
            {moveSlots.map((slot) => renderPad(slot, true))}
            {moveSlots.length === 0 && (
              <div className="col-span-4 py-16">
                <EmptyState title="Aucun slot" hint="Crée des moves pour remplir les pads." />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ Conduite plein écran — lisible à distance (tablette/FOH) ═══ */}
      {conduiteMode && (
        <div className="absolute inset-0 z-menu bg-stagespace-bg flex flex-col">
          <div className="flex items-center justify-between px-8 py-4 border-b border-stagespace-border">
            <span className="text-gray-400 text-sm uppercase tracking-widest">Conduite</span>
            <div className="flex items-center gap-4">
              {parked.length > 0 && <ParkedChip parked={parked} />}
              {consoleAge !== null && (
                <StatusChip
                  variant={consoleAge < 5 ? 'live' : 'dim'}
                  className="text-lg px-3 py-1"
                  title="Dernière commande show-control reçue"
                >
                  CONSOLE {consoleAge < 5 ? '●' : '○'}
                </StatusChip>
              )}
              {tcChaseEnabled && (
                <span className={`font-mono text-2xl font-bold ${tcActive ? 'text-emerald-400' : 'text-gray-600'}`}>
                  {tcActive ? tc : 'TC lost'}
                </span>
              )}
              <button
                onClick={() => setConduiteMode(false)}
                className="px-6 py-3 rounded-xl bg-gray-800 text-gray-200 text-lg font-semibold"
              >
                Fermer ✕
              </button>
            </div>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center gap-8 px-8">
            <div className="text-center">
              <div className="text-gray-500 text-lg uppercase tracking-widest mb-2">Now</div>
              <div className="text-6xl font-black text-amber-300 truncate max-w-[80vw]">
                {curCue ? cueLabel(curCue, currentCueIndex) : '—'}
              </div>
              {pending && (
                <div className="text-orange-400 text-2xl font-bold mt-3 animate-pulse">
                  {pending.kind === 'pre_wait' ? 'pré-attente' : 'follow'} {Math.max(0, (pending.deadline - Date.now()) / 1000).toFixed(1)}s
                </div>
              )}
              {isRecalling && <div className="text-purple-400 text-2xl font-bold mt-3 animate-pulse">RECALLING…</div>}
            </div>
            <div className="text-center">
              <div className="text-gray-500 text-sm uppercase tracking-widest mb-1">Next</div>
              <div className="text-4xl font-bold text-gray-300 truncate max-w-[70vw]">
                {nextCue ? cueLabel(nextCue, currentCueIndex + 1) : '—'}
              </div>
              {nextNextCue && (
                <div className="text-lg text-gray-600 truncate max-w-[60vw] mt-1">
                  then {cueLabel(nextNextCue, currentCueIndex + 2)}
                </div>
              )}
            </div>
            <div className="text-green-400/90 text-xl font-semibold">
              {playingCount > 0 ? `${playingCount} moves live` : 'IDLE'}
            </div>
          </div>
          <div className="px-8 pb-10">
            <ShowTransport
              onPrev={() => void goToPreviousCue()}
              onGo={handleGO}
              onNext={() => void goToNextCue()}
              prevDisabled={isRecalling || currentCueIndex <= 0}
              nextDisabled={isRecalling || currentCueIndex + 1 >= cues.length}
            />
          </div>
        </div>
      )}
    </div>
  );
};

/// Drawer live à scopes — gros boutons à la demande (Params / Tracks /
/// Audio du move sélectionné + Global merge-scope). Panneau bas, PAS modal :
/// le canvas reste visible pendant le tweak — c'est le point de l'app.
const LiveDrawer: React.FC = () => {
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const editingSlotId = useGraphStore((s) => s.editingSlotId);
  const selectSlotForEditing = useGraphStore((s) => s.selectSlotForEditing);
  const setSlotMacros = useGraphStore((s) => s.setSlotMacros);
  const setSlotDirection = useGraphStore((s) => s.setSlotDirection);
  const setSlotLoopMode = useGraphStore((s) => s.setSlotLoopMode);
  const setSlotTracks = useGraphStore((s) => s.setSlotTracks);
  const holProject = useGraphStore((s) => s.holProject);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const nodes = useGraphStore((s) => s.nodes);
  const updateNodeData = useGraphStore((s) => s.updateNodeData);
  const updateCurrent = useMoveEditorStore((s) => s.updateCurrent);
  const updateAssignment = useMoveEditorStore((s) => s.updateAssignment);
  const current = useMoveEditorStore((s) => s.current);


  type Scope = 'params' | 'playback' | 'tracks' | 'audio' | 'global' | 'osc';
  const [scope, setScope] = React.useState<Scope | null>(null);

  const slot = moveSlots.find((s) => s.id === editingSlotId);
  const playingSlots = moveSlots.filter((s) => s.movementId);


  // Params du graphe du slot — chips de nodes + grille de champs via le
  // NodeParamsPanel partagé (même mécanique dans l'Inspector Edit).
  const setNodeParam = (nodeId: string, key: string, value: NodeParamValue, params: Record<string, NodeParamValue>) => {
    // Hot-swap debouncé intégré dans updateNodeData (updateGraphLive interne)
    updateNodeData(nodeId, { params: { ...params, [key]: value } });
  };

  // Tracks du projet (.hol) ou IDs manuels — pour la grille d'assignation
  const trackInfos = (holProject?.tracks ?? []).map((t) => ({
    id: t.id, name: t.name, color: t.color, position: t.position,
  }));
  const allTrackInfos = trackInfos.length > 0
    ? trackInfos
    : manualOscIds.map((id) => ({ id, name: `#${id}` }));

  const selectMove = (slotId: string) => {
    if (editingSlotId === slotId) {
      // Re-tap sur le chip actif → referme le drawer params
      if (scope === 'params') setScope(null);
      else setScope('params');
    } else {
      selectSlotForEditing(slotId);
      setScope('params');
    }
  };

  const toggleScope = (sc: Scope) => setScope((prev) => (prev === sc ? null : sc));

  const scopeBtn = (sc: Scope, label: React.ReactNode, needsSlot: boolean, title: string) => (
    <button
      onClick={() => toggleScope(sc)}
      disabled={needsSlot && !slot}
      className={`px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors active:scale-95 ${
        scope === sc
          ? sc === 'global' ? 'bg-orange-600 text-white' : 'bg-indigo-600 text-white'
          : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white border border-gray-700'
      } disabled:opacity-30 disabled:cursor-not-allowed`}
      title={title}
    >
      {label}
    </button>
  );

  return (
    <div className="flex-shrink-0 border-t border-stagespace-border bg-stagespace-panel">
      {/* Barre : chips des moves live + gros boutons de scope */}
      <div className="flex items-center gap-2 px-3 py-1.5 overflow-x-auto">
        <span className="text-gray-500 text-xs uppercase tracking-wider flex-shrink-0">
          Live{playingSlots.length > 0 ? ` ${playingSlots.length}` : ''}
        </span>
        {playingSlots.length > 0 && (
          <button
            onClick={() => { selectSlotForEditing(null); setScope(null); }}
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              !editingSlotId
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
            }`}
            title="Overview — all tracks of all moves"
          >
            All
          </button>
        )}
        {playingSlots.map((s) => (
          <button
            key={s.id}
            onClick={() => selectMove(s.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              editingSlotId === s.id && scope !== 'global'
                ? 'bg-indigo-600 text-white'
                : 'bg-green-900/40 text-green-300 hover:bg-green-800/50 border border-green-800/50'
            }`}
            title="Live params of this move"
          >
            {s.isPreview ? '◌' : '●'} {s.name}
          </button>
        ))}

        <div className="w-px h-6 bg-stagespace-border mx-1 flex-shrink-0" />

        {scopeBtn('params', <><SlidersHorizontal size={12} className="inline -mt-0.5" /> Params</>, true,
          'Node params of the selected move graph')}
        {scopeBtn('playback', <><Play size={12} className="inline -mt-0.5" /> Playback</>, true,
          'Playback of the selected move (speed, direction, loop, fades)')}
        {scopeBtn('tracks', <><ListOrdered size={12} className="inline -mt-0.5" /> Tracks</>, true,
          'Track assignment + depth/phase of the selected move')}
        {scopeBtn('audio', <><AudioLines size={12} className="inline -mt-0.5" /> Audio</>, true,
          'Audio-reactive mods of the selected move')}
        {scopeBtn('osc', <>OSC IN</>, false,
          'Mappings OSC entrants (fader→param) + learn')}
        {scopeBtn('global', <><Globe size={12} className="inline -mt-0.5" /> Global</>, false,
          'Macros globales — affectent TOUS les moves live (merge)')}

        {!slot && playingSlots.length === 0 && (
          <span className="text-gray-400 text-xs ml-2">
            tap a move for its params · <Play size={9} className="inline -mt-0.5" /> = layer live
            {' · '}<Pin size={9} className="inline -mt-0.5" /> in Edit = curate this surface
          </span>
        )}
        {!slot && playingSlots.length > 0 && (
          <span className="text-gray-400 text-xs ml-2">tap a chip to edit a move</span>
        )}
        {slot && (
          <span className="text-indigo-400/70 text-xs ml-2 flex items-center gap-1.5">
            editing: {slot.name}
            {slot.movementId
              ? <span className={`px-1 rounded ${slot.isPreview ? 'bg-cyan-900 text-cyan-300' : 'bg-green-900 text-green-300'}`}>{slot.isPreview ? 'PREV' : 'LIVE'}</span>
              : <span className="text-gray-400">(stopped)</span>}
          </span>
        )}
      </div>

      {/* ── Drawer GLOBAL — scope merge : affecte TOUS les moves live ── */}
      {scope === 'osc' && <OscMappingsPanel />}

      {scope === 'global' && (
        <div className="border-t border-stagespace-border px-4 py-2 max-h-[42vh] overflow-y-auto">
          <MacrosSurface live includeRadius />
        </div>
      )}

      {/* ── Drawer PLAYBACK — lecture du move sélectionné ── */}
      {scope === 'playback' && slot && (
        <div className="border-t border-indigo-900/40 px-4 py-2 flex items-start gap-6 overflow-x-auto max-h-[42vh] overflow-y-auto">
          {/* Speed — gros fader du move */}
          <div className="flex-shrink-0 w-64 space-y-1">
            <div className="text-gray-500 text-xs uppercase tracking-wider">Speed</div>
            <Slider
              value={slot.macros.speed}
              min={0}
              max={3}
              step={0.05}
              unit="x"
              accent="green"
              layout="stack"
              live={!!slot.movementId}
              onChange={(v) => setSlotMacros(slot.id, { speed: v })}
            />
          </div>
          {/* Direction + loop — groupes de boutons */}
          <div className="flex-shrink-0 w-56 space-y-2">
            <div>
              <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Direction</div>
              <div className="flex gap-1">
                {(['forward', 'backward', 'ping_pong'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setSlotDirection(slot.id, d)}
                    className={`flex-1 py-1.5 text-xs rounded ${
                      slot.direction === d
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {d === 'ping_pong' ? 'pingpong' : d}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Mode</div>
              <div className="flex gap-1">
                {(['loop', 'oneshot'] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setSlotLoopMode(slot.id, l)}
                    className={`flex-1 py-1.5 text-xs rounded ${
                      slot.loopMode === l
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* Fades de cycle */}
          <div className="flex-shrink-0 w-64 space-y-1">
            <div className="text-gray-500 text-xs uppercase tracking-wider">Fades</div>
            <Slider
              label="In"
              value={current.fade_in}
              min={0}
              max={5}
              step={0.1}
              unit="s"
              accent="purple"
              live={!!slot.movementId}
              onChange={(v) => updateCurrent({ fade_in: v })}
            />
            <Slider
              label="Out"
              value={current.fade_out}
              min={0}
              max={5}
              step={0.1}
              unit="s"
              accent="purple"
              live={!!slot.movementId}
              onChange={(v) => updateCurrent({ fade_out: v })}
            />
          </div>
        </div>
      )}

      {/* ── Drawer PARAMS — chips de nodes + tous les params du node choisi ── */}
      {scope === 'params' && slot && (
        <div className="border-t border-indigo-900/40 px-4 py-2 max-h-[42vh] overflow-y-auto">
          <NodeParamsPanel
            nodes={nodes}
            live={!!slot.movementId}
            resetKey={editingSlotId}
            performMode
            onParam={setNodeParam}
            emptyHint="No parametric node in this graph — see Playback / Tracks."
          />
        </div>
      )}

      {/* ── Drawer TRACKS — assignation + depth/phase du move sélectionné ── */}
      {scope === 'tracks' && slot && (
        <div className="border-t border-indigo-900/40 px-4 py-2 max-h-[42vh] overflow-y-auto">
          <TrackGrid
            compact
            tracks={allTrackInfos}
            selectedTrackIds={new Set(slot.trackIds)}
            // IMPORTANT : lire l'état frais du store à chaque appel — les
            // patterns (even/odd/inverse) font une rafale de toggles dans le
            // même tick ; slot.trackIds (prop) serait stale et chaque toggle
            // écraserait le précédent (seul le dernier survivait).
            toggleTrackSelection={(tid) => {
              const fresh = useGraphStore.getState().moveSlots.find((s) => s.id === slot.id)?.trackIds ?? [];
              setSlotTracks(slot.id, fresh.includes(tid)
                ? fresh.filter((t) => t !== tid)
                : [...fresh, tid]);
            }}
            selectAllTracks={() => setSlotTracks(slot.id, allTrackInfos.map((t) => t.id))}
            deselectAllTracks={() => setSlotTracks(slot.id, [])}
            assignments={current.assignments}
            updateAssignment={updateAssignment}
          />
          {slot.movementId && (
            <div className="text-green-700 text-xs mt-1">
              live — toggles appliqués via hot-swap, depth/phase via update_animation_state
            </div>
          )}
        </div>
      )}

      {/* ── Drawer AUDIO — mods audio-réactifs du move sélectionné ── */}
      {scope === 'audio' && slot && (
        <div className="border-t border-indigo-900/40 px-4 py-2 max-h-[42vh] overflow-y-auto">
          <AudioModList />
        </div>
      )}
    </div>
  );
};

export default PerformView;

/// Liste + création des mappings OSC IN — destination texte
/// (`handler:name`, `macro:scale`, `channel:gain:3`, `position:2`) +
/// LEARN : bouge le fader, l'adresse se remplit toute seule.
const OscMappingsPanel: React.FC = () => {
  const oscMappings = useGraphStore((s) => s.oscMappings);
  const addOscMapping = useGraphStore((s) => s.addOscMapping);
  const removeOscMapping = useGraphStore((s) => s.removeOscMapping);
  const setOscMappingEnabled = useGraphStore((s) => s.setOscMappingEnabled);
  const learnAddOscMapping = useGraphStore((s) => s.learnAddOscMapping);
  const [dest, setDest] = React.useState('');
  const [transform, setTransform] = React.useState('');
  const [addr, setAddr] = React.useState('');
  const [learning, setLearning] = React.useState(false);
  const [liveValues, setLiveValues] = React.useState<Record<string, number[]>>({});
  const mappings = Array.from(oscMappings.values());

  // Valeurs live : poll léger — l'opérateur voit son fader bouger dans la
  // liste (feedback immédiat du learn ET du mapping).
  React.useEffect(() => {
    const t = setInterval(() => {
      safeInvoke<Record<string, number[]>>('osc_get_all_values')
        .then((v) => setLiveValues(v ?? {}))
        .catch(() => {});
    }, 500);
    return () => clearInterval(t);
  }, []);

  // Sérialise le transform pour pré-remplir le formulaire à l'édition —
  // addOscMapping remplace à même adresse (insert HashMap) = update.
  const describeTransform = (t: unknown): string => {
    const tr = (t ?? {}) as Record<string, number | null>;
    const parts: string[] = [];
    const dflt: Record<string, number | null> = { scale: 1, offset: 0, smooth: 0, deadzone: 0 };
    for (const k of ['scale', 'offset', 'min', 'max', 'smooth', 'deadzone']) {
      const v = tr[k];
      if (v != null && v !== dflt[k]) parts.push(`${k}=${v}`);
    }
    return parts.join(' ');
  };

  const describe = (d: unknown): string => {
    const m = d as { kind: string };
    if (m.kind === 'channel') {
      const c = d as { channel: string; object: unknown };
      return `channel:${c.channel}:${c.object}`;
    }
    if (m.kind === 'macro') return `macro:${(d as { name: string }).name}`;
    if (m.kind === 'position') return `position:${(d as { object: unknown }).object}`;
    return `handler:${(d as { name: string }).name}`;
  };

  const doLearn = async () => {
    if (!dest.trim()) {
      toast.warning('Enter a destination first (e.g. channel:gain:3 or macro:scale)');
      return;
    }
    setLearning(true);
    const learned = await learnAddOscMapping(dest.trim(), transform.trim() || null);
    setLearning(false);
    if (learned) toast.success(`Learned → ${learned}`);
    else toast.warning('OSC learn timed out — move the fader/knob');
  };

  return (
    <div className="px-4 py-3 space-y-2 text-xs">
      <div className="text-gray-400 uppercase tracking-wider">OSC IN mappings ({mappings.length})</div>
      {mappings.map((m) => (
        <div key={m.address} className={`flex items-center gap-2 py-1 border-b border-gray-800/50 ${m.enabled === false ? 'opacity-40' : ''}`}>
          <input
            type="checkbox"
            checked={m.enabled !== false}
            onChange={(e) => void setOscMappingEnabled(m.address, e.target.checked)}
            className="w-4 h-4 flex-shrink-0"
            title={m.enabled !== false ? 'Disable (kept, no dispatch)' : 'Enable'}
          />
          <span className="text-cyan-300 font-mono truncate flex-1">{m.address}</span>
          {liveValues[m.address] && (
            <span className="text-green-400/80 font-mono text-[10px] tabular-nums">
              {liveValues[m.address].map((v) => v.toFixed(2)).join(' ')}
            </span>
          )}
          <span className="text-gray-400">→</span>
          <span className="text-gray-200">{describe(m.destination)}</span>
          <button
            onClick={() => {
              setAddr(m.address);
              setDest(describe(m.destination));
              setTransform(describeTransform(m.transform));
            }}
            className="text-gray-500 hover:text-cyan-300 px-1"
            title="Edit — pré-remplit le formulaire (Add remplace à même adresse)"
          >
            ✎
          </button>
          <button
            onClick={() => void removeOscMapping(m.address)}
            className="text-gray-600 hover:text-red-400 px-1"
            title="Remove mapping"
          >
            ✕
          </button>
        </div>
      ))}
      {mappings.length === 0 && <div className="text-gray-600 italic">No mappings yet</div>}
      <div className="flex items-center gap-2 pt-1">
        <input
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder="/fader/1"
          className="w-44 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-200 font-mono"
        />
        <span className="text-gray-500">→</span>
        <input
          value={dest}
          onChange={(e) => setDest(e.target.value)}
          placeholder="channel:gain:3 | macro:scale | handler:hp"
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-200 font-mono"
        />
        <input
          value={transform}
          onChange={(e) => setTransform(e.target.value)}
          placeholder="scale=… (opt)"
          className="w-28 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-200 font-mono"
        />
        <button
          onClick={() => {
            if (!addr.trim() || !dest.trim()) { toast.warning('Address + destination required'); return; }
            void addOscMapping(addr.trim(), dest.trim(), transform.trim() || null);
            setAddr('');
          }}
          className="px-3 py-1.5 rounded bg-indigo-600 text-white font-semibold"
        >
          Add
        </button>
        <button
          onClick={() => void doLearn()}
          disabled={learning}
          className={`px-4 py-1.5 rounded font-bold ${learning ? 'bg-cyan-600 animate-pulse' : 'bg-cyan-700 hover:bg-cyan-600'} text-white`}
          title="OSC learn — bouge le fader : l'adresse se remplit"
        >
          {learning ? 'MOVE…' : 'LEARN'}
        </button>
      </div>
    </div>
  );
};

/// Chip objets parkés : affiche le count, au clic un mini-panneau liste
/// chaque objet avec unpark individuel + "Unpark all". `compact` =
/// variante topbar petite.
const ParkedChip: React.FC<{ parked: number[]; compact?: boolean }> = ({ parked, compact }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`rounded-lg bg-cyan-800/70 hover:bg-cyan-700 text-cyan-100 font-bold transition-colors active:scale-95 ${
          compact ? 'px-2 py-1 text-xs' : 'px-4 py-2 text-lg'
        }`}
        title={`Objets parkés (hors recalls) : ${parked.join(', ')} — cliquer pour dégeler`}
      >
        {parked.length} PARKED
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-menu bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-2 min-w-[180px]">
          <div className="text-gray-400 text-[10px] uppercase tracking-wider px-1 pb-1">
            Parked — hors recalls
          </div>
          {parked.map((obj) => (
            <div key={obj} className="flex items-center justify-between gap-2 px-1 py-1">
              <span className="text-cyan-200 font-mono text-sm">obj {obj}</span>
              <button
                onClick={() => doUnpark(obj)}
                className="px-2 py-0.5 rounded bg-gray-700 hover:bg-cyan-700 text-xs text-gray-200"
              >
                unpark
              </button>
            </div>
          ))}
          {parked.length > 1 && (
            <button
              onClick={() => parked.forEach((obj) => doUnpark(obj))}
              className="w-full mt-1 px-2 py-1 rounded bg-cyan-800 hover:bg-cyan-700 text-xs font-semibold text-white"
            >
              Unpark all
            </button>
          )}
        </div>
      )}
    </div>
  );
};
