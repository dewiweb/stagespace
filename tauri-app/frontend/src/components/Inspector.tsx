import React from 'react';
import { useAnimationStore, AudioMod, AudioModSource, AudioModTarget } from '../store/useAnimationStore';
import { useGraphStore, NodeType } from '../store/useGraphStore';
import { TrackGrid } from './TrackGrid';
import { PARAM_SCHEMA, NODE_DESCRIPTIONS, getCategoryColor, type ParamDef } from './nodeParamSchema';

// ── Section repliable ──
function Section({ title, icon, defaultOpen = true, badge, badgeColor = 'gray', children }: {
  title: string; icon: string; defaultOpen?: boolean; badge?: string; badgeColor?: 'gray' | 'orange'; children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const badgeCls = badgeColor === 'orange'
    ? 'text-orange-400 bg-orange-900/40 px-1.5 py-0.5 rounded text-[9px] font-mono animate-pulse'
    : 'text-gray-500 text-[9px] font-mono';
  return (
    <div className="border-b border-gray-700/40">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800/40 transition-colors">
        <span className="text-xs">{icon}</span>
        <span className="text-gray-300 text-[11px] font-semibold uppercase tracking-wider flex-1 text-left">{title}</span>
        {badge && <span className={badgeCls}>{badge}</span>}
        <span className={`text-gray-500 text-[10px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

// ── Slider compact ──
function Slider({ label, value, min, max, step, onChange, unit, color = 'blue' }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; unit?: string; color?: 'blue' | 'green' | 'purple' | 'cyan';
}) {
  const accent = `accent-${color}-500`;
  const decimals = step < 1 ? (step < 0.1 ? 2 : 1) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-400 text-[10px] w-16 flex-shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={`flex-1 h-1.5 ${accent}`} />
      <span className="text-white text-[10px] font-mono w-12 text-right">{value.toFixed(decimals)}{unit ?? ''}</span>
    </div>
  );
}

export default function Inspector() {
  const showExpert = useAnimationStore((s) => s.showExpert);
  const {
    current, updateCurrent,
    updateAssignment, addAudioMod, removeAudioMod,
    computeCentroid,
    activeMovementIds,
    launchFlash,
  } = useAnimationStore();

  const { holProject, selectedTrackIds, toggleTrackSelection, selectAllTracks, deselectAllTracks,
    manualOscIds, panic, stopAllMovements, stopMovement, stopMovementWithFade,
    movements, nodes, updateNodeData, updateGraphLive,
    macros, setMacros, pushMacrosToRuntime,
    editingSlotId,
  } = useGraphStore();

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

  // ── Simple mode: trouver le node engine principal du graphe (toujours) ──
  const mainEngineNode = React.useMemo(() => {
    // Chercher le node engine (pas structural, pas modifier, pas source, pas output)
    // Priorité: Math Engines > Physics Engines > Splines > Composite
    const engineCategories = ['Circular', 'Elliptical', 'Spiral', 'Lissajous', 'Figure8',
      'Linear', 'Oscillation', 'Formation', 'PerlinNoise', 'Converge', 'Pendulum',
      'RoseCurve', 'Helix', 'Wave', 'CustomTrajectory',
      'Bouncing', 'Avoidance', 'Spring', 'Follow', 'Swarm',
      'DrawSpline', 'EvaluateSpline',
      'Mix', 'Group', 'Sequence', 'Crossfade'];
    for (const engineType of engineCategories) {
      const found = nodes.find((n) => (n.data as any)?.type === engineType);
      if (found) return found;
    }
    return null;
  }, [nodes]);
  const mainEngineType = (mainEngineNode?.data as any)?.type as NodeType | undefined;
  const mainEngineSchema = mainEngineType ? PARAM_SCHEMA[mainEngineType] ?? [] : [];
  const mainEngineParams = (mainEngineNode?.data as any)?.params ?? {};

  // DrawSpline node pour la Spline Library (présent dans les graphs spline)
  const drawSplineNode = React.useMemo(() =>
    nodes.find((n) => (n.data as any)?.type === 'DrawSpline'),
    [nodes]
  );

  // Handler pour update un param du node engine principal + hot-swap
  const updateEngineParam = (key: string, value: any) => {
    if (!mainEngineNode) return;
    updateNodeData(mainEngineNode.id, { params: { ...mainEngineParams, [key]: value } });
    // Hot-swap live avec debounce
    if (macroDebounce.current) clearTimeout(macroDebounce.current);
    macroDebounce.current = setTimeout(() => { updateGraphLive(); }, 150);
  };

  // ── Expert mode: node sélectionné ──
  const selectedNode = nodes.find((n) => n.selected);
  const selectedNodeType = (selectedNode?.data as any)?.type as NodeType | undefined;
  const selectedNodeSchema = selectedNodeType ? PARAM_SCHEMA[selectedNodeType] ?? [] : [];
  const selectedNodeParams = (selectedNode?.data as any)?.params ?? {};
  const nodeColor = selectedNodeType ? getCategoryColor(selectedNodeType) : '#4b5563';

  // ── Audio mod UI ──
  const [showAudioAdd, setShowAudioAdd] = React.useState(false);

  // ── Macros debounce ──
  const macroDebounce = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mapping bidirectionnel entre les noms Simple (Animation state) et Expert (Graph store macros)
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

  // Handler unifié : met à jour les deux stores (Animation + Graph macros) + pousse vers le runtime
  // Utilisé à la fois par les sliders Transform (Simple) et Macros (Expert)
  const handleUnified = (key: string, value: number, source: 'simple' | 'expert') => {
    if (source === 'simple') {
      // key est un nom Simple (offset_x, scale, yaw, ...)
      updateCurrent({ [key]: value } as any);
      const macroKey = SIMPLE_TO_MACRO[key];
      if (macroKey) setMacros({ [macroKey]: value } as any);
    } else {
      // key est un nom Expert (shiftX, scale, yaw, ...)
      setMacros({ [key]: value } as any);
      const animKey = MACRO_TO_SIMPLE[key];
      if (animKey) updateCurrent({ [animKey]: value } as any);
    }
    // Toujours pousser vers le runtime (debounced) — c'était manquant pour le mode Simple
    if (macroDebounce.current) clearTimeout(macroDebounce.current);
    macroDebounce.current = setTimeout(() => { pushMacrosToRuntime(); }, 100);
  };

  const handleMacro = (key: string, value: number) => handleUnified(key, value, 'expert');
  const handleTransform = (key: string, value: number) => handleUnified(key, value, 'simple');

  const handleNodeParamChange = (key: string, value: any) => {
    if (!selectedNode) return;
    updateNodeData(selectedNode.id, { params: { ...selectedNodeParams, [key]: value } });
    // Hot-swap live avec debounce
    if (macroDebounce.current) clearTimeout(macroDebounce.current);
    macroDebounce.current = setTimeout(() => { updateGraphLive(); }, 150);
  };

  const renderNodeParamInput = (def: ParamDef, params: Record<string, any>, onChange: (key: string, value: any) => void) => {
    const value = params?.[def.key];
    switch (def.type) {
      case 'number':
        return (
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-[10px] w-20 flex-shrink-0">{def.label}</span>
            <input type="number" step={def.step ?? 0.1} min={def.min} max={def.max}
              value={value ?? 0}
              onChange={(e) => onChange(def.key, parseFloat(e.target.value) || 0)}
              className="flex-1 px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none" />
          </div>
        );
      case 'boolean':
        return (
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-[10px] w-20 flex-shrink-0">{def.label}</span>
            <button onClick={() => onChange(def.key, !value)}
              className={`relative w-9 h-5 rounded-full transition-colors ${value ? 'bg-blue-600' : 'bg-gray-700'}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`} />
            </button>
          </div>
        );
      case 'enum':
        return (
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-[10px] w-20 flex-shrink-0">{def.label}</span>
            <select value={value ?? ''}
              onChange={(e) => onChange(def.key, e.target.value)}
              className="flex-1 px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none">
              {def.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
        );
      case 'vec3': {
        const arr = Array.isArray(value) ? value : [0, 0, 0];
        return (
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-[10px] w-20 flex-shrink-0">{def.label}</span>
            <input type="text" value={arr.join(', ')}
              onChange={(e) => {
                const parsed = e.target.value.split(',').map((v) => parseFloat(v.trim()));
                if (parsed.length === 3 && parsed.every((n) => !isNaN(n))) onChange(def.key, parsed);
              }}
              className="flex-1 px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none font-mono"
              placeholder="x, y, z" />
          </div>
        );
      }
      case 'text':
      case 'string':
        return (
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-[10px] w-20 flex-shrink-0">{def.label}</span>
            <input type="text" value={value ?? ''}
              onChange={(e) => onChange(def.key, e.target.value)}
              className="flex-1 px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none font-mono" />
          </div>
        );
      default: return null;
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-stagespace-panel">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700/50 flex-shrink-0">
        {hasEditingSlot ? (
          <input
            type="text"
            value={current.name}
            onChange={(e) => updateCurrent({ name: e.target.value, id: current.id })}
            className="w-full bg-transparent text-white text-sm font-semibold focus:outline-none focus:text-blue-400"
          />
        ) : (
          <div className="w-full text-gray-500 text-sm font-semibold flex items-center gap-2">
            <span className="text-gray-600">Global</span>
            <span className="text-[9px] text-gray-700 font-normal">— sélectionnez un move pour l'éditer</span>
          </div>
        )}
      </div>

      {/* Sections scrollables */}
      <div className="flex-1 overflow-y-auto">

        {!hasEditingSlot ? (
          /* ═══════════════ MODE GLOBAL (aucun slot sélectionné) ═══════════════ */
          /* Only show global-affecting sections: Macros + Audio + movements list */
          <>
            {/* MACROS — runtime controls globaux (affectent tous les moves) */}
            <Section title="Macros" icon="⚡" defaultOpen={true}
              badge={activeMovementIds.length > 0 ? `${activeMovementIds.length} live` : undefined}>
              <Slider label="Échelle" value={macros.scale} min={0} max={4} step={0.05}
                onChange={(v) => handleMacro('scale', v)} color="purple" />
              <Slider label="Shift X" value={macros.shiftX} min={-5} max={5} step={0.1}
                onChange={(v) => handleMacro('shiftX', v)} color="purple" />
              <Slider label="Shift Y" value={macros.shiftY} min={-5} max={5} step={0.1}
                onChange={(v) => handleMacro('shiftY', v)} color="purple" />
              <Slider label="Shift Z" value={macros.shiftZ} min={-5} max={5} step={0.1}
                onChange={(v) => handleMacro('shiftZ', v)} color="purple" />
              <Slider label="Yaw" value={macros.yaw} min={-180} max={180} step={1}
                onChange={(v) => handleMacro('yaw', v)} unit="°" color="purple" />
              <Slider label="Pitch" value={macros.pitch} min={-90} max={90} step={1}
                onChange={(v) => handleMacro('pitch', v)} unit="°" color="purple" />
              <Slider label="Roll" value={macros.roll} min={-180} max={180} step={1}
                onChange={(v) => handleMacro('roll', v)} unit="°" color="purple" />
              <Slider label="Radius" value={macros.radius_scale} min={0} max={4} step={0.05}
                onChange={(v) => handleMacro('radius_scale', v)} unit="x" color="purple" />
              <Slider label="Height" value={macros.height_offset} min={-5} max={5} step={0.1}
                onChange={(v) => handleMacro('height_offset', v)} unit="m" color="purple" />
              <div className="text-gray-600 text-[9px] pt-1">Macros globales — appliquées à tous les moves actifs</div>
            </Section>

            {/* AUDIO — mods audio-reactifs globaux */}
            <Section title="Audio" icon="♪" defaultOpen={false} badge={current.audio_mods.length > 0 ? `${current.audio_mods.length}` : undefined}>
              {current.audio_mods.length === 0 && !showAudioAdd && (
                <div className="text-gray-600 text-[10px] py-1">
                  Aucun mod audio. Cliquez « + Ajouter » pour créer un mapping audio.
                </div>
              )}
              {current.audio_mods.map((mod, i) => (
                <div key={i} className="bg-gray-800/60 rounded p-2 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-cyan-400 text-[10px] font-mono">
                      {audioSourceLabel(mod.source)} → {audioTargetLabel(mod.target)}
                    </span>
                    <button onClick={() => removeAudioMod(i)} className="text-red-400 text-[10px]">✕</button>
                  </div>
                  <Slider label="Intensité" value={mod.amount} min={0} max={2} step={0.05}
                    onChange={(v) => {
                      const mods = [...current.audio_mods];
                      mods[i] = { ...mod, amount: v };
                      updateCurrent({ audio_mods: mods });
                    }} color="cyan" />
                  <Slider label="Lissage" value={mod.smoothing} min={0} max={0.95} step={0.05}
                    onChange={(v) => {
                      const mods = [...current.audio_mods];
                      mods[i] = { ...mod, smoothing: v };
                      updateCurrent({ audio_mods: mods });
                    }} color="cyan" />
                </div>
              ))}
              {showAudioAdd && (
                <AudioModAdder onAdd={(mod) => { addAudioMod(mod); setShowAudioAdd(false); }} onCancel={() => setShowAudioAdd(false)} />
              )}
              {!showAudioAdd && (
                <button onClick={() => setShowAudioAdd(true)}
                  className="w-full py-1.5 bg-cyan-900/40 hover:bg-cyan-800/60 text-cyan-300 text-[10px] rounded font-medium">
                  + Ajouter un mod audio
                </button>
              )}
            </Section>
          </>
        ) : showExpert ? (
          /* ═══════════════ MODE EXPERT ═══════════════ */

          <>
            {/* NODE SÉLECTIONNÉ — params du node */}
            <Section title="Node" icon="◆" defaultOpen={true}>
              {selectedNode && selectedNodeType ? (
                <>
                  <div className="flex items-center gap-2 px-1 pb-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: nodeColor }} />
                    <span className="text-white text-xs font-semibold">{selectedNodeType}</span>
                    {NODE_DESCRIPTIONS[selectedNodeType] && (
                      <span className="text-gray-600 text-[9px] ml-auto truncate" title={NODE_DESCRIPTIONS[selectedNodeType]}>
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
                    <div className="text-gray-600 text-[10px] py-1">Ce node n'a pas de paramètres</div>
                  )}
                </>
              ) : (
                <div className="text-gray-600 text-[10px] py-2 text-center">
                  Sélectionnez un node dans le graphe
                  <div className="text-gray-700 text-[9px] mt-1">Cliquez sur un node pour éditer ses params</div>
                </div>
              )}
            </Section>

            {/* MACROS — runtime controls appliqués à tous les moves */}
            <Section title="Macros" icon="⚡" defaultOpen={true}
              badge={activeMovementIds.length > 0 ? `${activeMovementIds.length} live` : undefined}>
              <Slider label="Vitesse" value={macros.speed} min={0} max={4} step={0.05}
                onChange={(v) => handleMacro('speed', v)} unit="x" color="purple" />
              <Slider label="Échelle" value={macros.scale} min={0} max={4} step={0.05}
                onChange={(v) => handleMacro('scale', v)} color="purple" />
              <Slider label="Shift X" value={macros.shiftX} min={-5} max={5} step={0.1}
                onChange={(v) => handleMacro('shiftX', v)} color="purple" />
              <Slider label="Shift Y" value={macros.shiftY} min={-5} max={5} step={0.1}
                onChange={(v) => handleMacro('shiftY', v)} color="purple" />
              <Slider label="Shift Z" value={macros.shiftZ} min={-5} max={5} step={0.1}
                onChange={(v) => handleMacro('shiftZ', v)} color="purple" />
              <Slider label="Yaw" value={macros.yaw} min={-180} max={180} step={1}
                onChange={(v) => handleMacro('yaw', v)} unit="°" color="purple" />
              <Slider label="Pitch" value={macros.pitch} min={-90} max={90} step={1}
                onChange={(v) => handleMacro('pitch', v)} unit="°" color="purple" />
              <Slider label="Roll" value={macros.roll} min={-180} max={180} step={1}
                onChange={(v) => handleMacro('roll', v)} unit="°" color="purple" />
              <Slider label="Radius" value={macros.radius_scale} min={0} max={4} step={0.05}
                onChange={(v) => handleMacro('radius_scale', v)} unit="x" color="purple" />
              <Slider label="Height" value={macros.height_offset} min={-5} max={5} step={0.1}
                onChange={(v) => handleMacro('height_offset', v)} unit="m" color="purple" />
              <div className="text-gray-600 text-[9px] pt-1">Macros = transformations runtime appliquées à tous les moves actifs</div>
            </Section>
          </>
        ) : (
          /* ═══════════════ MODE SIMPLE ═══════════════ */

          <>
            {/* PARAMS — params du node engine principal du graphe (template choisi à gauche) */}
            <Section title="Params" icon={mainEngineType ? '◆' : '◇'}>
              <div className="flex items-center gap-2 pb-2">
                <span className="text-blue-400 text-[11px] font-semibold">
                  {mainEngineType ?? 'Aucun engine'}
                </span>
                <span className="text-gray-600 text-[9px]">— template depuis le panneau gauche</span>
              </div>

              {mainEngineSchema.length > 0 ? (
                <div className="space-y-1.5">
                  {mainEngineSchema.map((def) => (
                    <div key={def.key}>{renderNodeParamInput(def, mainEngineParams, updateEngineParam)}</div>
                  ))}
                </div>
              ) : (
                <div className="text-gray-600 text-[10px] py-1">
                  {mainEngineNode
                    ? "Cet engine n'a pas de paramètres éditables."
                    : 'Aucun engine détecté dans le graphe. Choisissez un template dans le panneau gauche.'}
                </div>
              )}

              {/* Spline Library — visible quand le graphe contient un DrawSpline */}
              {drawSplineNode && (
                <InspectorSplineLibrary
                  drawSplineNode={drawSplineNode}
                  onUpdate={(points) => {
                    updateNodeData(drawSplineNode.id, { params: { points } });
                    if (macroDebounce.current) clearTimeout(macroDebounce.current);
                    macroDebounce.current = setTimeout(() => { updateGraphLive(); }, 150);
                  }}
                />
              )}
            </Section>

            {/* PERFORM — duration, direction, loop, fade */}
            <Section title="Perform" icon="▶">
              <Slider label="Durée" value={current.duration} min={0.5} max={30} step={0.5} onChange={(v) => updateCurrent({ duration: v })} unit="s" />
              <div className="flex gap-1 pt-1">
                {(['forward', 'backward', 'ping_pong'] as const).map((d) => (
                  <button key={d} onClick={() => updateCurrent({ direction: d })}
                    className={`flex-1 py-1 text-[9px] rounded ${current.direction === d ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-500'}`}>
                    {d === 'forward' ? '→ Fwd' : d === 'backward' ? '← Bwd' : '↔ Ping'}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {(['loop', 'one_shot'] as const).map((l) => (
                  <button key={l} onClick={() => updateCurrent({ loop_mode: l })}
                    className={`flex-1 py-1 text-[9px] rounded ${current.loop_mode === l ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-500'}`}>
                    {l === 'loop' ? '↻ Loop' : '▶ One-shot'}
                  </button>
                ))}
              </div>
              <Slider label="Fondu in" value={current.fade_in} min={0} max={5} step={0.1} onChange={(v) => updateCurrent({ fade_in: v })} unit="s" />
              <Slider label="Fondu out" value={current.fade_out} min={0} max={5} step={0.1} onChange={(v) => updateCurrent({ fade_out: v })} unit="s" />
            </Section>

            {/* MACROS — speed, scale, shift, rotation (unifié avec Expert) */}
            <Section title="Macros" icon="⚡">
              <Slider label="Vitesse" value={current.speed} min={0} max={4} step={0.05} onChange={(v) => handleTransform('speed', v)} unit="x" color="purple" />
              <Slider label="Échelle" value={current.scale} min={0} max={4} step={0.05} onChange={(v) => handleTransform('scale', v)} color="purple" />
              <Slider label="Shift X" value={current.offset_x} min={-5} max={5} step={0.1} onChange={(v) => handleTransform('offset_x', v)} color="purple" />
              <Slider label="Shift Y" value={current.offset_y} min={-5} max={5} step={0.1} onChange={(v) => handleTransform('offset_y', v)} color="purple" />
              <Slider label="Shift Z" value={current.offset_z} min={-5} max={5} step={0.1} onChange={(v) => handleTransform('offset_z', v)} color="purple" />
              <Slider label="Yaw" value={current.yaw} min={-180} max={180} step={1} onChange={(v) => handleTransform('yaw', v)} unit="°" color="purple" />
              <Slider label="Pitch" value={current.pitch} min={-90} max={90} step={1} onChange={(v) => handleTransform('pitch', v)} unit="°" color="purple" />
              <Slider label="Roll" value={current.roll} min={-180} max={180} step={1} onChange={(v) => handleTransform('roll', v)} unit="°" color="purple" />
              <Slider label="Radius" value={macros.radius_scale} min={0} max={4} step={0.05} onChange={(v) => handleMacro('radius_scale', v)} unit="x" color="purple" />
              <Slider label="Height" value={macros.height_offset} min={-5} max={5} step={0.1} onChange={(v) => handleMacro('height_offset', v)} unit="m" color="purple" />
            </Section>
          </>
        )}

        {/* ═══════════════ COMMUN (Simple + Expert — seulement si slot édité) ═══════════════ */}

        {/* AUDIO — mods audio-reactifs (commun aux deux modes) */}
        {hasEditingSlot && (
        <Section title="Audio" icon="♪" defaultOpen={false} badge={current.audio_mods.length > 0 ? `${current.audio_mods.length}` : undefined}>
          {current.audio_mods.length === 0 && !showAudioAdd && (
            <div className="text-gray-600 text-[10px] py-1">
              Aucun mod audio. Cliquez « + Ajouter » pour créer un mapping audio.
            </div>
          )}
          {current.audio_mods.map((mod, i) => (
            <div key={i} className="bg-gray-800/60 rounded p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-cyan-400 text-[10px] font-mono">
                  {audioSourceLabel(mod.source)} → {audioTargetLabel(mod.target)}
                </span>
                <button onClick={() => removeAudioMod(i)} className="text-red-400 text-[10px]">✕</button>
              </div>
              <Slider label="Intensité" value={mod.amount} min={0} max={2} step={0.05}
                onChange={(v) => {
                  const mods = [...current.audio_mods];
                  mods[i] = { ...mod, amount: v };
                  updateCurrent({ audio_mods: mods });
                }} color="cyan" />
              <Slider label="Lissage" value={mod.smoothing} min={0} max={0.95} step={0.05}
                onChange={(v) => {
                  const mods = [...current.audio_mods];
                  mods[i] = { ...mod, smoothing: v };
                  updateCurrent({ audio_mods: mods });
                }} color="cyan" />
            </div>
          ))}
          {showAudioAdd && (
            <AudioModAdder onAdd={(mod) => { addAudioMod(mod); setShowAudioAdd(false); }} onCancel={() => setShowAudioAdd(false)} />
          )}
          {!showAudioAdd && (
            <button onClick={() => setShowAudioAdd(true)}
              className="w-full py-1.5 bg-cyan-900/40 hover:bg-cyan-800/60 text-cyan-300 text-[10px] rounded font-medium">
              + Ajouter un mod audio
            </button>
          )}
        </Section>
        )}

        {/* TRACKS — sélection + depth + phase spread (seulement si slot édité) */}
        {hasEditingSlot && (
        <Section title="Tracks" icon="◉" badge={selectedCount > 0 ? `${selectedCount}/${totalTracks}` : `${totalTracks}`}>
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
            <div className="text-gray-600 text-[10px]">
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
                  <div className="text-gray-600 text-[10px] mb-1">Aucune track disponible</div>
                  <div className="text-gray-700 text-[9px]">Import .hol ou ajoutez des tracks manuelles</div>
                </div>
              )}
            </div>
          )}
          {!showExpert && (
            <>
              <Slider label="Spread" value={current.phase_spread} min={0} max={1} step={0.05}
                onChange={(v) => updateCurrent({ phase_spread: v })} color="cyan" />
              <div className="text-gray-600 text-[9px] -mt-1">Décalage de phase entre tracks (effet chasing)</div>
            </>
          )}
          {centroid && (
            <div className="text-cyan-400 text-[9px] font-mono pt-1">
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
                  <span className={`text-[8px] font-mono w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${
                    mv.is_preview ? 'bg-cyan-800 text-cyan-300' : 'bg-green-800 text-green-300'
                  }`}>{idx + 1}</span>
                  <span className="text-white text-[10px] font-medium truncate flex-1">{mv.name}</span>
                  <span className="text-gray-500 text-[8px] font-mono flex-shrink-0">{trackCount}tr</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); stopMovementWithFade(mv.id, 0.5); }}
                    className="text-yellow-400 hover:text-yellow-300 text-[9px] px-1 flex-shrink-0"
                    title="Stop avec fade 0.5s"
                  >◆</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); stopMovement(mv.id); }}
                    className="text-red-400 hover:text-red-300 text-[9px] px-1 flex-shrink-0"
                    title="Stop immédiat"
                  >■</button>
                </div>
              );
            })}
            <button
              onClick={() => stopAllMovements()}
              className="w-full py-1 bg-red-900/50 hover:bg-red-900/70 text-red-400 text-[10px] rounded font-medium transition-colors"
            >
              ■ Stop All
            </button>
          </div>
        )}
        <div className={`flex gap-1.5 transition-all ${flashClass}`}>
          <div className="flex-1 py-2 bg-gray-800/40 text-gray-500 text-[10px] rounded-lg text-center flex items-center justify-center border border-gray-700/30">
            Lancer via MovesTable ▶
          </div>
          <button
            onClick={() => panic()}
            className="px-2 py-2.5 bg-red-800 hover:bg-red-700 text-white text-[11px] rounded-lg font-bold border border-red-500/50 transition-colors"
            title="PANIC (Esc) — Stop all + return to origin"
          >
            ⚠
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers pour labels audio ──
function audioSourceLabel(s: AudioModSource): string {
  if (typeof s === 'string') {
    const map: Record<string, string> = {
      bpm: 'BPM', amplitude_rms: 'RMS', amplitude_bass: 'Bass',
      amplitude_mid: 'Mid', amplitude_high: 'High',
    };
    return map[s] ?? s;
  }
  return `Band ${s.spectrum_band}`;
}

