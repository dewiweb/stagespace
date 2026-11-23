/// Catalogue des paramètres courbables du score — taxonomie app
/// (docs/score-sequencer.md + runtime/macros.rs §MacroScope) :
/// - TRANSFORM (clip) : transform per-move du worker — champs
///   Animation, `runtime.macros()`, courbe = override de la valeur
///   seedée du slot, ce move seulement. Pas un graphe.
/// - GLOBALFX : transform global du merge — `MergeRuntime::macros()`
///   (/stagespace/macro), toute l'output. `radius_scale`/`height_offset`
///   n'existent que là (pas de champ Animation). `phase_spread` hors
///   catalogue : assignments figés au spawn, pas hot-modifiable.
/// - MERGE blend : `set_move_weight`/`set_move_priority` — ni graphe
///   ni transform : `fade × weight` = poids effectif dans
///   Override/Crossfade/Blend, `priority` départage Priority.
import type { MoveSlot } from '../../store/slices/moveSlotsTypes';
import type { MacrosState } from '../../store/slices/macrosSlice';
import { NODE_SPECS } from '../../utils/connectionRules';
import type { GraphNode } from '../nodeParamSchema';

export interface ParamDef { id: string; min: number; max: number; def: number; label?: string; base?: number }

/// Params modulables du graphe d'un slot — les "vrais" paramètres du
/// move (radius, freq, speed de node…). Une courbe `param:<Type>:<key>`
/// est une valeur ABSOLUE évaluée backend → convertie en delta
/// `v − base` sur les ParamSlots du move (type-wide : tous les nodes
/// du type, mêmes règles que le signal compiler). `def`/`base` =
/// valeur du node dans le graphe — la ligne plate à `def` = pas de
/// modulation. Seuls les params `modulable` + `number` sont listés
/// (les structurels sont bakés au compile, pas courbables).
export function nodeParamDefsOf(nodes: GraphNode[] | undefined | null): ParamDef[] {
  const seen = new Set<string>();
  const out: ParamDef[] = [];
  for (const n of nodes ?? []) {
    const t = n.data?.type;
    const spec = t ? NODE_SPECS.find((s) => s.node_type === t) : undefined;
    if (!spec) continue;
    for (const p of spec.params) {
      if (!p.modulable || p.kind !== 'number') continue;
      const id = `param:${t}:${p.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const raw = (n.data?.params as Record<string, unknown> | undefined)?.[p.key];
      const base =
        typeof raw === 'number' && Number.isFinite(raw)
          ? raw
          : p.default_json != null
            ? Number(JSON.parse(p.default_json)) || 0
            : 0;
      out.push({
        id,
        label: `${t} · ${p.label}`,
        base,
        min: p.min ?? Math.min(0, base - Math.max(Math.abs(base), 1)),
        max: p.max ?? Math.max(base * 2, base + 1, 1),
        def: base,
      });
    }
  }
  return out;
}

export const CLIP_PARAM_DEFS: ParamDef[] = [
  { id: 'speed', min: 0, max: 4, def: 1 },
  { id: 'scale', min: 0, max: 4, def: 1 },
  { id: 'yaw', min: -180, max: 180, def: 0 },
  { id: 'pitch', min: -180, max: 180, def: 0 },
  { id: 'roll', min: -180, max: 180, def: 0 },
  { id: 'offset_x', min: -10, max: 10, def: 0 },
  { id: 'offset_y', min: -10, max: 10, def: 0 },
  { id: 'offset_z', min: -10, max: 10, def: 0 },
];
export const GLOBALFX_PARAM_DEFS: ParamDef[] = [
  { id: 'speed', min: 0, max: 4, def: 1 },
  { id: 'scale', min: 0, max: 4, def: 1 },
  { id: 'shift_x', min: -10, max: 10, def: 0 },
  { id: 'shift_y', min: -10, max: 10, def: 0 },
  { id: 'shift_z', min: -10, max: 10, def: 0 },
  { id: 'yaw', min: -180, max: 180, def: 0 },
  { id: 'pitch', min: -180, max: 180, def: 0 },
  { id: 'roll', min: -180, max: 180, def: 0 },
  { id: 'radius_scale', min: 0, max: 4, def: 1 },
  { id: 'height_offset', min: -10, max: 10, def: 0 },
];

/// Blend params — côté MERGE du move (`set_move_weight`/
/// `set_move_priority`), ni graphe ni transform : `fade × weight`
/// = poids effectif dans Override/Crossfade/Blend, `priority`
/// départage la stratégie Priority. Base au spawn : 1.0 / 0.
export const MERGE_BLEND_DEFS: ParamDef[] = [
  { id: 'merge:weight', min: 0, max: 2, def: 1, label: 'weight' },
  { id: 'merge:priority', min: 0, max: 16, def: 0, label: 'priority' },
];

/// La ligne plate d'une courbe = la VALEUR CONNUE du paramètre
/// quand le clip n'a pas de modulation — pas un défaut arbitraire.
/// - Transform per-move : `slot.macros` (seedé dans l'animation au
///   spawn — mêmes champs que l'Inspector Atelier).
/// - globalfx : l'état courant du transform global (store `macros`,
///   ce que l'opérateur voit/drive en Jeu).
export function clipParamDefsOf(slot: MoveSlot | undefined): ParamDef[] {
  const m = slot?.macros;
  if (!m) return CLIP_PARAM_DEFS;
  const def: Record<string, number> = {
    speed: m.speed, scale: m.scale,
    yaw: m.yaw, pitch: m.pitch, roll: m.roll,
    offset_x: m.shiftX, offset_y: m.shiftY, offset_z: m.shiftZ,
  };
  return CLIP_PARAM_DEFS.map((p) => ({ ...p, def: def[p.id] ?? p.def }));
}

export function globalFxParamDefsOf(m: MacrosState): ParamDef[] {
  const def: Record<string, number> = {
    speed: m.speed, scale: m.scale,
    shift_x: m.shiftX, shift_y: m.shiftY, shift_z: m.shiftZ,
    yaw: m.yaw, pitch: m.pitch, roll: m.roll,
    radius_scale: m.radius_scale, height_offset: m.height_offset,
  };
  return GLOBALFX_PARAM_DEFS.map((p) => ({ ...p, def: def[p.id] ?? p.def }));
}
