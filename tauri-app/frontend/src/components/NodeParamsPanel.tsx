import React from 'react';
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
 */
export const NodeParamsPanel: React.FC<{
  nodes: Node[];
  live: boolean;
  resetKey?: string | null;
  onParam: (nodeId: string, key: string, value: NodeParamValue, params: Record<string, NodeParamValue>) => void;
  emptyHint?: React.ReactNode;
}> = ({ nodes, live, resetKey, onParam, emptyHint }) => {
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
    () => paramNodes.find((n) => ENGINE_TYPES.has((n.data as GraphNodeData)?.type ?? '')) ?? paramNodes[0] ?? null,
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
  // Plugin désinstallé : warning persistant (pas un toast éphémère).
  const selectedPid = paramNodeParams.plugin_id;
  const pluginMissing = paramNodeType === 'Plugin' && pluginsLoaded
    && !(typeof selectedPid === 'string' && plugins.some((m) => m.id === selectedPid));

  if (paramNodes.length === 0 || !paramNode) {
    return (
      <div className="text-gray-600 text-[10px] py-1">
        {emptyHint ?? 'Aucun node paramétrable dans ce graphe.'}
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
          const chipMissing = t === 'Plugin' && pluginsLoaded && !manifest;
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
              {chipLabel}{occ > 0 ? ` ${occ}` : ''}{chipMissing ? ' ⚠' : ''}
            </button>
          );
        })}
      </div>
      <div
        className="grid gap-x-4 gap-y-2.5"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))' }}
      >
        {paramSchema.map((d) => (
          <NodeParamField
            key={d.key}
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
        ))}
      </div>
      {pluginMissing && (
        <div className="text-red-400/90 text-[10px] font-mono pt-1">
          ⚠ Plugin '{typeof selectedPid === 'string' && selectedPid ? selectedPid : '?'}' non chargé — installez le .ssx ou choisissez un autre plugin.
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
