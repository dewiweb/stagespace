import React from 'react';
import { Pin } from 'lucide-react';
import { Slider } from './ui/Slider';
import { PARAM_SCHEMA, ENGINE_TYPES, NON_PARAM_NODES, pluginNodeSchema, pluginParamsOnSwitch, type NodeParamValue, type GraphNodeData, type ParamDef } from './nodeParamSchema';
import { useGraphStore } from '../store/useGraphStore';
import type { NodeType } from '../store/types/index';
import type { Node } from 'reactflow';

/**
 * Panneau de params d'un graphe : chips de nodes paramétrables + grille de
 * champs du node choisi. Partagé entre Perform (drawer Params) et
 * l'Inspector Edit — même mécanique, même rendu.
 *
 * `resetKey` : change de valeur → la sélection de chip retombe sur le node
 * engine par défaut (ex. changement de slot édité).
 *
 * `performMode` (drawer Params de Perform) : si le node a des params épinglés
 * (`data.pinned`), seuls ceux-là sont affichés — pattern "Present" des
 * patchers (plugdata/Pd GOP) : la surface live est un sous-ensemble choisi.
 * Sans pin → tous les params restent accessibles (édition live à la demande).
 * En mode édition, chaque champ a un toggle pin 📌 qui alimente `pinned`.
 */
