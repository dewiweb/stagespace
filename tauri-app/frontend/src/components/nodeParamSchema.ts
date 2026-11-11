import type { NodeType } from '../types/generated/NodeType';
import type { Node } from '@xyflow/react';
import { isValidConnection as isValidConnectionExported, NODE_SPECS, specOf } from '../utils/connectionRules';
import { stripFrames } from '../utils/frameNode';
import type { NodeCategory } from '../types/generated/NodeCategory';
import type { ParamSpec } from '../types/generated/ParamSpec';
import type { PluginManifest } from '../types/generated/PluginManifest';

export type ParamType = 'number' | 'boolean' | 'string' | 'vec3' | 'enum' | 'text';

/// Valeur d'un paramètre de node — union des types produits par les ParamDef
/// (number, booléen, enum/text string, vec3 ou liste d'ids en number[]…)
export type NodeParamValue = string | number | boolean | number[] | undefined;

/// Shape des `data` portées par les nodes React Flow du graphe
export interface GraphNodeData extends Record<string, unknown> {
  label?: string;
  type?: NodeType;
  params?: Record<string, NodeParamValue>;
  /// Param keys pinned for Perform mode (patcher's "Present"/GOP pattern :
  /// la surface live = sous-ensemble choisi du schema, pas le schema entier).
  /// UI-only — le parser backend n'extrait que type/params, `pinned` ne
  /// quitte jamais le frontend (persisté via le .hfg).
  pinned?: string[];
}

/// Node React Flow typé — remplace les accès `n.data.type` par
/// `n.data.type` : depuis la migration @xyflow/react, `data` est typé via
/// le paramètre générique de Node<T>.
export type GraphNode = Node<GraphNodeData>;

export interface ParamDef {
  key: string;
  label: string;
  type: ParamType;
  options?: string[];
  step?: number;
  min?: number;
  max?: number;
}

// ── Dérivés du catalogue Rust (node_spec.rs → nodeSpecs.json) ────────────────
// Le schéma de params, les catégories, le scope sub/global et les descriptions
// ne sont plus maintenus à la main ici — `npm run contracts` régénère tout.
// La dérive catalogue↔UI était la cause des bugs Scale/Rotate/Mirror de T2.

function specToParamDef(p: ParamSpec): ParamDef {
  return {
    key: p.key,
    label: p.label,
    type: p.kind as ParamType,
    options: p.options ?? undefined,
    step: p.step ?? undefined,
    min: p.min ?? undefined,
    max: p.max ?? undefined,
  };
}

export const PARAM_SCHEMA: Record<NodeType, ParamDef[]> = Object.fromEntries(
  NODE_SPECS.map((s) => [s.node_type, s.params.map(specToParamDef)]),
) as Record<NodeType, ParamDef[]>;

/// Ordre + habillage des catégories de palette — cosmétique UI ; la liste des
/// types vient du catalogue (un node sans spec n'apparaît nulle part).
const CATEGORY_META: { category: NodeCategory; label: string; color: string }[] = [
  { category: 'Structural', label: 'Structural', color: 'gray' },
  { category: 'MathEngine', label: 'Math Engines', color: 'blue' },
  { category: 'PhysicsEngine', label: 'Physics Engines', color: 'green' },
  { category: 'Spline', label: 'Splines', color: 'cyan' },
  { category: 'Envelope', label: 'Envelopes', color: 'orange' },
  { category: 'Modifier', label: 'Modifiers', color: 'pink' },
  { category: 'PostProcess', label: 'Global (Post-process)', color: 'cyan' },
  { category: 'Composite', label: 'Composite', color: 'purple' },
  { category: 'Source', label: 'Sources', color: 'yellow' },
  { category: 'Plugin', label: 'Plugins', color: 'yellow' },
  { category: 'Signal', label: 'Signal (Modulation)', color: 'amber' },
];

export const NODE_CATEGORIES: { label: string; color: string; types: NodeType[] }[] =
  CATEGORY_META.map(({ category, label, color }) => ({
    label,
    color,
    types: NODE_SPECS.filter((s) => s.category === category).map((s) => s.node_type),
  })).filter((c) => c.types.length > 0);

