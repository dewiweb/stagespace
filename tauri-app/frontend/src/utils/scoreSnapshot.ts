/// Re-capture arrangement→cue : évalue l'ÉTAT de la partition à un
/// instant t et le matérialise en `StoreScoreCueRequest` (docs/
/// score-sequencer.md). Inverse exact de `scoreFlatten` — les clips
/// slot couvrant t redeviennent des `MoveSnapshot`, les courbes sont
/// échantillonnées à t, les tables zones/mods sont les dernières
/// installées patchées par leurs courbes spatialfx.
///
/// Sémantique respectée : lanes mutées ignorées, exclusive = dernier
/// clip qui couvre gagne la lane entière (son move survit), stacked =
/// coexistence, couverture suivie résolue via `effectiveTrackIds`.
/// Ce qui n'est pas un état (événements conductor, cues imbriquées,
/// courbes clip-scoped) est rapporté dans `skipped` — jamais perdu
/// silencieusement.
import { useScoreStore, GLOBALFX_LANE, laneIdOf, type ScoreClipDoc, type ScoreKeyframe } from '../store/useScoreStore';
import { useGraphStore } from '../store/useGraphStore';
import { effectiveTrackIds } from './scoreResolve';
import { sampleKfs } from './scoreCurveMath';
import { buildSlotActivation, type SlotActivationCtx, type SlotGlobalMacros } from './slotActivation';
import type { StoreScoreCueRequest } from '../types/generated/StoreScoreCueRequest';
import type { MoveSnapshot } from '../types/generated/MoveSnapshot';
import type { ChannelModulation } from '../types/generated/ChannelModulation';
import type { Zone } from '../types/generated/Zone';
import type { SpatialChannels } from '../types/generated/SpatialChannels';

export interface ScoreSnapshotResult {
  request: StoreScoreCueRequest;
  /// Catégories non snapshotables — restituées à l'opérateur.
  skipped: string[];
}

/// Instant de départ effectif d'un clip à t (itération repeat incluse).
/// `undefined` = pas encore tiré.
function effectiveStart(c: ScoreClipDoc, t: number): number | undefined {
  if (c.startMs > t) return undefined;
  if (c.repeatEveryMs && c.durationMs) {
    const k = Math.floor((t - c.startMs) / c.repeatEveryMs);
    for (let i = k; i >= 0; i--) {
      const s = c.startMs + i * c.repeatEveryMs;
      if (t < s + c.durationMs) return s;
      if (s + c.repeatEveryMs <= t && i < k) break;
    }
    return undefined;
  }
  // Clip non-repeat : actif tant qu'aucune fenêtre n'est passée.
  if (c.durationMs !== undefined && t >= c.startMs + c.durationMs) return undefined;
  return c.startMs;
}

/// Dernier clip `type` tiré ≤ t (les marqueurs/événements sont
/// instantanés — seule leur position compte).
function lastFired(clips: ScoreClipDoc[], types: ScoreClipDoc['ref']['type'][], t: number): ScoreClipDoc | undefined {
  let best: ScoreClipDoc | undefined;
  for (const c of clips) {
    if (!types.includes(c.ref.type) || c.startMs > t) continue;
    if (!best || c.startMs > best.startMs) best = c;
  }
  return best;
}