function audioTargetLabel(t: AudioModTarget): string {
  const map: Record<string, string> = {
    speed: 'Speed', scale: 'Scale', radius_scale: 'Radius',
    height_offset: 'Height', offset_x: 'Offset X', offset_y: 'Offset Y',
    offset_z: 'Offset Z', yaw: 'Yaw', pitch: 'Pitch', roll: 'Roll',
  };
  if (typeof t === 'string') return map[t] ?? t;
  return String(t);
}

// ── Composant pour ajouter un audio mod ──
function AudioModAdder({ onAdd, onCancel }: { onAdd: (mod: AudioMod) => void; onCancel: () => void }) {
  const [source, setSource] = React.useState<AudioModSource>('amplitude_bass');
  const [target, setTarget] = React.useState<AudioModTarget>('radius_scale');
  const [amount, setAmount] = React.useState(0.5);

  return (
    <div className="bg-gray-800/80 rounded p-2 space-y-2 border border-cyan-900/40">
      <div>
        <div className="text-gray-400 text-[9px] mb-0.5">Source</div>
        <select value={typeof source === 'string' ? source : 'spectrum_band'}
          onChange={(e) => setSource(e.target.value as AudioModSource)}
          className="w-full bg-gray-900 text-white text-[10px] rounded px-1.5 py-1 border border-gray-700">
          <option value="bpm">BPM</option>
          <option value="amplitude_rms">Amplitude RMS</option>
          <option value="amplitude_bass">Bass</option>
          <option value="amplitude_mid">Mid</option>
          <option value="amplitude_high">High</option>
        </select>
      </div>
      <div>
        <div className="text-gray-400 text-[9px] mb-0.5">Target (macro)</div>
        <select value={typeof target === 'string' ? target : 'radius_scale'}
          onChange={(e) => setTarget(e.target.value as AudioModTarget)}
          className="w-full bg-gray-900 text-white text-[10px] rounded px-1.5 py-1 border border-gray-700">
          <option value="radius_scale">Radius Scale</option>
          <option value="height_offset">Height Offset</option>
          <option value="speed">Speed</option>
          <option value="scale">Scale</option>
          <option value="offset_x">Offset X</option>
          <option value="offset_y">Offset Y</option>
          <option value="offset_z">Offset Z</option>
          <option value="yaw">Yaw</option>
          <option value="pitch">Pitch</option>
          <option value="roll">Roll</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-gray-400 text-[10px] w-16">Intensité</span>
        <input type="range" min={0} max={2} step={0.05} value={amount}
          onChange={(e) => setAmount(parseFloat(e.target.value))}
          className="flex-1 accent-cyan-500" />
        <span className="text-white text-[10px] font-mono w-8 text-right">{amount.toFixed(2)}</span>
      </div>
      <div className="flex gap-1.5">
        <button onClick={() => onAdd({ source, target, amount, base_value: 0, smoothing: 0.3 })}
          className="flex-1 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] rounded font-medium">
          Ajouter
        </button>
        <button onClick={onCancel}
          className="px-2 py-1.5 bg-gray-800 text-gray-400 hover:text-white text-[10px] rounded">
          ✕
        </button>
      </div>
    </div>
  );
}