export const NodeParamsPanel: React.FC<{
  nodes: Node[];
  live: boolean;
  resetKey?: string | null;
  performMode?: boolean;
  onParam: (nodeId: string, key: string, value: NodeParamValue, params: Record<string, NodeParamValue>) => void;
  emptyHint?: React.ReactNode;
}> = ({ nodes, live, resetKey, performMode, onParam, emptyHint }) => {
  // Nodes paramétrables du graphe — chacun devient un chip.
  const paramNodes = React.useMemo(
    () =>
      nodes.filter((n) => {
        const t = (n.data as GraphNodeData)?.type;
        return !!t && !NON_PARAM_NODES.has(t) && (PARAM_SCHEMA[t]?.length ?? 0) > 0;
      }),
    [nodes],
  );
  const [paramNodeId, setParamNodeId] = React.useState<string | null>(null);
  // Défaut : le premier node engine — sinon le premier node paramétrable.
  const defaultParamNode = React.useMemo(
    () => paramNodes.find((n) => {
      const t = (n.data as GraphNodeData)?.type;
      return !!t && ENGINE_TYPES.has(t);
    }) ?? paramNodes[0] ?? null,
    [paramNodes],
  );
  React.useEffect(() => { setParamNodeId(null); }, [resetKey]);
  const paramNode = paramNodes.find((n) => n.id === paramNodeId) ?? defaultParamNode;
  const paramNodeType = (paramNode?.data as GraphNodeData | undefined)?.type as NodeType | undefined;
  const paramNodeParams = ((paramNode?.data as GraphNodeData | undefined)?.params ?? {}) as Record<string, NodeParamValue>;
  // Plugin : schema = plugin_id statique + params du manifeste résolu
  // (registry backend via le store) — rien d'autre à toucher, NodeParamField
  // rend les types du manifeste génériquement.
  const plugins = useGraphStore((s) => s.plugins);
  const pluginsLoaded = useGraphStore((s) => s.pluginsLoaded);
  const paramSchema = paramNodeType === 'Plugin'
    ? pluginNodeSchema(paramNodeParams, plugins)
    : (paramNodeType ? PARAM_SCHEMA[paramNodeType] ?? [] : []);
  // Pin-to-Perform : `pinned` vit dans node.data (UI-only, persisté .hfg).
  // Le toggle passe par updateNodeData — merge profond sur params inchangé
  // car `pinned` est un champ data à part entière (pas une clé de params).
  const updateNodeData = useGraphStore((s) => s.updateNodeData);
  const pinned = ((paramNode?.data as GraphNodeData | undefined)?.pinned ?? []) as string[];
  const pinnedSet = React.useMemo(() => new Set(pinned), [pinned]);
  const visibleSchema = performMode && pinned.length > 0
    ? paramSchema.filter((d) => pinnedSet.has(d.key))
    : paramSchema;
  const togglePin = (key: string) => {
    if (!paramNode) return;
    const next = pinned.includes(key) ? pinned.filter((k) => k !== key) : [...pinned, key];
    updateNodeData(paramNode.id, { pinned: next.length > 0 ? next : undefined });
  };
  // Plugin désinstallé : warning persistant (pas un toast éphémère).
  // plugin_id vide = non configuré, pas cassé.
  const selectedPid = paramNodeParams.plugin_id;
  const pluginMissing = paramNodeType === 'Plugin' && pluginsLoaded
    && typeof selectedPid === 'string' && selectedPid.length > 0
    && !plugins.some((m) => m.id === selectedPid);
  const pluginUnset = paramNodeType === 'Plugin' && pluginsLoaded
    && !(typeof selectedPid === 'string' && selectedPid.length > 0);

  if (paramNodes.length === 0 || !paramNode) {
    return (
      <div className="text-gray-600 text-[10px] py-1">
        {emptyHint ?? 'No parametric node in this graph.'}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Chips de nodes — tap = éditer les params de CE node */}
      <div className="flex flex-wrap gap-1 pb-1">
        {paramNodes.map((n, i) => {
          const t = (n.data as GraphNodeData)?.type ?? '?';
          // Plugin : le chip affiche le nom du manifeste, pas le type
          // conteneur ; ⚠ si le plugin n'est plus chargé dans le registry.
          const pid = (n.data as GraphNodeData)?.params?.plugin_id;
          const manifest = t === 'Plugin' && typeof pid === 'string'
            ? plugins.find((m) => m.id === pid)
            : undefined;
          const chipLabel = t === 'Plugin' && typeof pid === 'string'
            ? (manifest?.name ?? pid)
            : t;
          const chipMissing = t === 'Plugin' && pluginsLoaded
            && typeof pid === 'string' && pid.length > 0 && !manifest;
          // Indice d'occurrence si plusieurs nodes du même label affiché
          const sameLabel = paramNodes.filter((o) => {
            const ot = (o.data as GraphNodeData)?.type ?? '?';
            const opid = (o.data as GraphNodeData)?.params?.plugin_id;
            return ot === 'Plugin' && typeof opid === 'string'
              ? (plugins.find((m) => m.id === opid)?.name ?? opid) === chipLabel
              : ot === chipLabel;
          });
          const occ = sameLabel.length > 1 ? sameLabel.indexOf(n) + 1 : 0;
          const active = paramNode.id === n.id;
          const nodeHasPins = (((n.data as GraphNodeData)?.pinned) ?? []).length > 0;
          return (
            <button
              key={n.id}
              onClick={() => setParamNodeId(n.id)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors inline-flex items-center gap-1 ${
                active
                  ? 'bg-cyan-700 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
              }`}
              title={`Node ${i + 1} — params`}
            >
              {nodeHasPins && <Pin size={8} className="text-cyan-400 flex-shrink-0" />}
              {chipLabel}{occ > 0 ? ` ${occ}` : ''}{chipMissing ? ' ⚠' : ''}
            </button>
          );
        })}
      </div>
      {performMode && pinned.length > 0 && (
        <div className="text-cyan-500/80 text-[9px] font-mono">
          {visibleSchema.length} pinned parameter{visibleSchema.length > 1 ? 's' : ''} — pin/unpin in Edit mode
        </div>
      )}
      <div
        className="grid gap-x-4 gap-y-2.5"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))' }}
      >
        {visibleSchema.map((d) => {
          const field = (
            <NodeParamField
              def={d}
              value={paramNodeParams[d.key]}
              live={live}
              onChange={(v) => {
                // Switch de plugin : backfill des defaults du nouveau
                // manifeste dans les params propagés au store.
                let base = paramNodeParams;
                if (paramNodeType === 'Plugin' && d.key === 'plugin_id' && typeof v === 'string') {
                  base = pluginParamsOnSwitch(plugins.find((m) => m.id === v), base);
                }
                onParam(paramNode.id, d.key, v, base);
              }}
            />
          );
          // Mode Perform : pas de toggle pin — la surface est curatée ailleurs.
          if (performMode) return <React.Fragment key={d.key}>{field}</React.Fragment>;
          return (
            <div key={d.key} className="flex items-start gap-1">
              <button
                onClick={() => togglePin(d.key)}
                className={`mt-1.5 flex-shrink-0 transition-colors ${
                  pinnedSet.has(d.key)
                    ? 'text-cyan-400 hover:text-cyan-300'
                    : 'text-gray-500 hover:text-gray-500'
                }`}
                title={pinnedSet.has(d.key)
                  ? 'Unpin — remove from Perform surface'
                  : 'Pin to Perform — show in the Perform params drawer'}
              >
                <Pin size={10} />
              </button>
              <div className="flex-1 min-w-0">{field}</div>
            </div>
          );
        })}
      </div>
      {performMode && pinned.length > 0 && visibleSchema.length === 0 && (
        <div className="text-gray-600 text-[10px]">
          Pinned parameters no longer exist on this node — unpin them in Edit mode.
        </div>
      )}
      {pluginMissing && (
        <div className="text-red-400/90 text-[10px] font-mono pt-1">
          ⚠ Plugin '{selectedPid as string}' not loaded — install the .ssx or pick another plugin.
        </div>
      )}
      {pluginUnset && (
        <div className="text-gray-500 text-[10px] font-mono pt-1">
          No plugin selected — pick plugin_id above or import a .ssx.
        </div>
      )}
    </div>
  );
};

/// Champ de paramètre de node : sliders bornés pour les numbers, toggle
/// pour boolean, select pour enum, input compact pour le reste. `live`
/// colore le slider quand le move tourne (hot-swap actif).
export const NodeParamField: React.FC<{
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
            layout="stack"
            live={live}
            onChange={onChange}
          />
        );
      }
      return (
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-[10px] w-20 flex-shrink-0 truncate" title={def.label}>{def.label}</span>
          <input
            type="number"
            step={def.step ?? 0.1}
            min={def.min}
            max={def.max}
            value={typeof value === 'number' ? value : 0}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            className="flex-1 min-w-0 px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-cyan-500 focus:outline-none"
          />
        </div>
      );
    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-[10px] w-20 flex-shrink-0 truncate" title={def.label}>{def.label}</span>
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
          <span className="text-gray-400 text-[10px] w-20 flex-shrink-0 truncate" title={def.label}>{def.label}</span>
          <select
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-cyan-500 focus:outline-none"
          >
            {def.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
      );
    case 'vec3': {
      const arr = Array.isArray(value) ? value : [0, 0, 0];
      return (
        <div className="flex items-center gap-2 col-span-2">
          <span className="text-gray-400 text-[10px] w-20 flex-shrink-0 truncate" title={def.label}>{def.label}</span>
          <input
            type="text"
            value={arr.join(', ')}
            onChange={(e) => {
              const parsed = e.target.value.split(',').map((v) => parseFloat(v.trim()));
              if (parsed.length === 3 && parsed.every((n) => !isNaN(n))) onChange(parsed);
            }}
            className="flex-1 min-w-0 px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-cyan-500 focus:outline-none font-mono"
            placeholder="x, y, z"
          />
        </div>
      );
    }
    case 'text':
    case 'string':
      return (
        <div className="flex items-center gap-2 col-span-2">
          <span className="text-gray-400 text-[10px] w-20 flex-shrink-0 truncate" title={def.label}>{def.label}</span>
          <input
            type="text"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-cyan-500 focus:outline-none font-mono"
          />
        </div>
      );
    default:
      return null;
  }
};

export default NodeParamsPanel;