/// Nodes exclus du sub-graph (global-only) — dérivé de NodeSpec.scope.
export const GLOBAL_ONLY_NODES: Set<NodeType> = new Set(
  NODE_SPECS.filter((s) => s.scope === 'GlobalOnly').map((s) => s.node_type),
);

/// Nodes exclus du global graph (sub-graph-only) — dérivé de NodeSpec.scope.
export const SUB_ONLY_NODES: Set<NodeType> = new Set(
  NODE_SPECS.filter((s) => s.scope === 'SubOnly').map((s) => s.node_type),
);

/// Nodes du domaine signal (graph de modulation) — scope dédié : ils ne
/// vivent que dans le tab Mods/Signal et sont cachés des tabs move/global.
export const SIGNAL_ONLY_NODES: Set<NodeType> = new Set(
  NODE_SPECS.filter((s) => s.scope === 'SignalOnly').map((s) => s.node_type),
);

export const NODE_COLORS: Record<string, string> = {
  gray: '#4b5563',
  blue: '#2563eb',
  green: '#16a34a',
  purple: '#9333ea',
  yellow: '#ca8a04',
  orange: '#ea580c',
  cyan: '#0891b2',
  pink: '#db2777',
  amber: '#f59e0b',
};

const CATEGORY_COLOR: Record<NodeCategory, string> = Object.fromEntries(
  CATEGORY_META.map((m) => [m.category, m.color]),
) as Record<NodeCategory, string>;

export function getCategoryColor(type: NodeType): string {
  return NODE_COLORS[CATEGORY_COLOR[specOf(type).category]] ?? '#4b5563';
}

/// Défaut de création d'un param — `default_json` du spec (parsé), sinon
/// fallback par type.
function defaultForParam(p: ParamSpec): unknown {
  if (p.default_json != null) return JSON.parse(p.default_json);
  switch (p.kind) {
    case 'number':
      return p.min ?? 0;
    case 'boolean':
      return false;
    case 'enum':
      return p.options?.[0] ?? '';
    case 'vec3':
      return [0, 0, 0];
    case 'text':
    case 'string':
      return '';
  }
}

export function getDefaultParams(type: NodeType): Record<string, any> {
  const params: Record<string, any> = {};
  for (const p of specOf(type).params) {
    params[p.key] = defaultForParam(p);
  }
  return params;
}

/**
 * Descriptions courtes pour chaque node — affichées dans la palette et au hover.
 * Source : `NodeSpec.description` du catalogue Rust.
 */
export const NODE_DESCRIPTIONS: Partial<Record<NodeType, string>> = Object.fromEntries(
  NODE_SPECS.map((s) => [s.node_type, s.description]),
);

/**
 * Retourne les types de nodes valides comme cible depuis un type source donné.
 * Utilisé pour le highlight visuel des connexions possibles au drag.
 */
export function getValidTargetTypes(from: NodeType): NodeType[] {
  const allTypes: NodeType[] = NODE_SPECS.map((s) => s.node_type);
  // Pas de filtre `to !== from` aveugle : Scale→Scale est une connexion
  // valide (modifier en chaîne) — la validité appartient à isValidConnection.
  return allTypes.filter((to) => isValidConnectionExported(from, to));
}

/**
 * Fusionne les params par défaut avec les params actuels d'un node.
 * Garantit que tous les params du schema sont présents, même si non-modifiés.
 * Utilisé avant la sauvegarde d'un cue pour éviter les valeurs manquantes.
 */
export function mergeDefaultParams(type: NodeType, currentParams: Record<string, any>): Record<string, any> {
  const defaults = getDefaultParams(type);
  return { ...defaults, ...currentParams };
}

/**
 * Prépare un graphe (nodes + edges) pour la sauvegarde :
 * fusionne les params par défaut dans chaque node.
 * Les frames (annotation UI-only) sont filtrés — le NodeType Rust est
 * un enum fermé, 'Frame' ferait échouer la désérialisation.
 */