// ── InspectorSplineLibrary ──────────────────────────────────────────────────
// Section Spline Library pour l'Inspector (mode Simple, tab Params)
function InspectorSplineLibrary({ drawSplineNode, onUpdate }: {
  drawSplineNode: any;
  onUpdate: (points: string) => void;
}) {
  const savedSplines = useGraphStore((s) => s.savedSplines);
  const saveSpline = useGraphStore((s) => s.saveSpline);
  const deleteSpline = useGraphStore((s) => s.deleteSpline);
  const [showSave, setShowSave] = React.useState(false);
  const [splineName, setSplineName] = React.useState('');

  const currentPoints = (drawSplineNode?.data as any)?.params?.points ?? '';

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
        <span className="text-cyan-400 text-[10px] font-mono font-semibold">SPLINE LIBRARY</span>
        <span className="text-gray-600 text-[9px]">{savedSplines.length} sauvée{savedSplines.length > 1 ? 's' : ''}</span>
      </div>

      {/* Charger depuis la bibliothèque */}
      {savedSplines.length > 0 && (
        <select
          onChange={handleLoad}
          defaultValue=""
          className="w-full px-2 py-1.5 bg-gray-900 text-cyan-300 text-[10px] font-mono rounded border border-gray-700 focus:border-cyan-500 focus:outline-none"
        >
          <option value="" disabled>↳ Charger une spline...</option>
          {savedSplines.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}

      {/* Liste des splines sauvegardées */}
      {savedSplines.length > 0 && (
        <div className="space-y-0.5 max-h-32 overflow-y-auto">
          {savedSplines.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-[10px] py-0.5">
              <button
                onClick={() => onUpdate(s.points)}
                className="text-gray-400 hover:text-cyan-300 font-mono truncate flex-1 text-left"
                title="Charger cette spline"
              >{s.name}</button>
              <button
                onClick={() => deleteSpline(s.id)}
                className="text-red-500 hover:text-red-400 px-1 flex-shrink-0"
                title="Supprimer"
              >✕</button>
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
            className="flex-1 px-2 py-1.5 bg-gray-900 text-white text-[10px] rounded border border-gray-700 focus:border-cyan-500 focus:outline-none"
          />
          <button onClick={handleSave}
            className="text-green-400 hover:text-green-300 text-xs px-2" title="Confirmer">✓</button>
          <button onClick={() => setShowSave(false)}
            className="text-gray-500 hover:text-gray-400 text-xs px-2" title="Annuler">✕</button>
        </div>
      ) : (
        <button
          onClick={() => setShowSave(true)}
          className="w-full text-[10px] text-cyan-400 hover:text-cyan-300 border border-cyan-800/60 hover:border-cyan-600 rounded py-1.5 transition-colors"
        >
          + Sauvegarder cette spline
        </button>
      )}
    </div>
  );
}
