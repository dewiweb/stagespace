/// Preflight du score (docs/score-sequencer.md — « score_validate ») :
/// résolution SÈCHE de la partition — détecte avant le show ce qui ne
/// s'exécutera pas comme attendu. Aucune commande backend, aucun
/// effet : lecture pure du doc + du contexte patch (slots, cuelist,
/// mapping OSC).
///
/// Niveaux : `error` = ça ne jouera pas (ref morte, partition vide,
/// loop invalide) ; `warning` = ça jouera mais probablement pas comme
/// voulu (couverture muette, courbe sans cible, clip jamais tiré).
import { useScoreStore, laneIdOf, type ScoreClipDoc } from '../store/useScoreStore';
import { usePoseStore } from '../store/usePoseStore';
import { useGraphStore } from '../store/useGraphStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { effectiveTrackIds } from './scoreResolve';
import { fmtMs } from '../components/score/scoreUtils';
import {
  CLIP_PARAM_DEFS, GLOBALFX_PARAM_DEFS, OBJECT_LANE_DEFS,
} from '../components/score/scoreParams';

export interface ScoreIssue {
  level: 'error' | 'warning';
  message: string;
}

const CLIP_IDS = new Set(CLIP_PARAM_DEFS.map((d) => d.id));
const GLOBALFX_IDS = new Set(GLOBALFX_PARAM_DEFS.map((d) => d.id));
const OBJECT_IDS = new Set(OBJECT_LANE_DEFS.map((d) => d.id));

const where = (c: ScoreClipDoc) => `« ${c.ref.type} » @${fmtMs(c.startMs)}`;