/// Évalue la partition à `tMs` → request `store_score_cue`.
/// `ctx` = mapping courant (holProject/manualOscIds) — même contexte
/// que la résolution des clips.
export async function snapshotScoreAt(
  tMs: number,
  ctx: SlotActivationCtx,
): Promise<ScoreSnapshotResult> {
  const doc = useScoreStore.getState();
  const gs = useGraphStore.getState();
  const osc = ctx.manualOscIds;
  const skipped: string[] = [];
  const laneState = (id: string) => doc.laneStates?.[id];
  const muted = (id: string) => laneState(id)?.muted === true;
  const stackedLane = (id: string) => laneState(id)?.mode === 'stacked';
  const t = tMs;

  // ── Moves : clips slot actifs à t, gagnants de leurs lanes ──
  const active = doc.clips
    .filter((c) => c.ref.type === 'slot')
    .map((c) => ({ c, s: effectiveStart(c, t) }))
    .filter((e): e is { c: ScoreClipDoc; s: number } => e.s !== undefined)
    .sort((a, b) => a.s - b.s);
  // Lane exclusive : le clip le plus tardif qui la couvre tue les
  // moves des clips plus anciens qui la couvrent aussi (même
  // sémantique que le scheduler — lane_active est une liste ≤1).
  const survives = (e: { c: ScoreClipDoc; s: number }): boolean => {
    for (const tid of effectiveTrackIds(e.c)) {
      const lane = laneIdOf(tid);
      if (muted(lane) || stackedLane(lane)) continue;
      for (const o of active) {
        if (o === e || o.s <= e.s) continue;
        if (effectiveTrackIds(o.c).includes(tid)) return false;
      }
    }
    return true;
  };
  const survivors = active.filter(survives);
  const moves: MoveSnapshot[] = [];
  let unionTracks: number[] = [];
  let skippedClips = 0;
  /// Macros du DERNIER clip slot survivant tiré — elles sont appliquées
  /// au merge global au lancement du clip (même source que le payload
  /// wire), donc l'état à t est celui du plus récent.
  let lastMacros: SlotGlobalMacros | undefined;
  for (const { c } of survivors) {
    if (c.ref.type !== 'slot') continue;
    const slot = gs.moveSlots.find((s) => s.id === (c.ref as { slotId: string }).slotId);
    if (!slot || !slot.graphJson) {
      skippedClips++;
      continue;
    }
    // Couverture restreinte aux lanes non mutées (le scheduler saute
    // les tracks mutées — un clip entièrement muté ne spawn rien).
    const unmutedTids = effectiveTrackIds(c).filter((tid) => !muted(laneIdOf(tid)));
    if (unmutedTids.length === 0) continue;
    const act = await buildSlotActivation(
      { ...slot, trackIds: unmutedTids },
      slot.graphJson,
      ctx,
      `sc-${c.id}`,
    );
    lastMacros = act.globalMacros;
    const req = act.request as Record<string, unknown>;
    const animation = (req.animation ?? {}) as Record<string, unknown>;
    moves.push({
      id: `sc-${c.id}`,
      name: slot.name,
      graph_json: req.graph_json as MoveSnapshot['graph_json'],
      signal_graph: (animation.signal_graph ?? null) as MoveSnapshot['signal_graph'],
      osc_ids: (req.osc_ids ?? []) as number[],
      track_indices: (req.track_indices ?? []) as number[],
      is_preview: (req.is_preview ?? false) as boolean,
      origin: (req.origin ?? null) as [number, number, number] | null,
      duration: (req.duration ?? 4) as number,
      loop_mode: (req.loop_mode ?? 'loop') as string,
      direction: (req.direction ?? 'forward') as string,
      animation_state: null,
      fade_in: c.fadeInMs !== undefined ? c.fadeInMs / 1000 : slot.fadeIn,
      fade_out: c.fadeOutMs !== undefined ? c.fadeOutMs / 1000 : slot.fadeOut,
      end_mode: (req.end_mode ?? null) as MoveSnapshot['end_mode'],
      anchor_mode: (req.anchor_mode ?? null) as MoveSnapshot['anchor_mode'],
      anchor_target: (req.anchor_target ?? null) as number | null,
    });
    unionTracks = [...new Set([...unionTracks, ...((req.track_indices ?? []) as number[])])];
  }
  if (skippedClips) skipped.push(`${skippedClips} clip(s) slot orphelin(s)`);

  // ── Positions manuelles (obj_index) : dernier clip `positions`,
  //    puis les courbes pos.* par lane non mutée ──
  const manual: Record<number, [number, number, number]> = {};
  const posClip = lastFired(doc.clips, ['positions'], t);
  if (posClip?.ref.type === 'positions' && !muted(GLOBALFX_LANE)) {
    for (const [tid, p] of Object.entries(posClip.ref.positions)) {
      const obj = osc.indexOf(Number(tid));
      if (obj >= 0) manual[obj] = [...p] as [number, number, number];
    }
  }
  const CHANNEL_FIELDS = ['gain', 'spread', 'distance', 'presence', 'yaw', 'aperture', 'lfe'] as const;
  const objectChannels: Record<number, SpatialChannels> = {};
  /// Dense Vec<f64> côté backend — trous remplis à 1.0 (défaut recall).
  const depthSparse: number[] = [];
  let depthTouched = false;
  for (const [laneId, params] of Object.entries(doc.objectCurves ?? {})) {
    if (muted(laneId)) continue;
    const tid = Number(laneId.replace(/^obj-/, ''));
    const obj = osc.indexOf(tid);
    if (obj < 0) continue;
    for (const [param, kfs] of Object.entries(params)) {
      const v = sampleKfs(kfs as ScoreKeyframe[], t);
      if (v === undefined) continue;
      if (param === 'depth') {
        depthSparse[obj] = v;
        depthTouched = true;
      } else if (param.startsWith('pos.')) {
        const axis = { 'pos.x': 0, 'pos.y': 1, 'pos.z': 2 }[param] as number | undefined;
        if (axis !== undefined) {
          const cur = manual[obj] ?? [0, 0, 0];
          cur[axis] = v;
          manual[obj] = cur as [number, number, number];
        }
      } else if ((CHANNEL_FIELDS as readonly string[]).includes(param)) {
        const ch = (objectChannels[obj] ??= {
          gain: null, spread: null, distance: null, presence: null,
          yaw: null, aperture: null, lfe: null,
        });
        (ch as unknown as Record<string, number>)[param] = v;
      }
    }
  }

  // ── Tables zones / chanMods : dernier clip porteur + patch des
  //    courbes spatialfx à t (miroir de eval_spatial_fx_param) ──
  const zonesClip = lastFired(doc.clips, ['zones'], t);
  const zones: Zone[] | null = zonesClip?.ref.type === 'zones' ? structuredClone(zonesClip.ref.zones) : null;
  const modsClip = lastFired(doc.clips, ['chanMods'], t);
  const mods: ChannelModulation[] | null =
    modsClip?.ref.type === 'chanMods' ? structuredClone(modsClip.ref.modulations) : null;
  if (!muted('spatialfx')) {
    for (const [param, kfs] of Object.entries(doc.spatialFxCurves ?? {})) {
      const v = sampleKfs(kfs, t);
      if (v === undefined) continue;
      if (param === 'ksmooth' || param === 'spatial') {
        if (param === 'spatial') skipped.push('compresseur spatial (pas un champ de cue)');
        continue;
      }
      const zp = param.match(/^zone:(\d+):(\w+)$/);
      if (zp && zones) {
        const z = zones[Number(zp[1])];
        if (z) {
          if (zp[2] === 'falloff') z.falloff = Math.max(0, v);
          else if (zp[2] === 'enabled') z.enabled = v >= 0.5;
          else if (zp[2] === 'strength' && z.effect) {
            (z.effect as { strength: number }).strength = v;
          }
        }
        continue;
      }
      const mp = param.match(/^mod:([^@#]+)>([^@#]+)(?:@(\d+))?(?:#(\d+))?:(\w+)$/);
      if (mp && mods) {
        const [, src, ch, objS, occS, field] = mp;
        const obj = objS !== undefined ? Number(objS) : null;
        const occ = occS !== undefined ? Number(occS) : 0;
        let seen = 0;
        for (const r of mods) {
          if (r.source.toLowerCase() === src && r.channel.toLowerCase() === ch && r.object === obj) {
            if (seen++ === occ) {
              if (field === 'scale') r.scale = v;
              else if (field === 'offset') r.offset = v;
              else if (field === 'min') r.min = v;
              else if (field === 'max') r.max = v;
              break;
            }
          }
        }
      }
    }
  }

  // ── Graphs globaux : derniers porteurs ──
  const postClip = lastFired(doc.clips, ['postGraph'], t);
  const modClip = lastFired(doc.clips, ['modGraph'], t);

  // ── Macros : dernières macros de slot appliquées + courbes GLOBALFX ──
  let macros: StoreScoreCueRequest['macros'] = lastMacros
    ? {
        speed: 1, scale: lastMacros.scale,
        shift_x: lastMacros.shiftX, shift_y: lastMacros.shiftY, shift_z: lastMacros.shiftZ,
        yaw: lastMacros.yaw, pitch: lastMacros.pitch, roll: lastMacros.roll,
      }
    : null;
  let spatialMacros: StoreScoreCueRequest['spatial_macros'] = null;
  if (!muted(GLOBALFX_LANE)) {
    const fields: [string, keyof NonNullable<typeof macros>][] = [
      ['speed', 'speed'], ['scale', 'scale'],
      ['shift_x', 'shift_x'], ['shift_y', 'shift_y'], ['shift_z', 'shift_z'],
      ['yaw', 'yaw'], ['pitch', 'pitch'], ['roll', 'roll'],
    ];
    let touched = false;
    for (const [param, field] of fields) {
      const v = sampleKfs(doc.globalFxCurves?.[param], t);
      if (v === undefined) continue;
      if (!macros) {
        macros = { speed: 1, scale: 1, shift_x: 0, shift_y: 0, shift_z: 0, yaw: 0, pitch: 0, roll: 0 };
      }
      macros[field] = v;
      touched = true;
    }
    const rs = sampleKfs(doc.globalFxCurves?.['radius_scale'], t);
    const ho = sampleKfs(doc.globalFxCurves?.['height_offset'], t);
    if (rs !== undefined || ho !== undefined) {
      spatialMacros = { radius_scale: rs ?? 1.0, height_offset: ho ?? 0.0 };
      touched = true;
    }
    void touched;
  }

  // ── Honnêteté : événements conductor et cues ne sont pas un état ──
  const conductorEvents = doc.clips.filter(
    (c) => c.startMs <= t && ['gesture', 'throw', 'park', 'unpark', 'attention', 'stopAll', 'panic', 'osc'].includes(c.ref.type),
  ).length;
  if (conductorEvents) skipped.push(`${conductorEvents} événement(s) conductor (pas un état)`);
  if (doc.clips.some((c) => c.ref.type === 'cue' && c.startMs <= t)) skipped.push('clips cue (non résolus — un snapshot ne contient pas de cue)');
  if (doc.clips.some((c) => c.curves && Object.keys(c.curves).length)) skipped.push('courbes clip-scoped (per-move — le cue recrée le seed du slot)');
  if (Object.keys(doc.modulationCurves ?? {}).length) skipped.push('courbes modulation (valeurs SignalOsc — pas un champ de cue)');

  return {
    request: {
      name: '',
      description: '',
      moves,
      macros,
      spatial_macros: spatialMacros,
      track_indices: unionTracks,
      fade_duration: 0.5,
      cue_number: null,
      global_graph: postClip?.ref.type === 'postGraph' ? (postClip.ref.graph as never) : null,
      signal_graph: modClip?.ref.type === 'modGraph' ? (modClip.ref.graph as never) : null,
      per_track_depths: depthTouched
        ? Array.from({ length: depthSparse.length }, (_, i) => depthSparse[i] ?? 1.0)
        : [],
      manual_positions: manual,
      object_channels: Object.keys(objectChannels).length ? objectChannels : null,
      channel_modulations: mods,
      zones,
      mode: 'Full',
      scope: {
        moves: true, channels: true, positions: true, zones: true,
        global_graph: true, signal_graph: true, macros: true, osc_mappings: false,
      },
      pre_wait: 0,
      follow: null,
      timecode: null,
    },
    skipped,
  };
}
