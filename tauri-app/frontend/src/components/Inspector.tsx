import React from 'react';
import { useMoveEditorStore } from '../store/useMoveEditorStore';
import { useGraphStore, NodeType } from '../store/useGraphStore';
import { TrackGrid } from './TrackGrid';
import { PARAM_SCHEMA, NODE_DESCRIPTIONS, type ParamDef, type NodeParamValue, type GraphNodeData } from './nodeParamSchema';
import { NodeParamsPanel } from './panels/NodeParamsPanel';
import { ParamInput } from './ParamInput';
import { silentCatch } from '../utils/tauri';
import { graphHasStatefulEngine, STATEFUL_PLAYBACK_HINT } from '../utils/graphMigration';

// ── Section repliable ──
function Section({ title, icon, defaultOpen = true, badge, badgeColor = 'gray', children }: {
  title: string; icon: React.ReactNode; defaultOpen?: boolean; badge?: string; badgeColor?: 'gray' | 'orange'; children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const badgeCls = badgeColor === 'orange'
    ? 'text-stagespace-warning bg-stagespace-warning/15 px-1.5 py-0.5 rounded text-xs font-mono animate-pulse'
    : 'text-gray-500 text-xs font-mono';
  return (
    <div className="border-b border-gray-700/40">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800/40 transition-colors">
        <span className="text-xs">{icon}</span>
        <span className="text-gray-300 text-xs font-semibold uppercase tracking-wider flex-1 text-left">{title}</span>
        {badge && <span className={badgeCls}>{badge}</span>}
        <ChevronRight size={11} className={`text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

import Slider from './ui/Slider';
import { GlobalTransformSurface } from './show/GlobalTransformSurface';
import { AudioModList } from './AudioModControls';
import { Zap, AudioLines, Hexagon, SlidersHorizontal, Play, CircleDot, X, Square, ChevronRight, TriangleAlert, Check } from 'lucide-react';
import { PORT_TEXT_COLORS } from '../utils/connectionRules';

export default function Inspector() {
  const showExpert = useMoveEditorStore((s) => s.showExpert);
  const performMode = useMoveEditorStore((s) => s.performMode);
  const current = useMoveEditorStore((s) => s.current);
  const updateCurrent = useMoveEditorStore((s) => s.updateCurrent);
  const updateAssignment = useMoveEditorStore((s) => s.updateAssignment);
  const computeCentroid = useMoveEditorStore((s) => s.computeCentroid);
  const activeMovementIds = useMoveEditorStore((s) => s.activeMovementIds);
  const launchFlash = useMoveEditorStore((s) => s.launchFlash);

  // Sélecteurs granulaires — évite les re-renders à 60fps (movementPositions)
  const holProject = useGraphStore((s) => s.holProject);
  const selectedTrackIds = useGraphStore((s) => s.selectedTrackIds);
  const toggleTrackSelection = useGraphStore((s) => s.toggleTrackSelection);
  const setSelectedTracks = useGraphStore((s) => s.setSelectedTracks);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const panic = useGraphStore((s) => s.panic);
  const playSlot = useGraphStore((s) => s.playSlot);
  const stopSlot = useGraphStore((s) => s.stopSlot);
  const stopAllMovements = useGraphStore((s) => s.stopAllMovements);
  const stopMovement = useGraphStore((s) => s.stopMovement);
  const stopMovementWithFade = useGraphStore((s) => s.stopMovementWithFade);
  const movements = useGraphStore((s) => s.movements);
  const nodes = useGraphStore((s) => s.nodes);
  const updateNodeData = useGraphStore((s) => s.updateNodeData);
  const updateGraphLive = useGraphStore((s) => s.updateGraphLive);
  const editingSlotId = useGraphStore((s) => s.editingSlotId);
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const selectSlotForEditing = useGraphStore((s) => s.selectSlotForEditing);
  // Statut live du slot édité — les edits d'un move ON AIR partent au runtime
  // (hot-swap / update_animation_state), ce badge rend ce scope visible.
  const editingSlot = useGraphStore((s) => s.moveSlots.find((sl) => sl.id === editingSlotId) ?? null);
  const editingIsLive = !!editingSlot?.movementId;
  // Engine à état dans le graphe édité (canvas OU snapshot du slot) →
  // direction backward/pingpong et phase spread interdits (même règle
  // que le guard backend — le grisage évite le contrôle mort + le toast).
  const statefulGraph = graphHasStatefulEngine(nodes) || graphHasStatefulEngine(editingSlot?.graphJson?.nodes);

  // Flash effect on launch
  const [flashClass, setFlashClass] = React.useState('');
  React.useEffect(() => {
    if (launchFlash > 0) {
      setFlashClass('ring-2 ring-stagespace-accent scale-105');
      const t = setTimeout(() => setFlashClass(''), 600);
      return () => clearTimeout(t);
    }
  }, [launchFlash]);

  const tracks = holProject?.tracks ?? [];
  const selectedCount = selectedTrackIds.size;
  const totalTracks = tracks.length || manualOscIds.length;
  const centroid = computeCentroid();
  const hasEditingSlot = editingSlotId !== null;

  // DrawSpline node pour la Spline Library (présent dans les graphs spline)
  const drawSplineNode = React.useMemo(() =>
    nodes.find((n) => (n.data as GraphNodeData)?.type === 'DrawSpline'),
    [nodes]
  );

  // ── Expert mode: node sélectionné ──
  const selectedNode = nodes.find((n) => n.selected);
  const selectedNodeType = (selectedNode?.data as GraphNodeData | undefined)?.type as NodeType | undefined;
  const selectedNodeSchema = selectedNodeType ? PARAM_SCHEMA[selectedNodeType] ?? [] : [];
  const selectedNodeParams: Record<string, NodeParamValue> = (selectedNode?.data as GraphNodeData | undefined)?.params ?? {};

  // ── Audio mod UI ──

  // ── Debounce hot-swap graphe — timer dédié (un slider de param node ne
  // doit pas annuler un hot-swap en attente d'une autre action). ──
  const graphHotSwapDebounce = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNodeParamChange = (key: string, value: NodeParamValue) => {
    if (!selectedNode) return;
    updateNodeData(selectedNode.id, { params: { ...selectedNodeParams, [key]: value } });
    // Hot-swap live avec debounce
    if (graphHotSwapDebounce.current) clearTimeout(graphHotSwapDebounce.current);
    graphHotSwapDebounce.current = setTimeout(() => { updateGraphLive(); }, 150);
  };

  // Rendu param unifié — ParamInput variante 'field' (sliders bornés
  // comme le drawer Params, live = hot-swap actif sur le slot édité).
  const renderNodeParamInput = (def: ParamDef, params: Record<string, NodeParamValue>, onChange: (key: string, value: NodeParamValue) => void) => (
    <ParamInput
      def={def}
      value={params?.[def.key]}
      live={editingIsLive}
      onChange={(v) => onChange(def.key, v)}
      variant="field"
    />
  );

  return (
    <div className="h-full flex flex-col overflow-hidden bg-stagespace-panel">
      {/* Header — sélecteur de move PERMANENT : l'Inspector est toujours
          « l'inspecteur du slot choisi ici ». L'entrée Global = désélection
          explicite (avant : il fallait deviner le clic sur la cellule # de
          la table). ● = move en jeu, ◦ = preview. */}
      <div className="px-3 py-2 border-b border-gray-700/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <select
            value={editingSlotId ?? ''}
            onChange={(e) => selectSlotForEditing(e.target.value === '' ? null : e.target.value)}
            className="flex-1 min-w-0 bg-gray-800 text-white text-xs font-semibold px-2 py-1.5 rounded border border-gray-700 focus:border-stagespace-accent focus:outline-none cursor-pointer"
            title="Move inspecté — Global = vue transform global/audio, aucun move en édition"
          >
            <option value="">◆ Global — no move</option>
            {moveSlots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.movementId ? (slot.isPreview ? '◦ ' : '● ') : '· '}
                {slot.name} · {slot.trackIds.length}trk
              </option>
            ))}
          </select>
          {editingIsLive && (
            <span
              className={`flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold ${
                editingSlot?.isPreview
                  ? 'bg-slate-800/60 text-slate-300 border border-slate-600/50'
                  : 'bg-stagespace-live/20 text-stagespace-live border border-stagespace-live/50 animate-pulse'
              }`}
              title={editingSlot?.isPreview
                ? 'This move runs in preview — edits apply live (no OSC out)'
                : 'ON AIR — les edits de ce panneau partent au renderer en direct'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${editingSlot?.isPreview ? 'bg-slate-400' : 'bg-stagespace-live'}`} />
              {editingSlot?.isPreview ? 'PREVIEW' : 'LIVE'}
            </span>
          )}
        </div>
        {hasEditingSlot && (
          <input
            type="text"
            value={current.name}
            onChange={(e) => updateCurrent({ name: e.target.value, id: current.id })}
            className="mt-1.5 w-full bg-transparent text-white text-sm font-semibold focus:outline-none focus:text-stagespace-accent"
            title="Rename the move"
          />
        )}
      </div>

      {/* Sections scrollables */}
      <div className="flex-1 overflow-y-auto">

        {!hasEditingSlot ? (
          /* ═══════════════ MODE GLOBAL (aucun slot sélectionné) ═══════════════ */
          <>
            {/* (ex-MOVES mini list — remplacée par le sélecteur permanent
                du header : un seul endroit où choisir/désélectionner le
                move inspecté, plus de liste dupliquée face à la table.) */}

            {/* GLOBAL TRANSFORM — merge scope, tous les moves live. Même
                contrôle que le scope 'Global transform' du drawer Jeu. */}
            <Section title="Global transform" icon={<Zap size={12} />} defaultOpen={true}
              badge={activeMovementIds.length > 0 ? `${activeMovementIds.length} live` : undefined}>
              <GlobalTransformSurface includeRadius live />
            </Section>

            {/* AUDIO — mods audio-reactifs globaux */}
            <Section title="Audio" icon={<AudioLines size={12} />} defaultOpen={false} badge={current.audio_mods.length > 0 ? `${current.audio_mods.length}` : undefined}>
              <AudioModList />
            </Section>
          </>
        ) : showExpert ? (
          /* ═══════════════ MODE EXPERT ═══════════════ */

          <>
            {/* NODE SÉLECTIONNÉ — params du node */}
            <Section title="Node" icon={<Hexagon size={12} />} defaultOpen={true}>
              {selectedNode && selectedNodeType ? (
                <>
                  <div className="flex items-center gap-2 px-1 pb-2">
                                        <span className="text-white text-xs font-semibold">{selectedNodeType}</span>
                    {NODE_DESCRIPTIONS[selectedNodeType] && (
                      <span className="text-gray-400 text-xs ml-auto truncate" title={NODE_DESCRIPTIONS[selectedNodeType]}>
                        {NODE_DESCRIPTIONS[selectedNodeType]?.split('—')[0]}
                      </span>
                    )}
                  </div>
                  {selectedNodeSchema.length > 0 ? (
                    <div className="space-y-1.5">
                      {selectedNodeSchema.map((def) => (
                        <div key={def.key}>{renderNodeParamInput(def, selectedNodeParams, handleNodeParamChange)}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-gray-400 text-xs py-1">This node has no parameters</div>
                  )}
                </>
              ) : (
                <div className="text-gray-400 text-xs py-2 text-center">
                  Sélectionnez un node dans le graphe
                  <div className="text-gray-500 text-xs mt-1">Click a node to edit its params</div>
                </div>
              )}
            </Section>

            {/* GLOBAL TRANSFORM — runtime controls appliqués à tous les
                moves (scope merge — voir taxonomie GlobalTransformSurface) */}
            <Section title="Global transform" icon={<Zap size={12} />} defaultOpen={true}
              badge={activeMovementIds.length > 0 ? `${activeMovementIds.length} live` : undefined}>
              <GlobalTransformSurface includeRadius live />
            </Section>
          </>
        ) : (
          /* ═══════════════ MODE SIMPLE ═══════════════ */

          <>
            {/* PARAMS — chips de nodes paramétrables + params du node choisi
                (même composant que le drawer Params de Perform : le graphe
                n'est plus une boîte noire en mode Simple) */}
            <Section title="Params" icon={<SlidersHorizontal size={12} />}>
              <NodeParamsPanel
                nodes={nodes}
                live={editingIsLive}
                resetKey={editingSlotId}
                onParam={(nodeId, key, v, params) =>
                  updateNodeData(nodeId, { params: { ...params, [key]: v } })
                }
                emptyHint="No parametric node — pick a template in the left panel."
              />

              {/* Spline Library — visible quand le graphe contient un DrawSpline */}
              {drawSplineNode && (
                <InspectorSplineLibrary
                  drawSplineNode={drawSplineNode}
                  onUpdate={(points) => {
                    updateNodeData(drawSplineNode.id, { params: { points } });
                    if (graphHotSwapDebounce.current) clearTimeout(graphHotSwapDebounce.current);
                    graphHotSwapDebounce.current = setTimeout(() => { updateGraphLive(); }, 150);
                  }}
                />
              )}
            </Section>

            {/* PERFORM — duration, direction, loop, fade : params AUTHORING
                (la structure du move) — replié en mode Perform où les
                contrôles live sont Params (pinned) et Macros. key force le
                repli à l'entrée/sortie de mode. */}
            <Section key={`perform-${performMode}`} title="Playback" icon={<Play size={12} />} defaultOpen={!performMode}>
              <Slider label="Duration" value={current.duration} min={0.5} max={60} step={0.5} editable onChange={(v) => updateCurrent({ duration: v })} unit="s" />
              <div className="flex gap-1 pt-1">
                {(['forward', 'backward', 'ping_pong'] as const).map((d) => {
                  const blocked = d !== 'forward' && statefulGraph;
                  return (
                  <button key={d} disabled={blocked} onClick={() => updateCurrent({ direction: d })}
                    title={blocked ? STATEFUL_PLAYBACK_HINT : d === 'forward' ? 'Direction — la trajectoire joue dans le sens du dessin' : d === 'backward' ? 'Direction — la trajectoire joue à rebours' : 'Direction — la trajectoire alterne aller/retour'}
                    className={`flex-1 py-1 text-xs rounded ${blocked ? 'bg-gray-800/40 text-gray-700 cursor-not-allowed' : current.direction === d ? 'bg-stagespace-accent text-gray-950' : 'bg-gray-800 text-gray-500'}`}>
                    {d === 'forward' ? '→ Fwd' : d === 'backward' ? '← Bwd' : '↔ Ping'}
                  </button>
                  );
                })}
              </div>
              <div className="flex gap-1">
                {(['loop', 'one_shot'] as const).map((l) => (
                  <button key={l} onClick={() => updateCurrent({ loop_mode: l })}
                    title={l === 'loop' ? 'Loop — la trajectoire recommence en boucle' : 'One-shot — joue une fois puis termine (voir End : revert/hold)'}
                    className={`flex-1 py-1 text-xs rounded ${current.loop_mode === l ? 'bg-stagespace-accent text-gray-950' : 'bg-gray-800 text-gray-500'}`}>
                    {l === 'loop' ? '↻ Loop' : '▶ One-shot'}
                  </button>
                ))}
              </div>
              <Slider label="Fade in" value={current.fade_in} min={0} max={5} step={0.1} onChange={(v) => updateCurrent({ fade_in: v })} unit="s" />
              <Slider label="Fade out" value={current.fade_out} min={0} max={5} step={0.1} onChange={(v) => updateCurrent({ fade_out: v })} unit="s" />
            </Section>

            {/* MOVE TRANSFORM — vraie transform per-move (worker, espace
                local) : scale/rotation pivotent autour du centre de la
                trajectoire du move, shift repositionne le move dans la
                scène. Live quand le slot joue, sans toucher aux autres
                moves ni au global. Composée avec la Global transform. */}
            <Section title="Move transform" icon={<Zap size={12} />}
              badge={editingIsLive ? 'live' : undefined}>
              <div className="text-gray-500 text-xs -mt-0.5 pb-1"
                title="Cette transform n'affecte que ce move — scale/rotation autour du centre de sa trajectoire, shift le repositionne dans la scène. Elle se compose avec la Global transform (toute la scène, pivot = origin).">
                This move only — scale/rotate around its own center{editingIsLive ? ' · live' : ' · effective when playing'}
              </div>
              <Slider label="Speed" value={current.speed} min={0} max={4} step={0.05} editable live={editingIsLive} onChange={(v) => updateCurrent({ speed: v })} unit="x" />
              <Slider label="Scale" value={current.scale} min={0} max={4} step={0.05} editable live={editingIsLive} onChange={(v) => updateCurrent({ scale: v })} />
              <Slider label="Shift X" value={current.offset_x} min={-5} max={5} step={0.1} editable live={editingIsLive} onChange={(v) => updateCurrent({ offset_x: v })} />
              <Slider label="Shift Y" value={current.offset_y} min={-5} max={5} step={0.1} editable live={editingIsLive} onChange={(v) => updateCurrent({ offset_y: v })} />
              <Slider label="Shift Z" value={current.offset_z} min={-5} max={5} step={0.1} editable live={editingIsLive} onChange={(v) => updateCurrent({ offset_z: v })} />
              <Slider label="Yaw" value={current.yaw} min={-180} max={180} step={1} editable live={editingIsLive} onChange={(v) => updateCurrent({ yaw: v })} unit="°" />
              <Slider label="Pitch" value={current.pitch} min={-90} max={90} step={1} editable live={editingIsLive} onChange={(v) => updateCurrent({ pitch: v })} unit="°" />
              <Slider label="Roll" value={current.roll} min={-180} max={180} step={1} editable live={editingIsLive} onChange={(v) => updateCurrent({ roll: v })} unit="°" />
            </Section>

            {/* GLOBAL TRANSFORM — scope merge : toute la scène, pivot =
                origin. Même contrôle qu'en mode Expert et dans le drawer Jeu. */}
            <Section title="Global transform" icon={<Zap size={12} />} defaultOpen={false}
              badge={activeMovementIds.length > 0 ? `${activeMovementIds.length} live` : undefined}>
              <div className="text-gray-500 text-xs -mt-0.5 pb-1"
                title="Transforme toute la scène — tous les moves, pivot = origin de la scène (isobarycentre des tracks). Se compose avec les Move transforms per-move.">
                Whole scene — around the scene origin
              </div>
              <GlobalTransformSurface includeRadius live />
            </Section>
          </>
        )}

        {/* ═══════════════ COMMUN (Simple + Expert — seulement si slot édité) ═══════════════ */}

        {/* AUDIO — mods audio-reactifs (commun aux deux modes) */}
        {hasEditingSlot && (
        <Section title="Audio" icon={<AudioLines size={12} />} defaultOpen={false} badge={current.audio_mods.length > 0 ? `${current.audio_mods.length}` : undefined}>
              <AudioModList />
            </Section>
        )}

        {/* TRACKS — sélection + depth + phase spread (seulement si slot édité)
            Replié en mode Perform : l'assignation se fait aussi par la scène
            (mode Assign) — le grid reste dispo à la demande. */}
        {hasEditingSlot && (
        <Section key={`tracks-${performMode}`} title="Tracks" icon={<CircleDot size={12} />} defaultOpen={!performMode} badge={selectedCount > 0 ? `${selectedCount}/${totalTracks}` : `${totalTracks}`}>
          {tracks.length > 0 ? (
            <TrackGrid
              tracks={tracks}
              selectedTrackIds={selectedTrackIds}
              toggleTrackSelection={toggleTrackSelection}
              setTrackSelection={setSelectedTracks}
              assignments={current.assignments}
              updateAssignment={updateAssignment}
            />
          ) : (
            <div className="text-gray-400 text-xs">
              {manualOscIds.length > 0 ? (
                <TrackGrid
                  tracks={manualOscIds.map((id, i) => ({ id, name: `Object ${id}`, color: `hsl(${(i / manualOscIds.length) * 360}, 70%, 55%)`, position: [0, 0, 0] as [number, number, number] }))}
                  selectedTrackIds={selectedTrackIds}
                  toggleTrackSelection={toggleTrackSelection}
                  setTrackSelection={setSelectedTracks}
                  assignments={current.assignments}
                  updateAssignment={updateAssignment}
                />
              ) : (
                <div className="text-center py-3">
                  <div className="text-gray-400 text-xs mb-1">No track available</div>
                  <div className="text-gray-500 text-xs">Import .hol ou ajoutez des tracks manuelles</div>
                </div>
              )}
            </div>
          )}
          {!showExpert && (
            <>
              <div title={statefulGraph ? STATEFUL_PLAYBACK_HINT : undefined}>
                <Slider label="Spread" value={current.phase_spread} min={0} max={1} step={0.05}
                  disabled={statefulGraph}
                  onChange={(v) => updateCurrent({ phase_spread: v })} />
              </div>
              <div className="text-gray-400 text-xs -mt-1">
                {statefulGraph ? 'Not available on physics engines (re-simulation)' : 'Phase offset between tracks (chasing effect)'}
              </div>
            </>
          )}
          {centroid && (
            <div className="text-stagespace-derived text-xs font-mono pt-1">
              centre: ({centroid[0].toFixed(1)}, {centroid[1].toFixed(1)}, {centroid[2].toFixed(1)})
            </div>
          )}
        </Section>
        )}

      </div>

      {/* Launch — fixe en bas (commun) */}
      <div className="border-t border-gray-700/50 p-2 flex-shrink-0 space-y-1.5">
        {/* Liste des movements actifs avec stop individuel */}
        {movements.length > 0 && (
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {movements.map((mv, idx) => {
              const trackCount = mv.osc_ids?.length ?? 0;
              return (
                <div
                  key={mv.id}
                  className={`flex items-center gap-1.5 px-1.5 py-1 rounded transition-all ${
                    'bg-gray-800/30 border border-gray-700/30 hover:border-gray-600/50'
                  }`}
                >
                  <span className={`text-xs font-mono w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${
                    mv.is_preview ? 'bg-slate-700 text-slate-300' : 'bg-stagespace-live/25 text-stagespace-live'
                  }`}>{idx + 1}</span>
                  <span className="text-white text-xs font-medium truncate flex-1">{mv.name}</span>
                  <span className="text-gray-500 text-xs font-mono flex-shrink-0">{trackCount}tr</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); stopMovementWithFade(mv.id, useGraphStore.getState().moveSlots.find((sl) => sl.movementId === mv.id)?.fadeOut ?? 0.5); }}
                    className="text-stagespace-danger/60 hover:text-stagespace-danger text-xs px-1 flex-shrink-0"
                    title="Stop avec fade (fade_out du slot, 0.5s par défaut)"
                  ><Square size={10} /></button>
                  <button
                    onClick={(e) => { e.stopPropagation(); stopMovement(mv.id); }}
                    className="text-stagespace-danger/70 hover:text-stagespace-danger text-xs px-1 flex-shrink-0"
                    title="Immediate stop"
                  ><Square size={10} fill="currentColor" /></button>
                </div>
              );
            })}
            <button
              onClick={() => stopAllMovements().catch(silentCatch)}
              className="w-full py-1 bg-stagespace-danger/15 hover:bg-stagespace-danger/25 text-stagespace-danger text-xs rounded font-medium transition-colors"
            >
              ■ Stop All
            </button>
          </div>
        )}
        <div className={`flex gap-1.5 transition-all ${flashClass}`}>
          <button
            onClick={() => editingSlot && (editingIsLive ? stopSlot(editingSlot.id) : playSlot(editingSlot.id))}
            disabled={!hasEditingSlot}
            className={`flex-1 py-2 text-xs rounded-lg font-bold transition-colors flex items-center justify-center gap-1.5 border ${
              editingIsLive
                ? 'bg-stagespace-danger/60 hover:bg-stagespace-danger text-white border-stagespace-danger/60'
                : hasEditingSlot
                  ? 'bg-stagespace-live hover:opacity-90 text-gray-950 border-stagespace-live/50'
                  : 'bg-gray-800/40 text-gray-500 border-gray-700/30 cursor-not-allowed'
            }`}
            title={hasEditingSlot ? `${editingIsLive ? 'Stop' : 'Play'} "${editingSlot?.name}" (Space)` : 'Select a slot in Moves first'}
          >
            {editingIsLive ? <Square size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}
            {editingIsLive ? 'STOP' : 'PLAY'}{editingSlot ? ` · ${editingSlot.name}` : ''}
          </button>
          <button
            onClick={() => panic()}
            className="px-2 py-2.5 bg-stagespace-danger hover:opacity-90 text-white text-xs rounded-lg font-bold border border-stagespace-danger/50 transition-colors"
            title="PANIC (Esc) — Stop all + return to origin"
          >
            <TriangleAlert size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}


