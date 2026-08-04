import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { safeInvoke as invoke } from '../utils/tauri';
import { SHAPE_PRESETS, type ShapePreset } from '../utils/shapePresets';
import { prepareGraphForSave } from './nodeParamSchema';

const CATEGORY_LABELS: Record<ShapePreset['category'], { label: string; color: string }> = {
  basic: { label: 'Basic', color: 'text-blue-400' },
  modifier: { label: 'Modifiers', color: 'text-pink-400' },
  composite: { label: 'Composite', color: 'text-purple-400' },
  spline: { label: 'Splines', color: 'text-cyan-400' },
  physics: { label: 'Physics', color: 'text-green-400' },
  audio: { label: 'Audio', color: 'text-yellow-400' },
};

const CATEGORY_ORDER: ShapePreset['category'][] = ['basic', 'modifier', 'composite', 'spline', 'physics', 'audio'];

export default function ShapePresetsBar() {
  const applyShapePreset = useGraphStore((s) => s.applyShapePreset);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const setNodes = useGraphStore((s) => s.setNodes);
  const setEdges = useGraphStore((s) => s.setEdges);
  const getSelectedOscIds = useGraphStore((s) => s.getSelectedOscIds);
  const isPlaying = useGraphStore((s) => s.isPlaying);
  const movements = useGraphStore((s) => s.movements);
  const updateGraphLive = useGraphStore((s) => s.updateGraphLive);
  const hasActiveRuntime = isPlaying || movements.length > 0;

  const [customPresets, setCustomPresets] = React.useState<string[]>([]);
  const [showSaveInput, setShowSaveInput] = React.useState(false);
  const [presetName, setPresetName] = React.useState('');
  const [showAll, setShowAll] = React.useState(false);

  const hasGraph = nodes.length > 0;

  React.useEffect(() => {
    invoke<string[]>('preset_list').then((p) => setCustomPresets(p ?? [])).catch(() => {});
  }, []);

  const handleApply = (presetId: string) => {
    const ids = getSelectedOscIds();
    const nObjects = ids.length > 0 ? ids.length : 8;
    applyShapePreset(presetId, nObjects);
  };

  const handleSavePreset = async () => {
    if (!presetName.trim() || !hasGraph) return;
    const graphData = prepareGraphForSave(nodes, edges);
    try {
      await invoke('preset_save', { name: presetName.trim(), config: graphData });
      const updated = await invoke<string[]>('preset_list');
      setCustomPresets(updated);
      setPresetName('');
      setShowSaveInput(false);
    } catch (e) {
      console.error('Failed to save preset:', e);
    }
  };

  const handleLoadPreset = async (name: string) => {
    try {
      const preset = await invoke<{ name: string; config: any } | null>('preset_load', { name });
      if (preset?.config) {
        setNodes(preset.config.nodes ?? []);
        setEdges(preset.config.edges ?? []);
        if (hasActiveRuntime) updateGraphLive(0.5);
      }
    } catch (e) {
      console.error('Failed to load preset:', e);
    }
  };

  const handleDeletePreset = async (name: string) => {
    try {
      await invoke('preset_delete', { name });
      const updated = await invoke<string[]>('preset_list');
      setCustomPresets(updated);
    } catch (e) {
      console.error('Failed to delete preset:', e);
    }
  };

  // Group presets by category
  const presetsByCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    presets: SHAPE_PRESETS.filter((p) => p.category === cat),
  })).filter((g) => g.presets.length > 0);

  // When collapsed, show only basic + a "show all" button
  const visibleCategories = showAll ? presetsByCategory : presetsByCategory.slice(0, 1);

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-gray-900/60 border-b border-stagespace-border overflow-x-auto">
      <span className="text-gray-500 text-[10px] font-medium uppercase tracking-wider mr-1 flex-shrink-0">
        Presets
      </span>

      {visibleCategories.map((group, gi) => (
        <React.Fragment key={group.cat}>
          {gi > 0 && <div className="w-px h-4 bg-gray-700 mx-1 flex-shrink-0" />}
          <span className={`text-[9px] font-semibold uppercase tracking-wider flex-shrink-0 ${CATEGORY_LABELS[group.cat].color}`}>
            {CATEGORY_LABELS[group.cat].label}
          </span>
          {group.presets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleApply(preset.id)}
              title={preset.description}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-all flex-shrink-0 ${
                hasGraph
                  ? 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                  : 'bg-gray-800/50 text-gray-500 hover:bg-gray-700 hover:text-white'
              }`}
            >
              <span className="text-sm">{preset.icon}</span>
              <span>{preset.name}</span>
            </button>
          ))}
        </React.Fragment>
      ))}

      {/* Show all / show less */}
      <button
        onClick={() => setShowAll(!showAll)}
        className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white transition-all flex-shrink-0"
        title={showAll ? 'Show basic only' : 'Show all categories'}
      >
        <span>{showAll ? '◂◂' : '▸▸'}</span>
        <span>{showAll ? 'Less' : `+${SHAPE_PRESETS.length - presetsByCategory[0].presets.length} more`}</span>
      </button>

      {/* Separator */}
      <div className="w-px h-4 bg-gray-700 mx-1 flex-shrink-0" />

      {/* Custom presets */}
      {customPresets.map((name) => (
        <div key={name} className="flex items-center gap-0.5 flex-shrink-0 group">
          <button
            onClick={() => handleLoadPreset(name)}
            className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-purple-900/40 text-purple-300 hover:bg-purple-800/60 hover:text-purple-100 transition-all"
            title={`Load preset: ${name}`}
          >
            <span className="text-sm">★</span>
            <span>{name}</span>
          </button>
          <button
            onClick={() => handleDeletePreset(name)}
            className="text-red-400 hover:text-red-300 text-[9px] opacity-0 group-hover:opacity-100 transition-opacity"
            title="Delete preset"
          >
            ✕
          </button>
        </div>
      ))}

      {/* Save current as preset */}
      {showSaveInput ? (
        <div className="flex items-center gap-1 flex-shrink-0">
          <input
            type="text"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
            placeholder="Preset name..."
            autoFocus
            className="w-24 px-2 py-1 bg-gray-900 text-white text-[11px] rounded border border-purple-700 focus:outline-none"
          />
          <button
            onClick={handleSavePreset}
            disabled={!presetName.trim()}
            className="px-2 py-1 text-[11px] rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40"
          >
            Save
          </button>
          <button
            onClick={() => { setShowSaveInput(false); setPresetName(''); }}
            className="px-1.5 py-1 text-[11px] rounded bg-gray-800 text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowSaveInput(true)}
          disabled={!hasGraph}
          className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white transition-all flex-shrink-0 disabled:opacity-30"
          title="Save current graph as reusable preset"
        >
          <span className="text-sm">＋</span>
          <span>Save</span>
        </button>
      )}
    </div>
  );
}
