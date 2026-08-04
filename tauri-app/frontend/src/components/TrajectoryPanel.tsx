import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { SHAPE_PRESETS } from '../utils/shapePresets';

/// Params simplifiés pour l'ingénieur — un sous-ensemble lisible des params engine
interface SimpleParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

/// Mapping shape → params spécifiques (section "Shape")
const SHAPE_PARAMS: Record<string, SimpleParam[]> = {
  circle: [
    { key: 'radius', label: 'Rayon', min: 0.1, max: 10, step: 0.1, default: 2.0 },
  ],
  elliptical: [
    { key: 'radius_x', label: 'Largeur', min: 0.1, max: 10, step: 0.1, default: 3.0 },
    { key: 'radius_y', label: 'Hauteur', min: 0.1, max: 10, step: 0.1, default: 1.5 },
  ],
  spiral: [
    { key: 'start_radius', label: 'Rayon départ', min: 0, max: 5, step: 0.1, default: 0.3 },
    { key: 'end_radius', label: 'Rayon arrivée', min: 0.1, max: 10, step: 0.1, default: 3.0 },
    { key: 'turns', label: 'Tours', min: 0.5, max: 10, step: 0.5, default: 3.0 },
  ],
  figure8: [
    { key: 'scale', label: 'Échelle', min: 0.1, max: 10, step: 0.1, default: 2.5 },
  ],
  lissajous: [
    { key: 'a', label: 'Ratio X', min: 1, max: 10, step: 1, default: 3.0 },
    { key: 'b', label: 'Ratio Y', min: 1, max: 10, step: 1, default: 2.0 },
    { key: 'amplitude_x', label: 'Amp X', min: 0.1, max: 10, step: 0.1, default: 2.5 },
    { key: 'amplitude_y', label: 'Amp Y', min: 0.1, max: 10, step: 0.1, default: 2.0 },
  ],
  helix: [
    { key: 'radius', label: 'Rayon', min: 0.1, max: 10, step: 0.1, default: 2.0 },
    { key: 'height', label: 'Hauteur', min: 0, max: 10, step: 0.1, default: 3.0 },
    { key: 'turns', label: 'Tours', min: 0.5, max: 10, step: 0.5, default: 2.0 },
  ],
  rose: [
    { key: 'n', label: 'Pétales', min: 2, max: 12, step: 1, default: 4 },
    { key: 'amplitude', label: 'Amplitude', min: 0.1, max: 10, step: 0.1, default: 2.5 },
  ],
  linear: [],
};

