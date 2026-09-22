import React from 'react';
import { Play, Square, Globe, X, SlidersHorizontal, ListOrdered, AudioLines } from 'lucide-react';
import { TrackGrid } from './TrackGrid';
import { AudioModList } from './AudioModControls';
import Scene3D from './Scene3D';
import CuelistPanel from './CuelistPanel';
import { Slider } from './ui/Slider';
import { useGraphStore } from '../store/useGraphStore';
import { useAnimationStore } from '../store/useAnimationStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { PARAM_SCHEMA, type NodeParamValue, type GraphNodeData, type ParamDef } from './nodeParamSchema';
import type { NodeType } from '../store/types/index';
import { toast } from '../utils/toast-helpers';

/// ── PERFORM VIEW ──
/// Surface live réduite : setlist + cues + canvas + params live à la demande.
/// Ce qui est volontairement absent : node editor, templates/bibliothèque,
/// config OSC, suppression/renommage — tout ce qui peut casser le show.
///
/// Sémantique : tap ▶/■ = layer parallèle · GO = setlist crossfade ·
/// RECALL cue = Shift+Enter (ou double-clic cue) · Esc = panic.

/// Types de nodes "engine" — même liste que l'Inspector (params live du move)
const ENGINE_TYPES = new Set([
  'Circular', 'Elliptical', 'Spiral', 'Lissajous', 'Figure8',
  'Linear', 'Oscillation', 'Formation', 'PerlinNoise', 'Converge', 'Pendulum',
  'RoseCurve', 'Helix', 'Wave', 'CustomTrajectory',
  'Bouncing', 'Avoidance', 'Spring', 'Follow', 'Swarm', 'VectorField',
  'DrawSpline', 'EvaluateSpline', 'TrimSpline', 'OffsetSpline',
  'Mix', 'Group', 'Sequence', 'Crossfade',
]);

/// Nodes qui ont leur propre surface ailleurs dans le drawer — exclus des
/// chips de params (évite les doublons de contrôle).
const NON_PARAM_NODES = new Set(['Objects', 'Duration', 'Output']);

