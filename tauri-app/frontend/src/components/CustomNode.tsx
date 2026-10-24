import React, { useState, useRef, useCallback } from 'react';
import { X, Check } from 'lucide-react';
import { Handle, Position, NodeProps, type Node } from '@xyflow/react';
import { Slider } from './ui/Slider';
import { useGraphStore, NodeType } from '../store/useGraphStore';
import { useGlobalGraphStore } from '../store/useGlobalGraphStore';
import { useSignalGraphStore } from '../store/useSignalGraphStore';
import { PARAM_SCHEMA, getCategoryColor, pluginNodeSchema, pluginParamsOnSwitch, type ParamDef, type NodeParamValue } from './nodeParamSchema';
import { isSourceNode, isTerminalNode, isBinaryComposite, getInputPorts } from '../utils/connectionRules';

const AUDIO_NODE_TYPES = new Set(['BPM', 'AudioAmplitude', 'AudioSpectrum', 'AudioAmplitudeFalloff']);

interface CustomNodeData extends Record<string, unknown> {
  label: string;
  type: NodeType;
  params: Record<string, NodeParamValue>;
}

type AppNode = Node<CustomNodeData>;

const CustomNode: React.FC<NodeProps<AppNode>> = ({ data, id }) => {
  const [expanded, setExpanded] = useState(false);
  const [trackIdsText, setTrackIdsText] = useState<string | null>(null);
  const updateNodeData = useGraphStore((s) => s.updateNodeData);
  // Nodes du graph global : les params s'écrivent dans le store global
  // (le pushGlobalGraph debounced du NodeEditor propage au backend)
  const isGlobalNode = useGlobalGraphStore((s) => s.nodes.some((n) => n.id === id));
  const updateGlobalNodeData = useGlobalGraphStore((s) => s.updateNodeData);
  // Idem pour le graph signal (modulation) — sans ça les edits de params
  // tombaient dans le store move (id inconnu → drop silencieux).
  const isSignalNode = useSignalGraphStore((s) => s.nodes.some((n) => n.id === id));
  const updateSignalNodeData = useSignalGraphStore((s) => s.updateNodeData);
  const color = getCategoryColor(data.type);
  // Plugin : le schema vient du manifeste (résolu via params.plugin_id) et
  // le label affiché est le nom déclaré — sinon les tables statiques.
  const isPluginNode = data.type === 'Plugin';
  const pluginId = isPluginNode ? (data.params?.plugin_id as string | undefined) : undefined;
  const plugins = useGraphStore((s) => s.plugins);
  const pluginsLoaded = useGraphStore((s) => s.pluginsLoaded);
  const pluginManifest = isPluginNode
    ? (plugins.find((m) => m.id === pluginId) ?? null)
    : null;
  // Plugin désinstallé (ou .hfg d'une autre machine) — badge persistant,
  // plus visible qu'un toast éphémère à chaque édition. Un plugin_id vide
  // est juste "non configuré", pas cassé.
  const pluginMissing = isPluginNode && pluginsLoaded && !!pluginId && !pluginManifest;
  const schema = isPluginNode
    ? pluginNodeSchema(data.params, pluginManifest ? [pluginManifest] : [])
    : (PARAM_SCHEMA[data.type] ?? []);
  const displayLabel = isPluginNode ? (pluginManifest?.name ?? data.label) : data.label;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pluginKind = pluginManifest?.kind;
  const hasInput = !isSourceNode(data.type);
  const hasOutput = !isTerminalNode(data.type);
  const isBinary = isBinaryComposite(data.type)
    || (isPluginNode && pluginKind === 'composite');
  const inputPorts = getInputPorts(data.type, pluginKind);

  // Audio live indicator — pour les nodes audio, afficher les valeurs live
  // Optimisation: seuls les nodes audio se re-subscribe à audioState (60fps)
  // Les autres nodes retournent null → pas de re-render
  const isAudioNode = AUDIO_NODE_TYPES.has(data.type);
  const audioState = useGraphStore((s) =>
    isAudioNode ? s.audioState : null
  );
  const audioBpm = audioState?.bpm?.bpm ?? null;
  const audioRms = audioState?.amplitude?.rms ?? null;
  const audioBass = audioState?.amplitude?.bass ?? null;
  const audioMid = audioState?.amplitude?.mid ?? null;
  const audioHigh = audioState?.amplitude?.high ?? null;

  const handleChange = useCallback((key: string, value: NodeParamValue) => {
    let params = { ...data.params, [key]: value };
    // Switch de plugin : backfill des defaults du nouveau manifeste pour
    // les clés absentes (les clés propres à l'ancien plugin restent,
    // ignorées par le host).
    if (isPluginNode && key === 'plugin_id' && typeof value === 'string') {
      params = pluginParamsOnSwitch(
        plugins.find((m) => m.id === value),
        params,
      );
    }
    if (isGlobalNode) {
      updateGlobalNodeData(id, { params });
      return; // pushGlobalGraph (debounced) gère la propagation backend
    }
    if (isSignalNode) {
      updateSignalNodeData(id, { params });
      return; // pushSignalGraph (debounced) gère la propagation backend
    }
    updateNodeData(id, { params });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      useGraphStore.getState().updateGraphLive();
    }, 150);
  }, [id, data.params, updateNodeData, isGlobalNode, updateGlobalNodeData, isSignalNode, updateSignalNodeData, isPluginNode, plugins]);

  const blurOnEnter = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
  };

  const renderInput = (def: ParamDef) => {
    const value = data.params?.[def.key];

    switch (def.type) {
      case 'number':
        // Param borné → slider (plus intuitif qu'un input nu : la plage
        // est visible d'un coup d'œil, cohérent avec le panel Params).
        if (typeof def.min === 'number' && typeof def.max === 'number') {
          return (
            <Slider
              label={def.label}
              value={typeof value === 'number' ? value : 0}
              min={def.min}
              max={def.max}
              step={def.step ?? 0.1}
              accent="cyan"
              layout="stack"
              onChange={(v) => handleChange(def.key, v)}
            />
          );
        }
        return (
          <input
            type="number"
            step={def.step ?? 0.1}
            min={def.min}
            max={def.max}
            value={typeof value === 'number' ? value : 0}
            onChange={(e) => handleChange(def.key, parseFloat(e.target.value) || 0)}
            onKeyDown={blurOnEnter}
            className="w-full px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
          />
        );
      case 'boolean':
        return (
          <button
            onClick={() => handleChange(def.key, value !== true)}
            className={`relative w-9 h-5 rounded-full transition-colors ${value === true ? 'bg-blue-600' : 'bg-gray-700'}`}
            aria-label={def.label}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value === true ? 'translate-x-4' : ''}`} />
          </button>
        );
      case 'enum':
        return (
          <select
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => {
              handleChange(def.key, e.target.value);
              // Rendre le focus : sinon le select garde la main (flèches/
              // space continuent de changer la valeur au lieu d'agir sur
              // le canvas — sensation d'être "coincé" dans le dropdown).
              e.currentTarget.blur();
            }}
            onKeyDown={blurOnEnter}
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
            onKeyDown={blurOnEnter}
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
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => handleChange(def.key, e.target.value)}
            onKeyDown={blurOnEnter}
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
    // Nodes spline (Evaluate/Trim/Offset) : port 'spline' dédié pour DrawSpline
    const hasSplinePort = inputPorts.includes('spline');
    // Domaine signal : les ports multi-entrées (a/b/factor…) sont rendus à
    // gauche sous leurs propres ids — le premier reste le handle principal
    // en haut ('signal' ou 'a'), comme 'input' pour les trajectoires.
    const mainPorts = inputPorts.filter((p) => p !== 'duration' && p !== 'spline');
    const mainPort = mainPorts[0] ?? 'input';
    const extraPorts = mainPorts.slice(1);
    return (
      <>
        <Handle
          type="target"
          position={Position.Top}
          id={mainPort}
          className="!w-3 !h-3 !bg-gray-400"
        />
        {hasDurationPort && (
          <Handle
            type="target"
            position={Position.Left}
            id="duration"
            style={{ top: hasSplinePort ? '30%' : '50%' }}
            className="!w-2.5 !h-2.5 !bg-yellow-500"
          />
        )}
        {hasSplinePort && (
          <Handle
            type="target"
            position={Position.Left}
            id="spline"
            style={{ top: '70%' }}
            className="!w-2.5 !h-2.5 !bg-emerald-500"
          />
        )}
        {extraPorts.map((p, i) => (
          <Handle
            key={p}
            type="target"
            position={Position.Left}
            id={p}
            style={{ top: `${((i + 1) / (extraPorts.length + 1)) * 100}%` }}
            className="!w-2.5 !h-2.5 !bg-amber-400"
            title={p}
          />
        ))}
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
              <span className="text-red-400 text-xs font-bold tracking-wider">LIVE</span>
            </span>
          )}
          <span className="text-white text-sm font-semibold truncate">{displayLabel}</span>
          {pluginMissing && (
            <span
              className="flex-shrink-0 px-1 py-px rounded bg-red-900/60 text-red-300 text-[11px] font-bold tracking-wide"
              title={`Plugin '${pluginId ?? ''}' not loaded — .ssx missing from the plugins folder`}
            >
              MISSING
            </span>
          )}
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
            <div className="flex items-center justify-between text-xs">
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
          {data.type === 'AudioSpectrum' && audioState?.spectrum && (
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
        <div className="flex justify-between px-1 py-0.5 text-xs text-gray-500 font-mono">
          <span className="text-blue-400">A</span>
          <span className="text-purple-400">B</span>
        </div>
      )}

      {/* Signal multi-ports (a/b/factor…) : labels des handles latéraux
          — composites exclus (leur label A/B est déjà rendu au-dessus). */}
      {!isBinary && inputPorts.filter((p) => p !== 'duration' && p !== 'spline').length > 1 && (
        <div className="flex gap-2 px-1 py-0.5 text-xs text-gray-500 font-mono">
          {inputPorts
            .filter((p) => p !== 'duration' && p !== 'spline')
            .map((p, i) => (
              <span key={p} className={i === 0 ? 'text-gray-400' : 'text-amber-400'}>{p}</span>
            ))}
        </div>
      )}

      {/* Params */}
      {expanded && schema.length > 0 && (
        <div className="p-3 space-y-2">
          {schema.map((def) => (
            <div key={def.key} className="flex flex-col gap-1">
              <label className="text-gray-400 text-xs font-medium">{def.label}</label>
              {renderInput(def)}
            </div>
          ))}
          {data.type === 'Objects' && (
            <div className="mt-1 pt-2 border-t border-gray-700">
              <label className="text-cyan-400 text-xs font-mono">Linked Tracks</label>
              <input
                type="text"
                value={trackIdsValue}
                onChange={(e) => setTrackIdsText(e.target.value)}
                onBlur={commitTrackIds}
                onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                placeholder="ex: 1, 2, 3..."
                className="w-full mt-0.5 px-2 py-1 bg-gray-900 text-cyan-300 text-xs font-mono rounded border border-gray-700 focus:border-cyan-500 focus:outline-none"
              />
              {((data.params?.track_ids as number[]) ?? []).length > 0 && (
                <div className="flex flex-wrap gap-0.5 mt-1">
                  {(data.params.track_ids as number[]).slice(0, 16).map((id: number) => (
                    <span key={id} className="text-xs font-mono px-1 py-0.5 bg-cyan-900/40 text-cyan-400 rounded">
                      {id}
                    </span>
                  ))}
                  {(data.params.track_ids as number[]).length > 16 && (
                    <span className="text-xs text-gray-500">+{(data.params.track_ids as number[]).length - 16}</span>
                  )}
                </div>
              )}
            </div>
          )}
          {data.type === 'DrawSpline' && (
            <SplineLibraryControls nodeId={id} currentPoints={typeof data.params?.points === 'string' ? data.params.points : ''} />
          )}
        </div>
      )}

      {/* DrawSpline quand collapsed : bibliothèque toujours visible */}
      {data.type === 'DrawSpline' && !expanded && (
        <div className="px-3 py-1.5 border-t border-gray-700">
          <SplineLibraryControls nodeId={id} currentPoints={typeof data.params?.points === 'string' ? data.params.points : ''} />
        </div>
      )}

      {/* Objects quand collapsed : éditeur de tracks toujours visible */}
      {data.type === 'Objects' && !expanded && (
        <div className="px-3 py-1.5 border-t border-gray-700">
          <label className="text-cyan-400 text-xs font-mono">Linked Tracks</label>
          <input
            type="text"
            value={trackIdsValue}
            onChange={(e) => setTrackIdsText(e.target.value)}
            onBlur={commitTrackIds}
            onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
            placeholder="ex: 1, 2, 3..."
            className="w-full mt-0.5 px-2 py-1 bg-gray-900 text-cyan-300 text-xs font-mono rounded border border-gray-700 focus:border-cyan-500 focus:outline-none"
          />
          {((data.params?.track_ids as number[]) ?? []).length > 0 && (
            <div className="flex flex-wrap gap-0.5 mt-1">
              {(data.params.track_ids as number[]).slice(0, 12).map((id: number) => (
                <span key={id} className="text-xs font-mono px-1 py-0.5 bg-cyan-900/40 text-cyan-400 rounded">
                  {id}
                </span>
              ))}
              {(data.params.track_ids as number[]).length > 12 && (
                <span className="text-xs text-gray-500">+{(data.params.track_ids as number[]).length - 12}</span>
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
              <label className="text-green-400 text-xs font-mono">Track Range: {data.params.track_range}</label>
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
                    <span key={id} className="text-xs font-mono px-1 py-0.5 bg-green-900/40 text-green-400 rounded">
                      {id}
                    </span>
                  ));
                })()}
              </div>
            </>
          ) : (
            <span className="text-gray-500 text-xs font-mono">Single output (all tracks)</span>
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
    <span className="text-gray-500 text-xs w-7">{label}</span>
    <div className="flex-1 h-1.5 bg-gray-950 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-75 rounded-full`}
        style={{ width: `${Math.min(100, value * 100)}%` }}
      />
    </div>
    <span className="text-gray-400 text-xs font-mono w-6 text-right">{(value * 100).toFixed(0)}</span>
  </div>
);