// ── InspectorSplineLibrary ──────────────────────────────────────────────────
// Section Spline Library pour l'Inspector (mode Simple, tab Params)
function InspectorSplineLibrary({ drawSplineNode, onUpdate }: {
  drawSplineNode: { data?: GraphNodeData } | null;
  onUpdate: (points: string) => void;
}) {
  const savedSplines = useGraphStore((s) => s.savedSplines);
  const saveSpline = useGraphStore((s) => s.saveSpline);
  const deleteSpline = useGraphStore((s) => s.deleteSpline);
  const [showSave, setShowSave] = React.useState(false);
  const [splineName, setSplineName] = React.useState('');

  const pointsParam = drawSplineNode?.data?.params?.points;
  const currentPoints = typeof pointsParam === 'string' ? pointsParam : '';

  const handleSave = () => {
    const name = splineName.trim() || `Spline ${new Date().toLocaleTimeString()}`;
    saveSpline(name, currentPoints);
    setSplineName('');
    setShowSave(false);
  };

  const handleLoad = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const splineId = e.target.value;
    if (!splineId) return;
    const spline = savedSplines.find((s) => s.id === splineId);
    if (spline) onUpdate(spline.points);
    e.target.value = '';
  };

  return (
    <div className="mt-3 pt-2 border-t border-gray-700/50 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`${PORT_TEXT_COLORS.Spline} text-xs font-mono font-semibold`}>SPLINE LIBRARY</span>
        <span className="text-gray-400 text-xs">{savedSplines.length} saved</span>
      </div>

      {/* Charger depuis la bibliothèque */}
      {savedSplines.length > 0 && (
        <select
          onChange={handleLoad}
          defaultValue=""
          className="w-full px-2 py-1.5 bg-gray-900 text-gray-300 text-xs font-mono rounded border border-gray-700 focus:border-stagespace-accent focus:outline-none"
        >
          <option value="" disabled>↳ Load a spline...</option>
          {savedSplines.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}

      {/* Liste des splines sauvegardées */}
      {savedSplines.length > 0 && (
        <div className="space-y-0.5 max-h-32 overflow-y-auto">
          {savedSplines.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-xs py-0.5">
              <button
                onClick={() => onUpdate(s.points)}
                className="text-gray-400 hover:text-gray-200 font-mono truncate flex-1 text-left"
                title="Load this spline"
              >{s.name}</button>
              <button
                onClick={() => deleteSpline(s.id)}
                className="text-stagespace-danger/70 hover:text-stagespace-danger px-1 flex-shrink-0"
                title="Delete"
              ><X size={11} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Sauvegarder la spline actuelle */}
      {showSave ? (
        <div className="flex gap-1">
          <input
            type="text"
            value={splineName}
            onChange={(e) => setSplineName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setShowSave(false); }}
            placeholder="Nom de la spline..."
            autoFocus
            className="flex-1 px-2 py-1.5 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-stagespace-accent focus:outline-none"
          />
          <button onClick={handleSave}
            className="text-stagespace-accent hover:text-stagespace-info text-xs px-2" title="Confirm"><Check size={12} /></button>
          <button onClick={() => setShowSave(false)}
            className="text-gray-500 hover:text-gray-400 text-xs px-2" title="Cancel"><X size={12} /></button>
        </div>
      ) : (
        <button
          onClick={() => setShowSave(true)}
          className="w-full text-xs text-stagespace-accent hover:text-stagespace-info border border-stagespace-accent/40 hover:border-stagespace-accent rounded py-1.5 transition-colors"
        >
          + Save this spline
        </button>
      )}
    </div>
  );
}