export const PerformView: React.FC = () => {
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const setlistOrder = useGraphStore((s) => s.setlistOrder);
  const currentSetlistIndex = useGraphStore((s) => s.currentSetlistIndex);
  const editingSlotId = useGraphStore((s) => s.editingSlotId);
  const selectSlotForEditing = useGraphStore((s) => s.selectSlotForEditing);
  const playSlot = useGraphStore((s) => s.playSlot);
  const stopSlot = useGraphStore((s) => s.stopSlot);
  const goToNextMove = useGraphStore((s) => s.goToNextMove);
  const panic = useGraphStore((s) => s.panic);
  const pendingPlays = useGraphStore((s) => s.pendingPlays);
  const perfStats = useGraphStore((s) => s.perfStats);
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

  // Ordre d'affichage : setlist d'abord (dans l'ordre), puis les autres slots
  const orderedSlots = [
    ...setlistOrder.map((id) => moveSlots.find((s) => s.id === id)).filter(Boolean),
    ...moveSlots.filter((s) => !setlistOrder.includes(s.id)),
  ] as typeof moveSlots;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-stagespace-bg">
      {/* ═══ Top bar — statut + GO + PANIC ═══ */}
      <div className="h-14 flex items-center gap-4 px-4 border-b border-stagespace-border bg-stagespace-panel flex-shrink-0">
        <div className="flex items-center gap-2">
          <div
            className={`w-3 h-3 rounded-full ${
              playingCount > 0 ? 'bg-green-500 animate-pulse' : 'bg-gray-600'
            }`}
          />
          <span className="text-white text-sm font-bold tabular-nums">
            {playingCount > 0 ? `${playingCount} LIVE` : 'IDLE'}
          </span>
          {perfStats && playingCount > 0 && (
            <span
              className={`text-[10px] font-mono ${
                perfStats.oscErrorRate > 0.05
                  ? 'text-red-400'
                  : 'text-gray-500'
              }`}
            >
              {perfStats.oscRate.toFixed(0)} osc/s
            </span>
          )}
        </div>

        <div className="w-px h-6 bg-stagespace-border" />

        {/* Setlist position + next */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-gray-500 text-[10px] uppercase tracking-wider flex-shrink-0">
            Setlist {currentSetlistIndex + 1}/{setlistOrder.length}
          </span>
          <div className="min-w-0">
            <div className="text-gray-500 text-[10px]">next</div>
            <div className="text-white text-sm font-semibold truncate">
              {nextSetlistSlot?.name ?? '—'}
            </div>
          </div>
          {goFeedback && (
            <span
              className={`text-[10px] animate-pulse ${
                goFeedback.startsWith('ok:') ? 'text-green-400' : 'text-red-400 font-bold'
              }`}
            >
              {goFeedback.slice(4)}
            </span>
          )}
        </div>

        <button
          onClick={handleGO}
          disabled={!nextSetlistSlotId}
          className="px-8 py-2.5 bg-green-600 hover:bg-green-500 text-white text-lg font-black rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
          title="GO : prochain move de la setlist (Enter) — RECALL cue = Shift+Enter"
        >
          GO ▶
        </button>
        <button
          onClick={() => {
            if (isRecalling) return;
            panic();
            toast.warning('PANIC — all moves stopped');
          }}
          className="px-5 py-2.5 bg-red-700 hover:bg-red-600 text-white text-sm font-black rounded-lg transition-colors active:scale-95"
          title="PANIC : stop tout + positions d'origine (Esc)"
        >
          ■ PANIC
        </button>
      </div>

      {/* ═══ Corps : setlist | canvas ═══ */}
      <div className="flex-1 flex overflow-hidden">
        {/* Colonne gauche : moves (layers) + cues */}
        <div className="w-72 flex-shrink-0 border-r border-stagespace-border flex flex-col bg-stagespace-panel min-h-0">
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="px-3 py-2 text-gray-500 text-[10px] uppercase tracking-wider border-b border-stagespace-border">
              Moves — tap = params · <Play size={9} className="inline -mt-0.5" /> = layer
            </div>
            {orderedSlots.map((slot) => {
              const isPlaying = !!slot.movementId || pendingPlays.includes(slot.id);
              const isSelected = editingSlotId === slot.id;
              const setlistIdx = setlistOrder.indexOf(slot.id);
              const isCurrentSetlist = setlistIdx === currentSetlistIndex;
              return (
                <div
                  key={slot.id}
                  onClick={() => selectSlotForEditing(isSelected ? null : slot.id)}
                  title="Params live de ce move"
                  className={`group flex items-center gap-2 px-3 py-2.5 cursor-pointer border-b border-gray-800/40 transition-colors ${
                    isSelected
                      ? 'bg-indigo-900/30 ring-1 ring-inset ring-indigo-600/60'
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
                    title={isPlaying ? 'Stop ce move' : 'Lancer (en layer — les autres continuent)'}
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
                    <div className="text-gray-600 text-[10px]">
                      {slot.trackIds.length} trk
                      {setlistIdx >= 0 && (
                        <span className={isCurrentSetlist ? 'text-purple-400' : ''}>
                          {' '}· set {setlistIdx + 1}
                        </span>
                      )}
                    </div>
                  </div>
                  {isCurrentSetlist && (
                    <span className="text-purple-400 text-[10px] font-bold" title="Setlist courante">●</span>
                  )}
                  <SlidersHorizontal
                    size={12}
                    className={`flex-shrink-0 ${isSelected ? 'text-indigo-300' : 'text-gray-700 group-hover:text-gray-500'}`}
                  />
                </div>
              );
            })}
            {orderedSlots.length === 0 && (
              <div className="px-3 py-6 text-center text-gray-600 text-[11px]">
                Aucun move — quitter Perform (header) pour en créer.
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

  type Scope = 'params' | 'tracks' | 'audio' | 'global';
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

  // Nodes paramétrables du graphe du slot — chacun devient un chip dans le
  // drawer Params (accès direct, sans passer par le node editor).
  // Objects/Duration/Output exclus : n_objects est piloté par le drawer
  // Tracks, duration par le bloc Lecture, track_range est legacy.
  const paramNodes = React.useMemo(
    () =>
      nodes.filter((n) => {
        const t = (n.data as GraphNodeData)?.type;
        return !!t && !NON_PARAM_NODES.has(t) && (PARAM_SCHEMA[t]?.length ?? 0) > 0;
      }),
    [nodes],
  );
  const [paramNodeId, setParamNodeId] = React.useState<string | null>(null);
  // Défaut : le premier node engine (comportement précédent) — sinon le
  // premier node paramétrable. Reset quand le slot édité change.
  const defaultParamNode = React.useMemo(
    () => paramNodes.find((n) => ENGINE_TYPES.has((n.data as GraphNodeData)?.type ?? '')) ?? paramNodes[0] ?? null,
    [paramNodes],
  );
  React.useEffect(() => { setParamNodeId(null); }, [editingSlotId]);
  const paramNode =
    paramNodes.find((n) => n.id === paramNodeId) ?? defaultParamNode;
  const paramNodeType = (paramNode?.data as GraphNodeData | undefined)?.type as NodeType | undefined;
  const paramSchema = paramNodeType ? PARAM_SCHEMA[paramNodeType] ?? [] : [];
  const paramNodeParams = ((paramNode?.data as GraphNodeData | undefined)?.params ?? {}) as Record<string, NodeParamValue>;

  const setNodeParam = (key: string, value: NodeParamValue) => {
    if (!paramNode) return;
    // Hot-swap debouncé intégré dans updateNodeData (updateGraphLive interne)
    updateNodeData(paramNode.id, { params: { ...paramNodeParams, [key]: value } });
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
          'Params du move sélectionné (moteur, speed, fades)')}
        {scopeBtn('tracks', <><ListOrdered size={12} className="inline -mt-0.5" /> Tracks</>, true,
          'Assignation tracks + depth/phase du move sélectionné')}
        {scopeBtn('audio', <><AudioLines size={12} className="inline -mt-0.5" /> Audio</>, true,
          'Mods audio-réactifs du move sélectionné')}
        {scopeBtn('global', <><Globe size={12} className="inline -mt-0.5" /> Global</>, false,
          'Macros globales — affectent TOUS les moves live (merge)')}

        {!slot && playingSlots.length === 0 && (
          <span className="text-gray-600 text-[10px] ml-2">
            tap un move pour ses params · <Play size={9} className="inline -mt-0.5" /> = layer live
          </span>
        )}
        {!slot && playingSlots.length > 0 && (
          <span className="text-gray-600 text-[10px] ml-2">tap un chip pour éditer un move</span>
        )}
        {slot && !slot.movementId && (
          <span className="text-indigo-400/70 text-[10px] ml-2">édition : {slot.name} (stoppé)</span>
        )}
      </div>

      {/* ── Drawer GLOBAL — scope merge : affecte TOUS les moves live ── */}
      {scope === 'global' && (
        <div className="border-t border-orange-900/40 px-4 py-2 flex items-start gap-6 overflow-x-auto max-h-[42vh] overflow-y-auto">
          <div className="flex-shrink-0 w-64 space-y-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-orange-400 text-xs font-bold flex items-center gap-1.5"><Globe size={12} /> Macros globales</span>
              <button
                onClick={() => setScope(null)}
                className="ml-auto text-gray-500 hover:text-white text-xs px-1"
                title="Fermer"
              ><X size={12} /></button>
            </div>
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

      {/* ── Drawer PARAMS — moteur + lecture du move sélectionné ── */}
      {scope === 'params' && slot && (
        <div className="border-t border-indigo-900/40 px-4 py-2 flex items-start gap-6 overflow-x-auto max-h-[42vh] overflow-y-auto">
          {/* Bloc lecture : speed / direction / loop / fades */}
          <div className="flex-shrink-0 w-64 space-y-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-white text-xs font-bold truncate">{slot.name}</span>
              {slot.movementId && (
                <span className={`text-[10px] px-1 rounded ${slot.isPreview ? 'bg-cyan-900 text-cyan-300' : 'bg-green-900 text-green-300'}`}>
                  {slot.isPreview ? 'PREV' : 'LIVE'}
                </span>
              )}
              <button
                onClick={() => setScope(null)}
                className="ml-auto text-gray-500 hover:text-white text-xs px-1"
                title="Fermer les params"
              ><X size={12} /></button>
            </div>
            <Slider
              label="Speed"
              value={slot.macros.speed}
              min={0}
              max={3}
              step={0.05}
              unit="x"
              accent="green"
              live={!!slot.movementId}
              onChange={(v) => setSlotMacros(slot.id, { speed: v })}
            />
            <div className="flex gap-1">
              {(['forward', 'backward', 'ping_pong'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setSlotDirection(slot.id, d)}
                  className={`flex-1 py-1 text-[10px] rounded ${
                    slot.direction === d
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {d === 'ping_pong' ? 'pingpong' : d}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {(['loop', 'oneshot'] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setSlotLoopMode(slot.id, l)}
                  className={`flex-1 py-1 text-[10px] rounded ${
                    slot.loopMode === l
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <Slider
                  label="Fade in"
                  value={current.fade_in}
                  min={0}
                  max={5}
                  step={0.1}
                  unit="s"
                  accent="purple"
                  live={!!slot.movementId}
                  onChange={(v) => updateCurrent({ fade_in: v })}
                />
              </div>
              <div className="flex-1">
                <Slider
                  label="Fade out"
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
          </div>

          {/* Bloc params du graphe — chips de nodes + tous les params du
              node choisi (pas seulement l'engine principal) */}
          {paramNodes.length > 0 && paramNode && (
            <div className="flex-shrink-0 w-[30rem] space-y-1.5">
              {/* Chips de nodes — tap = éditer les params de CE node */}
              <div className="flex flex-wrap gap-1 pb-1">
                {paramNodes.map((n, i) => {
                  const t = (n.data as GraphNodeData)?.type ?? '?';
                  // Indice d'occurrence si plusieurs nodes du même type
                  const sameType = paramNodes.filter((o) => (o.data as GraphNodeData)?.type === t);
                  const occ = sameType.length > 1 ? sameType.indexOf(n) + 1 : 0;
                  const active = paramNode.id === n.id;
                  return (
                    <button
                      key={n.id}
                      onClick={() => setParamNodeId(n.id)}
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                        active
                          ? 'bg-cyan-700 text-white'
                          : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
                      }`}
                      title={`Node ${i + 1} — params`}
                    >
                      {t}{occ > 0 ? ` ${occ}` : ''}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {paramSchema.map((d) => (
                  <NodeParamField
                    key={d.key}
                    def={d}
                    value={paramNodeParams[d.key]}
                    live={!!slot.movementId}
                    onChange={(v) => setNodeParam(d.key, v)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Drawer TRACKS — assignation + depth/phase du move sélectionné ── */}
      {scope === 'tracks' && slot && (
        <div className="border-t border-indigo-900/40 px-4 py-2 max-h-[42vh] overflow-y-auto">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white text-xs font-bold truncate">{slot.name}</span>
            <span className="text-gray-600 text-[10px]">— {slot.trackIds.length} track(s)</span>
            <button
              onClick={() => setScope(null)}
              className="ml-auto text-gray-500 hover:text-white text-xs px-1"
              title="Fermer"
            ><X size={12} /></button>
          </div>
          <TrackGrid
            compact
            tracks={allTrackInfos}
            selectedTrackIds={new Set(slot.trackIds)}
            toggleTrackSelection={(tid) =>
              setSlotTracks(slot.id, slot.trackIds.includes(tid)
                ? slot.trackIds.filter((t) => t !== tid)
                : [...slot.trackIds, tid])
            }
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
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white text-xs font-bold truncate">{slot.name}</span>
            <span className="text-gray-600 text-[10px]">— audio → macros du move</span>
            <button
              onClick={() => setScope(null)}
              className="ml-auto text-gray-500 hover:text-white text-xs px-1"
              title="Fermer"
            ><X size={12} /></button>
          </div>
          <AudioModList />
        </div>
      )}
    </div>
  );
};

/// Champ de paramètre de node — version Perform : sliders bornés pour les
/// numbers, toggle pour boolean, select pour enum, input compact pour le
/// reste. `live` colore le slider quand le move tourne (hot-swap actif).
const NodeParamField: React.FC<{
  def: ParamDef;
  value: NodeParamValue;
  live: boolean;
  onChange: (v: NodeParamValue) => void;
}> = ({ def, value, live, onChange }) => {
  switch (def.type) {
    case 'number':
      if (typeof def.min === 'number' && typeof def.max === 'number') {
        return (
          <Slider
            label={def.label}
            value={typeof value === 'number' ? value : 0}
            min={def.min}
            max={def.max}
            step={def.step ?? 0.1}
            accent="cyan"
            live={live}
            onChange={onChange}
          />
        );
      }
      return (
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-[10px] w-24 flex-shrink-0 truncate">{def.label}</span>
          <input
            type="number"
            step={def.step ?? 0.1}
            min={def.min}
            max={def.max}
            value={typeof value === 'number' ? value : 0}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            className="flex-1 px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-cyan-500 focus:outline-none"
          />
        </div>
      );
    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-[10px] w-24 flex-shrink-0 truncate">{def.label}</span>
          <button
            onClick={() => onChange(value !== true)}
            className={`relative w-9 h-5 rounded-full transition-colors ${value === true ? 'bg-cyan-600' : 'bg-gray-700'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value === true ? 'translate-x-4' : ''}`} />
          </button>
        </div>
      );
    case 'enum':
      return (
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-[10px] w-24 flex-shrink-0 truncate">{def.label}</span>
          <select
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-cyan-500 focus:outline-none"
          >
            {def.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
      );
    case 'vec3': {
      const arr = Array.isArray(value) ? value : [0, 0, 0];
      return (
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-[10px] w-24 flex-shrink-0 truncate">{def.label}</span>
          <input
            type="text"
            value={arr.join(', ')}
            onChange={(e) => {
              const parsed = e.target.value.split(',').map((v) => parseFloat(v.trim()));
              if (parsed.length === 3 && parsed.every((n) => !isNaN(n))) onChange(parsed);
            }}
            className="flex-1 px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-cyan-500 focus:outline-none font-mono"
            placeholder="x, y, z"
          />
        </div>
      );
    }
    case 'text':
    case 'string':
      return (
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-[10px] w-24 flex-shrink-0 truncate">{def.label}</span>
          <input
            type="text"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-cyan-500 focus:outline-none font-mono"
          />
        </div>
      );
    default:
      return null;
  }
};

export default PerformView;
