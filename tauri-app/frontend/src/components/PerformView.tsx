import React from 'react';
import { Play, Square, Globe, SlidersHorizontal, ListOrdered, AudioLines } from 'lucide-react';
import { TrackGrid } from './TrackGrid';
import { AudioModList } from './AudioModControls';
import Scene3D from './Scene3D';
import CuelistPanel from './CuelistPanel';
import { Slider } from './ui/Slider';
import { useGraphStore } from '../store/useGraphStore';
import { useAnimationStore } from '../store/useAnimationStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { type NodeParamValue } from './nodeParamSchema';
import { NodeParamsPanel } from './NodeParamsPanel';
import { PanicButton } from './ui/PanicButton';

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
  const isRecalling = useCuelistStore((s) => s.isRecalling);

  const [goFeedback, setGoFeedback] = React.useState<string | null>(null);

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

  const handleGO = async () => {
    const msg = await goToNextMove();
    if (msg) {
      setGoFeedback(msg.startsWith('GO:') ? `ok:${msg}` : `err:${msg}`);
      setTimeout(() => setGoFeedback(null), 3000);
    }
  };

  // Deux collections distinctes : la setlist est une VUE ordonnée (le flux
  // du show), les layers sont des slots ad-hoc joués en parallèle.
  const setlistSlots = setlistOrder
    .map((id) => moveSlots.find((s) => s.id === id))
    .filter(Boolean) as typeof moveSlots;
  const layerSlots = moveSlots.filter((s) => !setlistOrder.includes(s.id));

  // Row partagée setlist/layers — même interactions (tap = params, ▶/■ = layer)
  const renderSlotRow = (slot: (typeof moveSlots)[number]) => {
    const isPlaying = !!slot.movementId || pendingPlays.includes(slot.id);
    const isSelected = editingSlotId === slot.id;
    const setlistIdx = setlistOrder.indexOf(slot.id);
    const isCurrentSetlist = setlistIdx === currentSetlistIndex;
    const isNextSetlist = setlistIdx === currentSetlistIndex + 1
      || (currentSetlistIndex < 0 && setlistIdx === 0);
    return (
      <div
        key={slot.id}
        onClick={() => selectSlotForEditing(isSelected ? null : slot.id)}
        title="Params live de ce move"
        className={`group flex items-center gap-2 px-3 py-2.5 cursor-pointer border-b border-gray-800/40 transition-colors ${
          isSelected
            ? 'bg-indigo-900/30 ring-1 ring-inset ring-indigo-600/60'
            : isCurrentSetlist
              ? 'bg-purple-900/20 hover:bg-purple-900/30'
              : isPlaying
                ? 'bg-green-900/10 hover:bg-green-900/20'
                : 'hover:bg-gray-800/30'
        }`}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (isPlaying) stopSlot(slot.id);
            else playSlot(slot.id);
          }}
          className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 transition-colors active:scale-95 ${
            isPlaying
              ? 'bg-red-800/80 hover:bg-red-700 text-red-200'
              : 'bg-green-800/80 hover:bg-green-700 text-green-200'
          }`}
          title={isPlaying ? 'Stop this move' : 'Launch (layered — others keep running)'}
        >
          {isPlaying ? <Square size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-white text-xs font-medium truncate">{slot.name}</span>
            {isPlaying && (
              <span
                className={`text-[10px] px-1 rounded ${
                  slot.isPreview ? 'bg-cyan-900 text-cyan-300' : 'bg-green-900 text-green-300'
                }`}
              >
                {slot.isPreview ? 'PREV' : 'LIVE'}
              </span>
            )}
          </div>
          <div className="text-gray-500 text-[10px]">
            {slot.trackIds.length} trk
          </div>
        </div>
        {isCurrentSetlist && (
          <span className="text-purple-400 text-[10px] font-bold flex-shrink-0" title="Setlist courante">◉ NOW</span>
        )}
        {isNextSetlist && !isCurrentSetlist && (
          <span className="text-green-400/80 text-[10px] font-bold flex-shrink-0" title="Prochain GO">→ NEXT</span>
        )}
        <SlidersHorizontal
          size={12}
          className={`flex-shrink-0 ${isSelected ? 'text-indigo-300' : 'text-gray-600 group-hover:text-gray-400'}`}
        />
      </div>
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
          {isRecalling && (
            <span className="text-purple-400 text-xs font-bold animate-pulse flex-shrink-0">
              RECALLING…
            </span>
          )}
          {goFeedback && (
            <span
              className={`text-sm font-bold animate-pulse truncate ${
                goFeedback.startsWith('ok:') ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {goFeedback.slice(4)}
            </span>
          )}
        </div>

        {/* GO — affiche sa cible comme sur une console de show :
            l'opérateur sait ce qui part avant d'appuyer. */}
        <button
          onClick={handleGO}
          disabled={!nextSetlistSlotId}
          className="px-6 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 text-left min-w-[160px]"
          title="GO : prochain move de la setlist (Enter) — RECALL cue = Shift+Enter"
        >
          <div className="text-lg font-black leading-tight">GO ▶</div>
          <div className="text-[11px] font-medium text-green-100/80 truncate leading-tight">
            {nextSetlistSlot ? nextSetlistSlot.name : 'end of setlist'}
          </div>
        </button>
        <PanicButton size="lg" />
      </div>

      {/* ═══ Corps : setlist | canvas ═══ */}
      <div className="flex-1 flex overflow-hidden">
        {/* Colonne gauche : SETLIST (flux du show) + LAYERS (ad-hoc) + cues */}
        <div className="w-72 flex-shrink-0 border-r border-stagespace-border flex flex-col bg-stagespace-panel min-h-0">
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="px-3 py-2 text-gray-400 text-[10px] uppercase tracking-wider border-b border-stagespace-border bg-purple-950/20">
              Setlist — GO avance ici
            </div>
            {setlistSlots.map(renderSlotRow)}
            {setlistSlots.length === 0 && (
              <div className="px-3 py-4 text-gray-600 text-[11px] italic">
                Empty setlist — add moves to the setlist in Edit mode.
              </div>
            )}
            {layerSlots.length > 0 && (
              <>
                <div className="px-3 py-2 text-gray-400 text-[10px] uppercase tracking-wider border-b border-stagespace-border">
                  Layers — <Play size={9} className="inline -mt-0.5" /> joue en parallèle
                </div>
                {layerSlots.map(renderSlotRow)}
              </>
            )}
            {moveSlots.length === 0 && (
              <div className="px-3 py-6 text-center text-gray-600 text-[11px]">
                No moves — leave Perform (header) to create some.
              </div>
            )}
          </div>
          {/* Cues — arm + double-clic recall (déjà protégé) */}
          <div className="h-56 flex-shrink-0 border-t border-stagespace-border flex flex-col min-h-0">
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
  const updateCurrent = useAnimationStore((s) => s.updateCurrent);
  const updateAssignment = useAnimationStore((s) => s.updateAssignment);
  const current = useAnimationStore((s) => s.current);

  const macros = useGraphStore((s) => s.macros);
  const setMacros = useGraphStore((s) => s.setMacros);
  const pushMacrosToRuntime = useGraphStore((s) => s.pushMacrosToRuntime);
  const macroDebounce = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  type Scope = 'params' | 'playback' | 'tracks' | 'audio' | 'global';
  const [scope, setScope] = React.useState<Scope | null>(null);

  const slot = moveSlots.find((s) => s.id === editingSlotId);
  const playingSlots = moveSlots.filter((s) => s.movementId);

  // Macros GLOBALES (merge — affectent tous les moves live). Debounce 100ms
  // comme l'Inspector : un drag de slider ne doit pas spammer l'IPC.
  const setGlobalMacro = (key: string, value: number) => {
    setMacros({ [key]: value } as Partial<typeof macros>);
    if (macroDebounce.current) clearTimeout(macroDebounce.current);
    macroDebounce.current = setTimeout(() => { pushMacrosToRuntime(); }, 100);
  };

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
        <span className="text-gray-500 text-[10px] uppercase tracking-wider flex-shrink-0">
          Live{playingSlots.length > 0 ? ` ${playingSlots.length}` : ''}
        </span>
        {playingSlots.length > 0 && (
          <button
            onClick={() => { selectSlotForEditing(null); setScope(null); }}
            className={`px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${
              !editingSlotId
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
            }`}
            title="Vue d'ensemble — toutes les tracks de tous les moves"
          >
            All
          </button>
        )}
        {playingSlots.map((s) => (
          <button
            key={s.id}
            onClick={() => selectMove(s.id)}
            className={`px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${
              editingSlotId === s.id && scope !== 'global'
                ? 'bg-indigo-600 text-white'
                : 'bg-green-900/40 text-green-300 hover:bg-green-800/50 border border-green-800/50'
            }`}
            title="Params live de ce move"
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
        {scopeBtn('global', <><Globe size={12} className="inline -mt-0.5" /> Global</>, false,
          'Macros globales — affectent TOUS les moves live (merge)')}

        {!slot && playingSlots.length === 0 && (
          <span className="text-gray-600 text-[10px] ml-2">
            tap un move pour ses params · <Play size={9} className="inline -mt-0.5" /> = layer live
          </span>
        )}
        {!slot && playingSlots.length > 0 && (
          <span className="text-gray-600 text-[10px] ml-2">tap a chip to edit a move</span>
        )}
        {slot && (
          <span className="text-indigo-400/70 text-[10px] ml-2 flex items-center gap-1.5">
            édition : {slot.name}
            {slot.movementId
              ? <span className={`px-1 rounded ${slot.isPreview ? 'bg-cyan-900 text-cyan-300' : 'bg-green-900 text-green-300'}`}>{slot.isPreview ? 'PREV' : 'LIVE'}</span>
              : <span className="text-gray-600">(stopped)</span>}
          </span>
        )}
      </div>

      {/* ── Drawer GLOBAL — scope merge : affecte TOUS les moves live ── */}
      {scope === 'global' && (
        <div className="border-t border-orange-900/40 px-4 py-2 flex items-start gap-6 overflow-x-auto max-h-[42vh] overflow-y-auto">
          <div className="flex-shrink-0 w-64 space-y-1">
            <Slider label="Scale" value={macros.scale} min={0.1} max={3} step={0.05} accent="orange" live onChange={(v) => setGlobalMacro('scale', v)} />
            <Slider label="Speed all" value={macros.speed} min={0} max={3} step={0.05} unit="x" accent="orange" live onChange={(v) => setGlobalMacro('speed', v)} />
            <Slider label="Radius ×" value={macros.radius_scale} min={0.1} max={3} step={0.05} accent="orange" live onChange={(v) => setGlobalMacro('radius_scale', v)} />
            <Slider label="Height +" value={macros.height_offset} min={-5} max={5} step={0.1} unit="m" accent="orange" live onChange={(v) => setGlobalMacro('height_offset', v)} />
          </div>
          <div className="flex-shrink-0 w-64 space-y-1">
            <div className="text-gray-500 text-[10px] uppercase tracking-wider">Shift (global)</div>
            <Slider label="X" value={macros.shiftX} min={-10} max={10} step={0.1} unit="m" accent="orange" live onChange={(v) => setGlobalMacro('shiftX', v)} />
            <Slider label="Y" value={macros.shiftY} min={-10} max={10} step={0.1} unit="m" accent="orange" live onChange={(v) => setGlobalMacro('shiftY', v)} />
            <Slider label="Z" value={macros.shiftZ} min={-10} max={10} step={0.1} unit="m" accent="orange" live onChange={(v) => setGlobalMacro('shiftZ', v)} />
          </div>
          <div className="flex-shrink-0 w-64 space-y-1">
            <div className="text-gray-500 text-[10px] uppercase tracking-wider">Rotation (global)</div>
            <Slider label="Yaw" value={macros.yaw} min={-180} max={180} step={1} unit="°" accent="orange" live onChange={(v) => setGlobalMacro('yaw', v)} />
            <Slider label="Pitch" value={macros.pitch} min={-180} max={180} step={1} unit="°" accent="orange" live onChange={(v) => setGlobalMacro('pitch', v)} />
            <Slider label="Roll" value={macros.roll} min={-180} max={180} step={1} unit="°" accent="orange" live onChange={(v) => setGlobalMacro('roll', v)} />
          </div>
        </div>
      )}

      {/* ── Drawer PLAYBACK — lecture du move sélectionné ── */}
      {scope === 'playback' && slot && (
        <div className="border-t border-indigo-900/40 px-4 py-2 flex items-start gap-6 overflow-x-auto max-h-[42vh] overflow-y-auto">
          {/* Speed — gros fader du move */}
          <div className="flex-shrink-0 w-64 space-y-1">
            <div className="text-gray-500 text-[10px] uppercase tracking-wider">Speed</div>
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
              <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-1">Direction</div>
              <div className="flex gap-1">
                {(['forward', 'backward', 'ping_pong'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setSlotDirection(slot.id, d)}
                    className={`flex-1 py-1.5 text-[10px] rounded ${
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
              <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-1">Mode</div>
              <div className="flex gap-1">
                {(['loop', 'oneshot'] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setSlotLoopMode(slot.id, l)}
                    className={`flex-1 py-1.5 text-[10px] rounded ${
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
            <div className="text-gray-500 text-[10px] uppercase tracking-wider">Fades</div>
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
            <div className="text-green-700 text-[10px] mt-1">
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