// ── SplineLibraryControls ──────────────────────────────────────────────────
// Bouton sauvegarder + dropdown charger pour les nodes DrawSpline.
const SplineLibraryControls: React.FC<{ nodeId: string; currentPoints: string }> = ({
  nodeId,
  currentPoints,
}) => {
  const savedSplines = useGraphStore((s) => s.savedSplines);
  const saveSpline = useGraphStore((s) => s.saveSpline);
  const deleteSpline = useGraphStore((s) => s.deleteSpline);
  const updateNodeData = useGraphStore((s) => s.updateNodeData);
  const [showSave, setShowSave] = useState(false);
  const [splineName, setSplineName] = useState('');

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
    if (spline) {
      updateNodeData(nodeId, { params: { points: spline.points } });
    }
    e.target.value = '';
  };

  const handleDelete = (splineId: string) => {
    deleteSpline(splineId);
  };

  return (
    <div className="mt-2 pt-2 border-t border-gray-700 space-y-1.5">
      <label className="text-cyan-400 text-xs font-mono">Spline Library</label>

      {/* Charger depuis la bibliothèque */}
      {savedSplines.length > 0 && (
        <select
          onChange={handleLoad}
          defaultValue=""
          className="w-full px-2 py-1 bg-gray-900 text-cyan-300 text-xs font-mono rounded border border-gray-700 focus:border-cyan-500 focus:outline-none"
        >
          <option value="" disabled>Load a spline...</option>
          {savedSplines.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}

      {/* Liste des splines sauvegardées avec bouton delete */}
      {savedSplines.length > 0 && (
        <div className="space-y-0.5 max-h-24 overflow-y-auto">
          {savedSplines.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-xs">
              <span className="text-gray-400 font-mono truncate flex-1">{s.name}</span>
              <button
                onClick={() => handleDelete(s.id)}
                className="text-red-500 hover:text-red-400 px-1"
                title="Delete"
              ><X size={10} /></button>
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
            className="flex-1 px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-cyan-500 focus:outline-none"
          />
          <button
            onClick={handleSave}
            className="text-green-400 hover:text-green-300 text-xs px-2"
            title="Confirmer"
          ><Check size={10} /></button>
          <button
            onClick={() => setShowSave(false)}
            className="text-gray-500 hover:text-gray-400 text-xs px-2"
            title="Cancel"
          ><X size={10} /></button>
        </div>
      ) : (
        <button
          onClick={() => setShowSave(true)}
          className="w-full text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-800 hover:border-cyan-600 rounded py-1"
        >
          + Save this spline
        </button>
      )}
    </div>
  );
};

export default CustomNode;