/// Évalue la partition et retourne les problèmes triés
/// (erreurs d'abord). Vide = partition saine.
export function validateScore(): ScoreIssue[] {
  const doc = useScoreStore.getState();
  const gs = useGraphStore.getState();
  const cues = useCuelistStore.getState().cues;
  const issues: ScoreIssue[] = [];
  const err = (m: string) => issues.push({ level: 'error', message: m });
  const warn = (m: string) => issues.push({ level: 'warning', message: m });
  const poseNames = () => new Set(usePoseStore.getState().poses.map((p) => p.name));
  const muted = (lane: string) => doc.laneStates?.[lane]?.muted === true;

  const hasContent =
    doc.clips.length > 0 ||
    [doc.globalFxCurves, doc.modulationCurves, doc.spatialFxCurves, doc.objectCurves]
      .some((m) => Object.keys(m ?? {}).length > 0);
  if (!hasContent) {
    err('Partition vide — rien ne jouera');
    return issues;
  }
  if (doc.loopStartMs != null && doc.loopEndMs != null && doc.loopStartMs >= doc.loopEndMs) {
    err(`Région de boucle invalide (${fmtMs(doc.loopStartMs)} ≥ ${fmtMs(doc.loopEndMs)})`);
  }

  const end = doc.durationMs;
  const validTid = (tid: number) => gs.manualOscIds.includes(tid);
  let zonesInstalled = 0;
  let modsInstalled = false;

  for (const c of doc.clips) {
    if (c.startMs >= end) warn(`${where(c)} jamais tiré (au-delà de la durée ${fmtMs(end)})`);
    // Courbes clip-scoped hors clips slot → ignorées au tir.
    if (c.ref.type !== 'slot' && c.curves && Object.keys(c.curves).length) {
      warn(`${where(c)} : courbes clip-scoped ignorées (pas un clip slot)`);
    }
    switch (c.ref.type) {
      case 'slot': {
        const slot = gs.moveSlots.find((s) => s.id === (c.ref as { slotId: string }).slotId);
        if (!slot) {
          err(`${where(c)} orphelin — move « ${(c.ref as { slotId: string }).slotId} » supprimé de la banque`);
          break;
        }
        if (!slot.graphJson) warn(`${where(c)} → move « ${slot.name} » sans graphe (rien ne spawne)`);
        const eff = effectiveTrackIds(c);
        const unmuted = eff.filter((tid) => !muted(laneIdOf(tid)));
        if (eff.length === 0) warn(`${where(c)} : couverture vide — aucun objet ciblé`);
        else if (unmuted.length === 0) warn(`${where(c)} : couverture entièrement mutée — clip muet`);
        const missing = eff.filter((tid) => !validTid(tid));
        if (missing.length) warn(`${where(c)} : T${missing.join(',T')} hors du patch OSC — ignorées au spawn`);
        if (slot.anchorMode === 'follow' && slot.anchorTarget != null && !validTid(slot.anchorTarget)) {
          warn(`${where(c)} : anchor « follow » → T${slot.anchorTarget} hors patch`);
        }
        if (c.curves) {
          for (const p of Object.keys(c.curves)) {
            if (!CLIP_IDS.has(p) && !p.startsWith('param:') && !p.startsWith('merge:')) {
              warn(`${where(c)} : courbe clip-scoped inconnue « ${p} » — ignorée`);
            }
          }
        }
        break;
      }
      case 'cue':
      case 'cueArm': {
        const cueId = (c.ref as { cueId: string }).cueId;
        if (!cues.some((q) => String(q.id) === String(cueId))) {
          err(`${where(c)} orphelin — cue supprimée de la cuelist`);
        }
        break;
      }
      case 'solo': {
        const n = (c.ref as { n: number }).n;
        if (!gs.moveSlots.some((s) => s.oscIndex === n)) {
          warn(`${where(c)} : solo slot ${n} — aucun slot n'a cet oscIndex (nack not-found au tir)`);
        }
        break;
      }
      case 'soundcheck':
      case 'unsolo':
      case 'cueGo':
      case 'view':
        break;
      case 'pose': {
        // Preflight poses (design §8) — la pose est référencée par nom,
        // résolue au fire : pose absente ou morph sans source valide =
        // warnings, même passe que les refs orphelines.
        const r = c.ref as { name: string; mode: string; fromPose?: string };
        const names = poseNames();
        if (!names.has(r.name)) {
          warn(`${where(c)} : pose '${r.name}' absente de la table — not-found au tir`);
        }
        if (r.mode === 'morph') {
          if (!r.fromPose) {
            err(`${where(c)} : morph sans pose source — clip refusé au tir`);
          } else if (!names.has(r.fromPose)) {
            warn(`${where(c)} : pose source '${r.fromPose}' absente — morph impossible au tir`);
          }
        }
        break;
      }
      case 'positions': {
        const posRef = c.ref as { positions: Record<number, unknown> };
        const missing = Object.keys(posRef.positions).map(Number).filter((tid) => !validTid(tid));
        if (missing.length) warn(`${where(c)} : T${missing.join(',T')} hors du patch OSC — positions ignorées`);
        break;
      }
      case 'osc': {
        const ref = c.ref as { addr: string; target?: string; args: string };
        const addr = ref.addr.trim();
        if (!addr) {
          err(`${where(c)} : adresse OSC vide — clip sauté au tir`);
        } else {
          if (!addr.startsWith('/')) warn(`${where(c)} : adresse « ${addr} » sans '/' — rejetée par la plupart des récepteurs OSC`);
          if (addr.startsWith('/stagespace/')) {
            warn(`${where(c)} : adresse réservée « ${addr} » — refusée au tir si la cible est notre propre port d'entrée (boucle show-control)`);
          }
        }
        const t = (ref.target ?? '').trim();
        if (t && !/^[^\s:]+:\d+$/.test(t)) warn(`${where(c)} : cible « ${t} » invalide — format attendu host:port`);
        break;
      }
      case 'zones':
        zonesInstalled = Math.max(zonesInstalled, (c.ref as { zones: unknown[] }).zones.length);
        break;
      case 'chanMods':
        modsInstalled = true;
        break;
      default:
        break;
    }
  }

  // ── Courbes de lanes ──
  for (const [lane, params] of Object.entries(doc.objectCurves ?? {})) {
    const tid = Number(lane.replace(/^obj-/, ''));
    if (!validTid(tid)) warn(`Lane ${lane} : T${tid} hors du patch OSC — courbes sans cible`);
    for (const p of Object.keys(params)) {
      if (!OBJECT_IDS.has(p)) warn(`Lane ${lane} : param inconnu « ${p} » — courbe ignorée`);
    }
  }
  for (const p of Object.keys(doc.globalFxCurves ?? {})) {
    if (!GLOBALFX_IDS.has(p)) warn(`GLOBALFX : param inconnu « ${p} » — courbe ignorée`);
  }
  for (const p of Object.keys(doc.spatialFxCurves ?? {})) {
    if (p === 'ksmooth' || p === 'spatial') continue;
    const zm = p.match(/^zone:(\d+):/);
    if (zm) {
      if (zonesInstalled === 0) warn(`SPATIALFX « ${p} » : aucun clip zones — courbe sans table à patcher`);
      else if (Number(zm[1]) >= zonesInstalled) {
        warn(`SPATIALFX « ${p} » : zone ${zm[1]} absente (la table n'en installe que ${zonesInstalled} — clé positionnelle)`);
      }
      continue;
    }
    if (p.startsWith('mod:')) {
      if (!modsInstalled) warn(`SPATIALFX « ${p} » : aucun clip chanMods — courbe sans règle à patcher`);
      continue;
    }
    warn(`SPATIALFX : param inconnu « ${p} » — courbe ignorée`);
  }
  // modulationCurves : clés libres par design (SignalOsc) — pas de vérif.

  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
}