// ── Section repliable ──
function Section({
  title, icon, defaultOpen = true, children, badge,
}: {
  title: string; icon: string; defaultOpen?: boolean; children: React.ReactNode; badge?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="border-b border-gray-700/40">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800/40 transition-colors"
      >
        <span className="text-xs">{icon}</span>
        <span className="text-gray-300 text-[11px] font-semibold uppercase tracking-wider flex-1 text-left">
          {title}
        </span>
        {badge && <span className="text-gray-500 text-[9px] font-mono">{badge}</span>}
        <span className={`text-gray-500 text-[10px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

// ── Slider compact ──
function Slider({
  label, value, min, max, step, onChange, unit, color = 'blue',
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; unit?: string; color?: 'blue' | 'green' | 'purple';
}) {
  const accent = color === 'green' ? 'accent-green-500' : color === 'purple' ? 'accent-purple-500' : 'accent-blue-500';
  const decimals = step < 1 ? (step < 0.1 ? 2 : 1) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-400 text-[10px] w-16 flex-shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={`flex-1 h-1.5 ${accent}`}
      />
      <span className="text-white text-[10px] font-mono w-12 text-right">
        {value.toFixed(decimals)}{unit ?? ''}
      </span>
    </div>
  );
}

export default function TrajectoryPanel() {
  const {
    nodes, setNodes, setEdges,
    holProject, selectedTrackIds, toggleTrackSelection,
    selectAllTracks, deselectAllTracks,
    manualOscIds,
    macros, setMacros, pushMacrosToRuntime,
    movements, isPlaying, updateGraphLive,
    playMovement, compile,
    updateNodeData,
  } = useGraphStore();
  const { oscAddress, oscPort, oscProfile } = useGraphStore();

  const hasActiveRuntime = isPlaying || movements.length > 0;
  const [selectedShape, setSelectedShape] = React.useState<string>('circle');
  const [shapeParams, setShapeParams] = React.useState<Record<string, number>>({});
  // Perform params (communs à tous les shapes)
  const [speed, setSpeed] = React.useState(1.0);
  const [duration, setDuration] = React.useState(4.0);

  React.useEffect(() => {
    const params = SHAPE_PARAMS[selectedShape];
    if (params) {
      const defaults: Record<string, number> = {};
      params.forEach((p) => { defaults[p.key] = p.default; });
      setShapeParams(defaults);
    }
  }, [selectedShape]);

  const getSelectedOscIds = () => {
    if (holProject && holProject.tracks.length > 0) {
      return holProject.tracks.filter((t) => selectedTrackIds.has(t.id)).map((t) => t.id);
    }
    return manualOscIds;
  };

  const applyShape = (shapeId: string) => {
    const preset = SHAPE_PRESETS.find((p) => p.id === shapeId);
    if (!preset) return;
    const ids = getSelectedOscIds();
    const nObjects = ids.length > 0 ? ids.length : 8;
    const { nodes: newNodes, edges: newEdges } = preset.build(nObjects);
    setNodes(newNodes);
    setEdges(newEdges);
    setSelectedShape(shapeId);
  };

  // Met à jour un param du node engine + hot-swap
  const updateEngineParam = (key: string, value: number) => {
    setShapeParams((prev) => ({ ...prev, [key]: value }));
    const engineNode = nodes.find((n) => {
      const type = (n.data as any)?.type ?? (n.data as any)?.label;
      return type !== 'Objects' && type !== 'Duration' && type !== 'Output';
    });
    if (engineNode) {
      updateNodeData(engineNode.id, { params: { ...(engineNode.data as any).params, [key]: value } });
      if (hasActiveRuntime) updateGraphLive(0.2);
    }
  };

  // Met à jour la speed (param commun à presque tous les engines)
  const handleSpeedChange = (v: number) => {
    setSpeed(v);
    const engineNode = nodes.find((n) => {
      const type = (n.data as any)?.type ?? (n.data as any)?.label;
      return type !== 'Objects' && type !== 'Duration' && type !== 'Output';
    });
    if (engineNode && (engineNode.data as any).params?.speed !== undefined) {
      updateEngineParam('speed', v);
    }
  };

  // Met à jour la duration (node Duration)
  const handleDurationChange = (v: number) => {
    setDuration(v);
    const durationNode = nodes.find((n) => {
      const type = (n.data as any)?.type ?? (n.data as any)?.label;
      return type === 'Duration';
    });
    if (durationNode) {
      updateNodeData(durationNode.id, { params: { ...(durationNode.data as any).params, duration: v } });
      if (hasActiveRuntime) updateGraphLive(0.2);
    }
  };

  const handleMacroChange = (key: string, value: number) => {
    setMacros({ [key]: value } as any);
    if (hasActiveRuntime) pushMacrosToRuntime();
  };

  const handleLaunch = async (isPreview: boolean) => {
    const ok = await compile();
    if (!ok) return;
    const trackIndices = getTargetTrackIndices();
    const name = isPreview ? 'Preview' : `Live ${movements.length + 1}`;
    await playMovement(name, trackIndices, isPreview, oscAddress, oscPort, oscProfile);
  };

  const getTargetTrackIndices = () => {
    if (holProject && holProject.tracks.length > 0) {
      const indices = holProject.tracks
        .map((t, idx) => selectedTrackIds.has(t.id) ? idx : -1)
        .filter((idx) => idx >= 0);
      if (indices.length > 0) return indices;
      return holProject.tracks.map((_, idx) => idx);
    }
    if (selectedTrackIds.size > 0) {
      return manualOscIds
        .map((id, idx) => selectedTrackIds.has(id) ? idx : -1)
        .filter((idx) => idx >= 0);
    }
    return manualOscIds.map((_, idx) => idx);
  };

  // Centroïde
  const centroid = React.useMemo(() => {
    if (holProject && holProject.tracks.length > 0) {
      const tracks = selectedTrackIds.size > 0
        ? holProject.tracks.filter((t) => selectedTrackIds.has(t.id))
        : holProject.tracks;
      if (tracks.length === 0) return null;
      const sum = tracks.reduce(
        (acc, t) => [acc[0] + t.position[0], acc[1] + t.position[1], acc[2] + t.position[2]],
        [0, 0, 0],
      );
      return [sum[0] / tracks.length, sum[1] / tracks.length, sum[2] / tracks.length] as [number, number, number];
    }
    return null;
  }, [holProject, selectedTrackIds]);

  const shapeSpecificParams = SHAPE_PARAMS[selectedShape] ?? [];
  const tracks = holProject?.tracks ?? [];
  const selectedCount = selectedTrackIds.size;
  const totalTracks = tracks.length || manualOscIds.length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Shape selection (toujours visible en haut) ── */}
      <div className="border-b border-gray-700/50 p-2 flex-shrink-0">
        <div className="text-gray-400 text-[10px] uppercase tracking-wider mb-1.5 px-1">Shape</div>
        <div className="grid grid-cols-4 gap-1">
          {SHAPE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => applyShape(preset.id)}
              className={`flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-all ${
                selectedShape === preset.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
              title={preset.description}
            >
              <span className="text-base">{preset.icon}</span>
              <span className="text-[8px]">{preset.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Sections repliables ── */}
      <div className="flex-1 overflow-y-auto">
        {/* PERFORM — speed, duration, loop, direction */}
        <Section title="Perform" icon="▶" defaultOpen>
          <Slider label="Vitesse" value={speed} min={0.1} max={4} step={0.05} onChange={handleSpeedChange} unit="x" />
          <Slider label="Durée" value={duration} min={0.5} max={30} step={0.5} onChange={handleDurationChange} unit="s" />
        </Section>

        {/* SHAPE — params spécifiques au shape choisi */}
        {shapeSpecificParams.length > 0 && (
          <Section title="Shape" icon={SHAPE_PRESETS.find((p) => p.id === selectedShape)?.icon ?? '◆'} defaultOpen>
            {shapeSpecificParams.map((param) => (
              <Slider
                key={param.key}
                label={param.label}
                value={shapeParams[param.key] ?? param.default}
                min={param.min}
                max={param.max}
                step={param.step}
                onChange={(v) => updateEngineParam(param.key, v)}
              />
            ))}
          </Section>
        )}

        {/* TRANSFORM — scale, rotation, offset (= macros) */}
        <Section title="Transform" icon="⟲" defaultOpen>
          <Slider label="Échelle" value={macros.scale} min={0} max={4} step={0.05} onChange={(v) => handleMacroChange('scale', v)} color="green" />
          <Slider label="Pos X" value={macros.shiftX} min={-5} max={5} step={0.1} onChange={(v) => handleMacroChange('shiftX', v)} color="green" />
          <Slider label="Pos Y" value={macros.shiftY} min={-5} max={5} step={0.1} onChange={(v) => handleMacroChange('shiftY', v)} color="green" />
          <Slider label="Pos Z" value={macros.shiftZ} min={-5} max={5} step={0.1} onChange={(v) => handleMacroChange('shiftZ', v)} color="green" />
          <Slider label="Yaw" value={macros.yaw} min={-180} max={180} step={1} onChange={(v) => handleMacroChange('yaw', v)} unit="°" color="green" />
          <Slider label="Pitch" value={macros.pitch} min={-90} max={90} step={1} onChange={(v) => handleMacroChange('pitch', v)} unit="°" color="green" />
          <Slider label="Roll" value={macros.roll} min={-180} max={180} step={1} onChange={(v) => handleMacroChange('roll', v)} unit="°" color="green" />
        </Section>

        {/* TRACKS — sélection + centroïde */}
        <Section
          title="Tracks"
          icon="◉"
          defaultOpen
          badge={selectedCount > 0 ? `${selectedCount}/${totalTracks}` : `${totalTracks}`}
        >
          {tracks.length > 0 ? (
            <>
              <div className="flex gap-1 mb-1">
                <button onClick={selectAllTracks} className="flex-1 py-0.5 text-[9px] bg-gray-800 hover:bg-gray-700 text-gray-400 rounded">Tout</button>
                <button onClick={deselectAllTracks} className="flex-1 py-0.5 text-[9px] bg-gray-800 hover:bg-gray-700 text-gray-400 rounded">Aucun</button>
              </div>
              <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                {tracks.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => toggleTrackSelection(t.id)}
                    className={`px-1.5 py-0.5 text-[10px] rounded font-mono transition-all ${
                      selectedTrackIds.has(t.id)
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-500 hover:bg-gray-700'
                    }`}
                    title={t.name}
                  >
                    {t.id}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="text-gray-600 text-[10px]">
              {manualOscIds.length > 0
                ? `${manualOscIds.length} tracks virtuelles`
                : 'Import .hol ou ajoutez des tracks'}
            </div>
          )}
          {centroid && (
            <div className="text-cyan-400 text-[9px] font-mono pt-1">
              centre: ({centroid[0].toFixed(1)}, {centroid[1].toFixed(1)}, {centroid[2].toFixed(1)})
            </div>
          )}
        </Section>
      </div>

      {/* ── Launch (fixe en bas) ── */}
      <div className="border-t border-gray-700/50 p-2 flex-shrink-0 space-y-1.5">
        <div className="flex gap-1.5">
          <button
            onClick={() => handleLaunch(true)}
            disabled={nodes.length === 0}
            className="flex-1 py-2 bg-cyan-700 hover:bg-cyan-600 text-white text-[11px] rounded-lg font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Preview
          </button>
          <button
            onClick={() => handleLaunch(false)}
            disabled={nodes.length === 0}
            className="flex-1 py-2 bg-green-600 hover:bg-green-500 text-white text-[11px] rounded-lg font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Launch Live
          </button>
        </div>
        {hasActiveRuntime && (
          <div className="text-green-400 text-[9px] text-center animate-pulse">
            ● {movements.length} movement{movements.length > 1 ? 's' : ''} actif{movements.length > 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}
