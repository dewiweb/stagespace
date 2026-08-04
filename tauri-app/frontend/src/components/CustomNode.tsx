import React, { useState, useRef, useCallback } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { useGraphStore, NodeType } from '../store/useGraphStore';
import { PARAM_SCHEMA, getCategoryColor, type ParamDef } from './nodeParamSchema';
import { isSourceNode, isTerminalNode, isBinaryComposite, getInputPorts } from '../utils/connectionRules';

const AUDIO_NODE_TYPES = new Set(['BPM', 'AudioAmplitude', 'AudioSpectrum', 'AudioAmplitudeFalloff']);

interface CustomNodeData {
  label: string;
  type: NodeType;
  params: Record<string, any>;
}

const CustomNode: React.FC<NodeProps<CustomNodeData>> = ({ data, id }) => {
  const [expanded, setExpanded] = useState(false);
  const [trackIdsText, setTrackIdsText] = useState<string | null>(null);
  const updateNodeData = useGraphStore((s) => s.updateNodeData);
  const color = getCategoryColor(data.type);
  const schema = PARAM_SCHEMA[data.type] ?? [];
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasInput = !isSourceNode(data.type);
  const hasOutput = !isTerminalNode(data.type);
  const isBinary = isBinaryComposite(data.type);
  const inputPorts = getInputPorts(data.type);

  // Audio live indicator — pour les nodes audio, afficher les valeurs live
  const isAudioNode = AUDIO_NODE_TYPES.has(data.type);
  const audioState = useGraphStore((s) => s.audioState);
  const audioBpm = audioState.bpm?.bpm ?? null;
  const audioRms = audioState.amplitude?.rms ?? null;
  const audioBass = audioState.amplitude?.bass ?? null;
  const audioMid = audioState.amplitude?.mid ?? null;
  const audioHigh = audioState.amplitude?.high ?? null;

  const handleChange = useCallback((key: string, value: any) => {
    updateNodeData(id, { params: { ...data.params, [key]: value } });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      useGraphStore.getState().updateGraphLive();
    }, 150);
  }, [id, data.params, updateNodeData]);

  const renderInput = (def: ParamDef) => {
    const value = data.params?.[def.key];

    switch (def.type) {
      case 'number':
        return (
          <input
            type="number"
            step={def.step ?? 0.1}
            min={def.min}
            max={def.max}
            value={value ?? 0}
            onChange={(e) => handleChange(def.key, parseFloat(e.target.value) || 0)}
            className="w-full px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
          />
        );
      case 'boolean':
        return (
          <button
            onClick={() => handleChange(def.key, !value)}
            className={`relative w-9 h-5 rounded-full transition-colors ${value ? 'bg-blue-600' : 'bg-gray-700'}`}
            aria-label={def.label}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`} />
          </button>
        );
      case 'enum':
        return (
          <select
            value={value ?? ''}
            onChange={(e) => handleChange(def.key, e.target.value)}
            className="w-full px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
          >
            {def.options?.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );
      case 'vec3': {
        const arr = Array.isArray(value) ? value : [0, 0, 0];
        return (
          <input
            type="text"
            value={arr.join(', ')}
            onChange={(e) => {
              const parsed = e.target.value.split(',').map((v) => parseFloat(v.trim()));
              if (parsed.length === 3 && parsed.every((n) => !isNaN(n))) {
                handleChange(def.key, parsed);
              }
            }}
            className="w-full px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none font-mono"
            placeholder="x, y, z"
          />
        );
      }
      case 'text':
      case 'string':
        return (
          <input
            type="text"
            value={value ?? ''}
            onChange={(e) => handleChange(def.key, e.target.value)}
            className="w-full px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none font-mono"
          />
        );
      default:
        return null;
    }
  };

  const trackIdsValue = trackIdsText !== null ? trackIdsText : ((data.params?.track_ids as number[]) ?? []).join(', ');
  const commitTrackIds = () => {
    const ids = (trackIdsText ?? '')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    handleChange('track_ids', ids);
    handleChange('n_objects', ids.length);
    useGraphStore.getState().setManualOscIds(ids);
    setTrackIdsText(null);
  };

  // Rendu des handles d'input selon le type de node
  const renderInputHandles = () => {
    if (!hasInput) return null;

    if (isBinary) {
      // Composites binaires : 2 handles à gauche (A en haut, B en bas)
      return (
        <>
          <Handle
            type="target"
            position={Position.Left}
            id="input_a"
            style={{ top: '30%' }}
            className="!w-3 !h-3 !bg-blue-500"
          />
          <Handle
            type="target"
            position={Position.Left}
            id="input_b"
            style={{ top: '70%' }}
            className="!w-3 !h-3 !bg-purple-500"
          />
        </>
      );
    }

    // Node standard : 1 handle en haut
    // Pour les engines/physics/falloffs qui ont aussi un port "duration", on ajoute un handle latéral
    const hasDurationPort = inputPorts.includes('duration');
    return (
      <>
        <Handle
          type="target"
          position={Position.Top}
          id="input"
          className="!w-3 !h-3 !bg-gray-400"
        />
        {hasDurationPort && (
          <Handle
            type="target"
            position={Position.Left}
            id="duration"
            style={{ top: '50%' }}
            className="!w-2.5 !h-2.5 !bg-yellow-500"
          />
        )}
      </>
    );
  };

  return (
    <div className="bg-gray-800 border-2 rounded-lg shadow-lg min-w-[200px] transition-shadow hover:shadow-xl" style={{ borderColor: color + '60' }}>
      {renderInputHandles()}

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700" style={{ background: color + '20' }}>
        <div className="flex items-center gap-1.5 min-w-0">
          {isAudioNode && audioRms !== null && (
            <span className="flex items-center gap-1 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-red-400 text-[8px] font-bold tracking-wider">LIVE</span>
            </span>
          )}
          <span className="text-white text-sm font-semibold truncate">{data.label}</span>
        </div>
        {schema.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-gray-400 hover:text-white text-xs ml-2 px-1"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '▾' : '▸'}
          </button>
        )}
      </div>

      {/* Audio live values — affiché sous le header pour les nodes audio actifs */}
      {isAudioNode && audioRms !== null && (
        <div className="px-3 py-1.5 bg-gray-900/60 border-b border-gray-700/50 space-y-1">
          {data.type === 'BPM' && audioBpm !== null && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-gray-500">BPM live</span>
              <span className="text-cyan-400 font-mono font-bold">{audioBpm.toFixed(0)}</span>
            </div>
          )}
          {data.type === 'AudioAmplitude' && (
            <>
              <MiniBar label="RMS" value={audioRms ?? 0} color="bg-blue-500" />
              <MiniBar label="Bass" value={audioBass ?? 0} color="bg-red-500" />
              <MiniBar label="Mid" value={audioMid ?? 0} color="bg-green-500" />
              <MiniBar label="High" value={audioHigh ?? 0} color="bg-yellow-500" />
            </>
          )}
          {data.type === 'AudioSpectrum' && audioState.spectrum && (
            <div className="flex items-end gap-0.5 h-6">
              {audioState.spectrum.spectrum.slice(0, 16).map((v, i) => (
                <div
                  key={i}
                  className="flex-1 bg-gradient-to-t from-cyan-600 to-cyan-400 rounded-sm transition-all duration-75"
                  style={{ height: `${Math.max(2, Math.min(100, v * 100))}%` }}
                />
              ))}
            </div>
          )}
          {data.type === 'AudioAmplitudeFalloff' && (
            <MiniBar label="RMS" value={audioRms ?? 0} color="bg-orange-500" />
          )}
        </div>
      )}

      {/* Binary composite labels for A/B inputs */}
      {isBinary && hasInput && (
        <div className="flex justify-between px-1 py-0.5 text-[8px] text-gray-500 font-mono">
          <span className="text-blue-400">A</span>
          <span className="text-purple-400">B</span>
        </div>
      )}

      {/* Params */}
      {expanded && schema.length > 0 && (
        <div className="p-3 space-y-2">
          {schema.map((def) => (
            <div key={def.key} className="flex flex-col gap-1">
              <label className="text-gray-400 text-[11px] font-medium">{def.label}</label>
              {renderInput(def)}
            </div>
          ))}
          {data.type === 'Objects' && (
            <div className="mt-1 pt-2 border-t border-gray-700">
              <label className="text-cyan-400 text-[10px] font-mono">Linked Tracks</label>
              <input
                type="text"
                value={trackIdsValue}
                onChange={(e) => setTrackIdsText(e.target.value)}
                onBlur={commitTrackIds}
                onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                placeholder="ex: 1, 2, 3..."
                className="w-full mt-0.5 px-2 py-1 bg-gray-900 text-cyan-300 text-[10px] font-mono rounded border border-gray-700 focus:border-cyan-500 focus:outline-none"
              />
              {((data.params?.track_ids as number[]) ?? []).length > 0 && (
                <div className="flex flex-wrap gap-0.5 mt-1">
                  {(data.params.track_ids as number[]).slice(0, 16).map((id: number) => (
                    <span key={id} className="text-[8px] font-mono px-1 py-0.5 bg-cyan-900/40 text-cyan-400 rounded">
                      {id}
                    </span>
                  ))}
                  {(data.params.track_ids as number[]).length > 16 && (
                    <span className="text-[8px] text-gray-500">+{(data.params.track_ids as number[]).length - 16}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Objects quand collapsed : éditeur de tracks toujours visible */}
      {data.type === 'Objects' && !expanded && (
        <div className="px-3 py-1.5 border-t border-gray-700">
          <label className="text-cyan-400 text-[10px] font-mono">Linked Tracks</label>
          <input
            type="text"
            value={trackIdsValue}
            onChange={(e) => setTrackIdsText(e.target.value)}
            onBlur={commitTrackIds}
            onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
            placeholder="ex: 1, 2, 3..."
            className="w-full mt-0.5 px-2 py-1 bg-gray-900 text-cyan-300 text-[10px] font-mono rounded border border-gray-700 focus:border-cyan-500 focus:outline-none"
          />
          {((data.params?.track_ids as number[]) ?? []).length > 0 && (
            <div className="flex flex-wrap gap-0.5 mt-1">
              {(data.params.track_ids as number[]).slice(0, 12).map((id: number) => (
                <span key={id} className="text-[8px] font-mono px-1 py-0.5 bg-cyan-900/40 text-cyan-400 rounded">
                  {id}
                </span>
              ))}
              {(data.params.track_ids as number[]).length > 12 && (
                <span className="text-[8px] text-gray-500">+{(data.params.track_ids as number[]).length - 12}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Output node : afficher le track_range et les tracks correspondants en permanence */}
      {data.type === 'Output' && (
        <div className="px-3 py-1.5 border-t border-gray-700">
          {data.params?.track_range ? (
            <>
              <label className="text-green-400 text-[10px] font-mono">Track Range: {data.params.track_range}</label>
              <div className="flex flex-wrap gap-0.5 mt-1">
                {(() => {
                  const range = data.params.track_range as string;
                  let start = 0, end = 0;
                  if (range.includes('-')) {
                    const parts = range.split('-', 2);
                    start = parseInt(parts[0].trim()) || 0;
                    end = parts[1].trim() === '' ? 11 : (parseInt(parts[1].trim()) || 0);
                  } else {
                    start = parseInt(range.trim()) || 0;
                    end = start;
                  }
                  const ids: number[] = [];
                  for (let i = start; i <= end && i < start + 24; i++) ids.push(i);
                  return ids.map((id) => (
                    <span key={id} className="text-[8px] font-mono px-1 py-0.5 bg-green-900/40 text-green-400 rounded">
                      {id}
                    </span>
                  ));
                })()}
              </div>
            </>
          ) : (
            <span className="text-gray-500 text-[10px] font-mono">Single output (all tracks)</span>
          )}
        </div>
      )}

      {/* Handle de sortie — seulement si le node n'est pas terminal */}
      {hasOutput && (
        <Handle type="source" position={Position.Bottom} id="output" className="!w-3 !h-3 !bg-gray-400" />
      )}
    </div>
  );
};

const MiniBar: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div className="flex items-center gap-1.5">
    <span className="text-gray-500 text-[9px] w-7">{label}</span>
    <div className="flex-1 h-1.5 bg-gray-950 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-75 rounded-full`}
        style={{ width: `${Math.min(100, value * 100)}%` }}
      />
    </div>
    <span className="text-gray-600 text-[8px] font-mono w-6 text-right">{(value * 100).toFixed(0)}</span>
  </div>
);

export default CustomNode;
