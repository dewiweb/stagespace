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

/// Params courbables d'une lane OBJET — vrais paramètres runtime du
/// merge (jamais dérivés d'un graphe : les nodes les lisent) :
/// - `depth` → `per_track_depth` (lu par le node PerTrackDepth ;
///   absent = 1.0)
/// - les 7 `SpatialChannel` → `object_channels` (émettés en OSC en
///   plus de la position — le « caractère spatial » de l'objet).
/// Mêmes champs que `cue.per_track_depths`/`cue.object_channels` —
/// le flatten les écrit en keyframes à l'instant du clip.
export const OBJECT_LANE_DEFS: ParamDef[] = [
  /// Trajectoire authored — écrit une manual_position au tick (les
  /// axes sans courbe gardent la position courante ; fin de courbe
  /// = hold, comme une prise de main manuelle).
  { id: 'pos.x', min: -10, max: 10, def: 0, label: 'pos x' },
  { id: 'pos.y', min: -10, max: 10, def: 0, label: 'pos y' },
  { id: 'pos.z', min: -10, max: 10, def: 0, label: 'pos z' },
  { id: 'depth', min: 0, max: 1, def: 1 },
  { id: 'gain', min: 0, max: 2, def: 1 },
  { id: 'spread', min: 0, max: 180, def: 0 },
  { id: 'distance', min: 0, max: 20, def: 0 },
  { id: 'presence', min: -24, max: 24, def: 0 },
  { id: 'yaw', min: -180, max: 180, def: 0 },
  { id: 'aperture', min: 0, max: 180, def: 0 },
  { id: 'lfe', min: 0, max: 2, def: 0 },
];

/// Blend params — côté MERGE du move (`set_move_weight`/
/// `set_move_priority`), ni graphe ni transform : `fade × weight`
/// = poids effectif dans Override/Crossfade/Blend, `priority`
/// départage la stratégie Priority. Base au spawn : 1.0 / 0.
export const MERGE_BLEND_DEFS: ParamDef[] = [
  { id: 'merge:weight', min: 0, max: 2, def: 1, label: 'weight' },
  { id: 'merge:priority', min: 0, max: 16, def: 0, label: 'priority' },
];

/// Params de la lane SPATIALFX — scalaires des tables manuelles +
/// le lissage cinématique global. `ksmooth` est statique ; les defs
/// `zone:<i>:<field>`/`mod:<key>:<field>` sont dérivées des clips
/// `zones`/`chanMods` posés (une courbe ne module qu'une contrainte
/// installée) + des clés déjà présentes dans la map (donnée orpheline
/// listée honnêtement). La courbe réécrit la DÉFINITION — jamais
/// l'influence positionnelle (évaluée par le merge).
export const SPATIALFX_STATIC_DEFS: ParamDef[] = [
  { id: 'ksmooth', min: 0, max: 0.99, def: 0.5, label: 'kinematic smoothing' },
  { id: 'spatial', min: 0.1, max: 4, def: 1, label: 'spatial compression' },
];

/// Clé stable d'une règle cinématique — même format que le backend
/// (`mod:<src>><ch>[@<obj>]` : `from_str` des deux enums). `#n` ajouté
/// côté doc si deux règles partagent le triplet.
export function modRuleKey(r: { source: string; channel: string; object: number | null }): string {
  const src = { Speed: 'speed', Acceleration: 'accel', Jerk: 'jerk', AngularSpeed: 'angvel' }[r.source] ?? r.source.toLowerCase();
  return `${src}>${r.channel.toLowerCase()}${r.object != null ? `@${r.object}` : ''}`;
}

/// Defs SPATIALFX dérivées du doc — `zone:<i>:<field>` par zone
/// installée (index positionnel), `mod:<key>:<field>` par règle, plus
/// `ksmooth` + les clés déjà courbées non couvertes.
export function spatialFxParamDefsOf(
  clips: { ref: { type: string; zones?: { effect?: unknown }[]; modulations?: { source: string; channel: string; object: number | null }[] } }[],
  curves: Record<string, unknown> | undefined,
): ParamDef[] {
  const defs = new Map<string, ParamDef>(SPATIALFX_STATIC_DEFS.map((d) => [d.id, d]));
  for (const c of clips) {
    if (c.ref.type === 'zones') {
      (c.ref.zones ?? []).forEach((z, i) => {
        defs.set(`zone:${i}:falloff`, { id: `zone:${i}:falloff`, min: 0, max: 8, def: 1, label: `zone ${i} · falloff` });
        if (z.effect != null) {
          defs.set(`zone:${i}:strength`, { id: `zone:${i}:strength`, min: 0, max: 8, def: 1, label: `zone ${i} · strength` });
        }
        defs.set(`zone:${i}:enabled`, { id: `zone:${i}:enabled`, min: 0, max: 1, def: 1, label: `zone ${i} · enabled` });
      });
    }
    if (c.ref.type === 'chanMods') {
      // Deux règles peuvent partager le même triplet (source>channel
      // [@obj]) — la 2e occurrence reçoit le suffixe `#n`, même
      // convention que le parser backend (occurrence dans la table).
      const seen = new Map<string, number>();
      for (const r of c.ref.modulations ?? []) {
        const base = modRuleKey(r);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const key = n === 0 ? base : `${base}#${n}`;
        for (const f of ['scale', 'offset', 'min', 'max'] as const) {
          defs.set(`mod:${key}:${f}`, { id: `mod:${key}:${f}`, min: f === 'scale' ? 0 : -10, max: 10, def: f === 'scale' ? 1 : 0, label: `${key} · ${f}` });
        }
      }
    }
  }
  for (const id of Object.keys(curves ?? {})) {
    if (!defs.has(id)) defs.set(id, { id, min: 0, max: 1, def: 0, label: id });
  }
  return [...defs.values()];
}

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
