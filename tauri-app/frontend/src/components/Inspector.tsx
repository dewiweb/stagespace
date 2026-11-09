import React from 'react';
import { useMoveEditorStore, Move } from '../store/useMoveEditorStore';
import { useGraphStore, NodeType } from '../store/useGraphStore';
import { TrackGrid } from './TrackGrid';
import { PARAM_SCHEMA, NODE_DESCRIPTIONS, getCategoryColor, type ParamDef, type NodeParamValue, type GraphNodeData } from './nodeParamSchema';
import { NodeParamsPanel } from './panels/NodeParamsPanel';
import { ParamInput } from './ParamInput';
import type { MacrosState } from '../store/slices/macrosSlice';
import { silentCatch } from '../utils/tauri';

// ── Section repliable ──
function Section({ title, icon, defaultOpen = true, badge, badgeColor = 'gray', children }: {
  title: string; icon: React.ReactNode; defaultOpen?: boolean; badge?: string; badgeColor?: 'gray' | 'orange'; children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const badgeCls = badgeColor === 'orange'
    ? 'text-orange-400 bg-orange-900/40 px-1.5 py-0.5 rounded text-xs font-mono animate-pulse'
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
import { MacrosSurface } from './show/MacrosSurface';
import { AudioModList } from './AudioModControls';
import { Zap, AudioLines, Hexagon, SlidersHorizontal, Play, CircleDot, X, Square, ChevronRight, TriangleAlert, Check } from 'lucide-react';

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
  const selectAllTracks = useGraphStore((s) => s.selectAllTracks);
  const deselectAllTracks = useGraphStore((s) => s.deselectAllTracks);
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
  const macros = useGraphStore((s) => s.macros);
  const setMacros = useGraphStore((s) => s.setMacros);
  const pushMacrosToRuntime = useGraphStore((s) => s.pushMacrosToRuntime);
  const editingSlotId = useGraphStore((s) => s.editingSlotId);
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const selectSlotForEditing = useGraphStore((s) => s.selectSlotForEditing);
  // Statut live du slot édité — les edits d'un move ON AIR partent au runtime
  // (hot-swap / update_animation_state), ce badge rend ce scope visible.
  const editingSlot = useGraphStore((s) => s.moveSlots.find((sl) => sl.id === editingSlotId) ?? null);
  const editingIsLive = !!editingSlot?.movementId;

  // Flash effect on launch
  const [flashClass, setFlashClass] = React.useState('');
  React.useEffect(() => {
    if (launchFlash > 0) {
      setFlashClass('ring-2 ring-green-400 scale-105');
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
  const nodeColor = selectedNodeType ? getCategoryColor(selectedNodeType) : '#4b5563';

  // ── Audio mod UI ──

  // ── Debounces — un timer par action : partager le même ref annulait un
  // hot-swap graphe en attente quand un slider de macro bougeait (le param
  // node restait dans le store sans jamais arriver au runtime). ──
  const macroPushDebounce = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const graphHotSwapDebounce = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mapping bidirectionnel entre les noms Simple (Move state) et Expert (Graph store macros)
  // Simple: scale, offset_x, offset_y, offset_z, yaw, pitch, roll, speed
  // Expert: scale, shiftX,    shiftY,    shiftZ,    yaw, pitch, roll, speed
  const SIMPLE_TO_MACRO: Record<string, string> = {
    scale: 'scale', offset_x: 'shiftX', offset_y: 'shiftY', offset_z: 'shiftZ',
    yaw: 'yaw', pitch: 'pitch', roll: 'roll', speed: 'speed',
    radius_scale: 'radius_scale', height_offset: 'height_offset',
  };
  const MACRO_TO_SIMPLE: Record<string, string> = {
    scale: 'scale', shiftX: 'offset_x', shiftY: 'offset_y', shiftZ: 'offset_z',
    yaw: 'yaw', pitch: 'pitch', roll: 'roll', speed: 'speed',
    radius_scale: 'radius_scale', height_offset: 'height_offset',
  };

  // Handler unifié : met à jour les deux stores (Move + Graph macros) + pousse vers le runtime
  // Utilisé à la fois par les sliders Transform (Simple) et Macros (Expert)
  const handleUnified = (key: string, value: number, source: 'simple' | 'expert') => {
    if (source === 'simple') {
      // key est un nom Simple (offset_x, scale, yaw, ...)
      updateCurrent({ [key]: value } as Partial<Move>);
      const macroKey = SIMPLE_TO_MACRO[key];
      if (macroKey) setMacros({ [macroKey]: value } as Partial<MacrosState>);
    } else {
      // key est un nom Expert (shiftX, scale, yaw, ...)
      setMacros({ [key]: value } as Partial<MacrosState>);
      const animKey = MACRO_TO_SIMPLE[key];
      if (animKey) updateCurrent({ [animKey]: value } as Partial<Move>);
    }
    // Toujours pousser vers le runtime (debounced) — c'était manquant pour le mode Simple
    if (macroPushDebounce.current) clearTimeout(macroPushDebounce.current);
    macroPushDebounce.current = setTimeout(() => { pushMacrosToRuntime(); }, 100);
  };

  const handleMacro = (key: string, value: number) => handleUnified(key, value, 'expert');
  const handleTransform = (key: string, value: number) => handleUnified(key, value, 'simple');

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
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700/50 flex-shrink-0">
        {hasEditingSlot ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={current.name}
              onChange={(e) => updateCurrent({ name: e.target.value, id: current.id })}
              className="flex-1 min-w-0 bg-transparent text-white text-sm font-semibold focus:outline-none focus:text-blue-400"
            />
            {editingIsLive && (
              <span
                className={`flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold ${
                  editingSlot?.isPreview
                    ? 'bg-cyan-900/60 text-cyan-300 border border-cyan-700/50'
                    : 'bg-green-900/60 text-green-300 border border-green-700/50 animate-pulse'
                }`}
                title={editingSlot?.isPreview
                  ? 'This move runs in preview — edits apply live (no OSC out)'
                  : 'ON AIR — les edits de ce panneau partent au renderer en direct'}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${editingSlot?.isPreview ? 'bg-cyan-400' : 'bg-green-400'}`} />
                {editingSlot?.isPreview ? 'PREVIEW' : 'LIVE'}
              </span>
            )}
          </div>
        ) : (
          <div className="w-full text-gray-500 text-sm font-semibold flex items-center gap-2">
            <span className="text-gray-400">Global</span>
            <span className="text-xs text-gray-500 font-normal">— select a move to edit it</span>
          </div>
        )}
      </div>

      {/* Sections scrollables */}
      <div className="flex-1 overflow-y-auto">

        {!hasEditingSlot ? (
          /* ═══════════════ MODE GLOBAL (aucun slot sélectionné) ═══════════════ */
          <>
            {/* MOVES — mini liste : tap → sélectionne le slot pour édition.
                Sans ça l'Inspector global était une impasse (macros seuls). */}
            <Section title="Moves" icon={<Play size={12} />} defaultOpen={true}
              badge={moveSlots.length > 0 ? `${moveSlots.length}` : undefined}>
              {moveSlots.length === 0 ? (
                <div className="text-gray-400 text-xs py-1">
                  Aucun slot — crée un move depuis le panneau Show (gauche).
                </div>
              ) : (
                <div className="space-y-0.5">
                  {moveSlots.map((slot) => (
                    <button
                      key={slot.id}
                      onClick={() => selectSlotForEditing(slot.id)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded border bg-gray-800/40 border-gray-700/40 hover:border-gray-600 hover:bg-gray-800/60 transition-all text-left"
                      title="Select this move to edit it"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        slot.movementId
                          ? slot.isPreview ? 'bg-cyan-400' : 'bg-green-400 animate-pulse'
                          : 'bg-gray-600'
                      }`} />
                      <span className="text-white text-xs flex-1 truncate">{slot.name}</span>
                      <span className="text-gray-500 text-xs font-mono flex-shrink-0">
                        {slot.trackIds.length}trk
                      </span>
                      <span className="text-gray-400 text-xs">→</span>
                    </button>
                  ))}
                </div>
              )}
            </Section>

            {/* MACROS — runtime controls globaux (affectent tous les moves) */}
            <Section title="Macros" icon={<Zap size={12} />} defaultOpen={true}
              badge={activeMovementIds.length > 0 ? `${activeMovementIds.length} live` : undefined}>
              <MacrosSurface includeRadius live />
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
                    <span className="w-2 h-2 rounded-full" style={{ background: nodeColor }} />
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

            {/* MACROS — runtime controls appliqués à tous les moves */}
            <Section title="Macros" icon={<Zap size={12} />} defaultOpen={true}
              badge={activeMovementIds.length > 0 ? `${activeMovementIds.length} live` : undefined}>
              <MacrosSurface includeRadius live />
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
            <Section key={`perform-${performMode}`} title="Perform" icon={<Play size={12} />} defaultOpen={!performMode}>
              <Slider label="Duration" value={current.duration} min={0.5} max={30} step={0.5} onChange={(v) => updateCurrent({ duration: v })} unit="s" />
              <div className="flex gap-1 pt-1">
                {(['forward', 'backward', 'ping_pong'] as const).map((d) => (
                  <button key={d} onClick={() => updateCurrent({ direction: d })}
                    className={`flex-1 py-1 text-xs rounded ${current.direction === d ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-500'}`}>
                    {d === 'forward' ? '→ Fwd' : d === 'backward' ? '← Bwd' : '↔ Ping'}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {(['loop', 'one_shot'] as const).map((l) => (
                  <button key={l} onClick={() => updateCurrent({ loop_mode: l })}
                    className={`flex-1 py-1 text-xs rounded ${current.loop_mode === l ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-500'}`}>
                    {l === 'loop' ? '↻ Loop' : '▶ One-shot'}
                  </button>
                ))}
              </div>
              <Slider label="Fade in" value={current.fade_in} min={0} max={5} step={0.1} onChange={(v) => updateCurrent({ fade_in: v })} unit="s" />
              <Slider label="Fade out" value={current.fade_out} min={0} max={5} step={0.1} onChange={(v) => updateCurrent({ fade_out: v })} unit="s" />
            </Section>

            {/* MACROS — speed, scale, shift, rotation (unifié avec Expert) */}
            <Section title="Macros" icon={<Zap size={12} />}>
              <Slider label="Speed" value={current.speed} min={0} max={4} step={0.05} onChange={(v) => handleTransform('speed', v)} unit="x" accent="purple" />
              <Slider label="Scale" value={current.scale} min={0} max={4} step={0.05} onChange={(v) => handleTransform('scale', v)} accent="purple" />
              <Slider label="Shift X" value={current.offset_x} min={-5} max={5} step={0.1} onChange={(v) => handleTransform('offset_x', v)} accent="purple" />
              <Slider label="Shift Y" value={current.offset_y} min={-5} max={5} step={0.1} onChange={(v) => handleTransform('offset_y', v)} accent="purple" />
              <Slider label="Shift Z" value={current.offset_z} min={-5} max={5} step={0.1} onChange={(v) => handleTransform('offset_z', v)} accent="purple" />
              <Slider label="Yaw" value={current.yaw} min={-180} max={180} step={1} onChange={(v) => handleTransform('yaw', v)} unit="°" accent="purple" />
              <Slider label="Pitch" value={current.pitch} min={-90} max={90} step={1} onChange={(v) => handleTransform('pitch', v)} unit="°" accent="purple" />
              <Slider label="Roll" value={current.roll} min={-180} max={180} step={1} onChange={(v) => handleTransform('roll', v)} unit="°" accent="purple" />
              <Slider label="Radius" value={macros.radius_scale} min={0} max={4} step={0.05} onChange={(v) => handleMacro('radius_scale', v)} unit="x" accent="purple" />
              <Slider label="Height" value={macros.height_offset} min={-5} max={5} step={0.1} onChange={(v) => handleMacro('height_offset', v)} unit="m" accent="purple" />
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
              selectAllTracks={selectAllTracks}
              deselectAllTracks={deselectAllTracks}
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
                  selectAllTracks={selectAllTracks}
                  deselectAllTracks={deselectAllTracks}
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
              <Slider label="Spread" value={current.phase_spread} min={0} max={1} step={0.05}
                onChange={(v) => updateCurrent({ phase_spread: v })} accent="cyan" />
              <div className="text-gray-400 text-xs -mt-1">Phase offset between tracks (chasing effect)</div>
            </>
          )}
          {centroid && (
            <div className="text-cyan-400 text-xs font-mono pt-1">
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
                    mv.is_preview ? 'bg-cyan-800 text-cyan-300' : 'bg-green-800 text-green-300'
                  }`}>{idx + 1}</span>
                  <span className="text-white text-xs font-medium truncate flex-1">{mv.name}</span>
                  <span className="text-gray-500 text-xs font-mono flex-shrink-0">{trackCount}tr</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); stopMovementWithFade(mv.id, useGraphStore.getState().moveSlots.find((sl) => sl.movementId === mv.id)?.fadeOut ?? 0.5); }}
                    className="text-yellow-400 hover:text-yellow-300 text-xs px-1 flex-shrink-0"
                    title="Stop avec fade (fade_out du slot, 0.5s par défaut)"
                  ><Square size={10} /></button>
                  <button
                    onClick={(e) => { e.stopPropagation(); stopMovement(mv.id); }}
                    className="text-red-400 hover:text-red-300 text-xs px-1 flex-shrink-0"
                    title="Immediate stop"
                  ><Square size={10} fill="currentColor" /></button>
                </div>
              );
            })}
            <button
              onClick={() => stopAllMovements().catch(silentCatch)}
              className="w-full py-1 bg-red-900/50 hover:bg-red-900/70 text-red-400 text-xs rounded font-medium transition-colors"
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
                ? 'bg-red-900/60 hover:bg-red-800/70 text-red-100 border-red-700/50'
                : hasEditingSlot
                  ? 'bg-indigo-700 hover:bg-indigo-600 text-white border-indigo-500/50'
                  : 'bg-gray-800/40 text-gray-500 border-gray-700/30 cursor-not-allowed'
            }`}
            title={hasEditingSlot ? `${editingIsLive ? 'Stop' : 'Play'} "${editingSlot?.name}" (Space)` : 'Select a slot in Moves first'}
          >
            {editingIsLive ? <Square size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}
            {editingIsLive ? 'STOP' : 'PLAY'}{editingSlot ? ` · ${editingSlot.name}` : ''}
          </button>
          <button
            onClick={() => panic()}
            className="px-2 py-2.5 bg-red-800 hover:bg-red-700 text-white text-xs rounded-lg font-bold border border-red-500/50 transition-colors"
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
        <span className="text-cyan-400 text-xs font-mono font-semibold">SPLINE LIBRARY</span>
        <span className="text-gray-400 text-xs">{savedSplines.length} saved</span>
      </div>

      {/* Charger depuis la bibliothèque */}
      {savedSplines.length > 0 && (
        <select
          onChange={handleLoad}
          defaultValue=""
          className="w-full px-2 py-1.5 bg-gray-900 text-cyan-300 text-xs font-mono rounded border border-gray-700 focus:border-cyan-500 focus:outline-none"
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
                className="text-gray-400 hover:text-cyan-300 font-mono truncate flex-1 text-left"
                title="Load this spline"
              >{s.name}</button>
              <button
                onClick={() => deleteSpline(s.id)}
                className="text-red-500 hover:text-red-400 px-1 flex-shrink-0"
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
            className="flex-1 px-2 py-1.5 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-cyan-500 focus:outline-none"
          />
          <button onClick={handleSave}
            className="text-green-400 hover:text-green-300 text-xs px-2" title="Confirm"><Check size={12} /></button>
          <button onClick={() => setShowSave(false)}
            className="text-gray-500 hover:text-gray-400 text-xs px-2" title="Cancel"><X size={12} /></button>
        </div>
      ) : (
        <button
          onClick={() => setShowSave(true)}
          className="w-full text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-800/60 hover:border-cyan-600 rounded py-1.5 transition-colors"
        >
          + Save this spline
        </button>
      )}
    </div>
  );
}