export function prepareGraphForSave(nodes: any[], edges: any[]) {
  const { nodes: kept, edges: keptEdges } = stripFrames(nodes, edges);
  return {
    nodes: kept.map((n) => ({
      ...n,
      data: {
        ...n.data,
        params: mergeDefaultParams(n.data?.type, n.data?.params ?? {}),
      },
    })),
    edges: [...keptEdges],
  };
}

/// Types de nodes "engine" — prioritaires pour la sélection par défaut
/// du chip de params (NodeParamsPanel : Perform drawer + Inspector Edit).
/// Dérivé : engines, splines, composites et plugins.
export const ENGINE_TYPES = new Set<NodeType>(
  NODE_SPECS.filter((s) =>
    ['MathEngine', 'PhysicsEngine', 'Spline', 'Composite', 'Plugin'].includes(s.category),
  ).map((s) => s.node_type),
);

/// Nodes qui ont leur propre surface dédiée — exclus des chips de params
/// (évite les doublons de contrôle : n_objects → Tracks, duration → Lecture).
/// Dérivé : les nodes structurels du sub-graph (Input/MoveRef/Merge sont
/// global-only et n'ont pas de panneau dédié côté move).
export const NON_PARAM_NODES = new Set<NodeType>(
  NODE_SPECS.filter(
    (s) => s.category === 'Structural' && s.scope !== 'GlobalOnly',
  ).map((s) => s.node_type),
);

// ── Plugins WASM ────────────────────────────────────────────────────────────

/// Params dynamiques d'un plugin — `params[]` du manifeste mappé vers
/// `ParamDef` (mêmes types : number/boolean/enum/vec3/text/string, rendus
/// génériquement par NodeParamField et les inputs inline de CustomNode).
export function pluginParamDefs(manifest: PluginManifest | null | undefined): ParamDef[] {
  if (!manifest) return [];
  return manifest.params.map((p) => ({
    key: p.key,
    label: p.label ?? p.key,
    type: p.type as ParamType,
    options: p.options ?? undefined,
    min: p.min ?? undefined,
    max: p.max ?? undefined,
    step: p.step ?? undefined,
  }));
}

/// Schema complet d'un node Plugin : `plugin_id` en select (ids du
/// registry) + params du manifeste résolu. Un `plugin_id` pointant vers un
/// plugin désinstallé reste dans les options — un show `.hfg` peut
/// référencer un plugin absent, il faut pouvoir voir/conserver sa valeur.
/// Sans aucun plugin chargé ni id → fallback texte libre.
export function pluginNodeSchema(
  params: Record<string, NodeParamValue> | undefined,
  manifests: PluginManifest[],
): ParamDef[] {
  const pid = params?.plugin_id;
  const manifest = typeof pid === 'string' ? manifests.find((m) => m.id === pid) : undefined;
  const options = manifests.map((m) => m.id);
  if (typeof pid === 'string' && !options.includes(pid)) options.unshift(pid);
  const idField: ParamDef =
    options.length > 0
      ? { key: 'plugin_id', label: 'Plugin', type: 'enum', options }
      : { key: 'plugin_id', label: 'Plugin ID', type: 'text' };
  return [idField, ...pluginParamDefs(manifest)];
}

/// Params initiaux d'un node Plugin créé depuis la palette : plugin_id +
/// defaults déclarés par le manifeste.
export function pluginDefaultParams(manifest: PluginManifest): Record<string, NodeParamValue> {
  const params: Record<string, NodeParamValue> = { plugin_id: manifest.id };
  for (const p of manifest.params) {
    params[p.key] = (p.default ?? undefined) as NodeParamValue;
  }
  return params;
}

/// Switch de plugin sur un node existant : backfill des defaults du
/// nouveau manifeste pour les clés absentes. Les params déjà saisis sont
/// préservés (les clés propres à l'ancien plugin restent — ignorées par
/// le host qui ne lit que ses clés déclarées).
export function pluginParamsOnSwitch(
  manifest: PluginManifest | undefined,
  existing: Record<string, NodeParamValue>,
): Record<string, NodeParamValue> {
  if (!manifest) return existing;
  const params = { ...existing };
  for (const p of manifest.params) {
    if (params[p.key] === undefined) {
      params[p.key] = (p.default ?? undefined) as NodeParamValue;
    }
  }
  return params;
}
