/// Types, storage et helpers purs des MoveSlots — extraits de
/// moveSlotsSlice.ts (règle modularisation : le slice dépasse 800 lignes).
/// Aucune dépendance au store : fonctions pures + lecture/écriture
/// localStorage + helpers partagés (computeTrackIndices, normalizeSlot…).
import { safeInvoke as invoke } from '../../utils/tauri';
import { toast } from '../../utils/toast-helpers';
import type { Edge } from '@xyflow/react';
import type { GraphNode } from '../../components/nodeParamSchema';
import { syncObjectsGraphNodes, OBJECT_ENGINE_TYPES } from './objectsNodeSync';
import type { Move, TrackAssignment, AudioMod } from '../useMoveEditorStore';
import { safeSetItem, safeParseStoredJson, debouncedSetItem } from '../../utils/safeStorage';
import { throttleTrailingKeyed } from '../../utils/throttle';
import { SHAPE_PRESETS } from '../../utils/shapePresets';

/// Extrait la duration d'un graphe (node Duration) — fallback 4.0s
export function extractDuration(nodes: GraphNode[]): number {
  const durNode = nodes.find((n) => n.data.type === 'Duration');
  const d = durNode?.data.params?.duration;
  return typeof d === 'number' ? d : 4.0;
}

/// Track IDs déjà signalés comme non résolubles (anti-spam de toasts)
const _warnedTrackIds = new Set<string>();

/// Calcule les track_indices (index 0-based dans le projet hol ou manualOscIds)
/// à partir des trackIds (osc_ids) du slot.
/// ATTENTION : ne JAMAIS deviner `tid - 1` quand l'id est introuvable — ça mappe
/// silencieusement sur la mauvaise track en live. On skip + on warn une fois.
/// (exporté — réutilisé par drawModeSlice)
export function computeTrackIndices(trackIds: number[], holProject: any, manualOscIds: number[]): number[] {
  const indices: number[] = [];
  if (holProject) {
    trackIds.forEach((tid) => {
      const idx = holProject.tracks.findIndex((t: any) => t.id === tid);
      if (idx >= 0) indices.push(idx);
      else if (!_warnedTrackIds.has(`hol:${tid}`)) {
        _warnedTrackIds.add(`hol:${tid}`);
        toast.warning(`Track ${tid} not found in .hol project — skipped`);
      }
    });
  } else {
    trackIds.forEach((tid) => {
      const idx = manualOscIds.indexOf(tid);
      if (idx >= 0) {
        indices.push(idx);
      } else if (!_warnedTrackIds.has(`manual:${tid}`)) {
        _warnedTrackIds.add(`manual:${tid}`);
        toast.warning(`Track ${tid} not in manual OSC IDs — skipped (no silent fallback)`);
      }
    });
  }
  return indices;
}

/// Construit le graphe d'un slot depuis son templateId.
/// Utilisé à la création du slot et en fallback dans selectSlotForEditing
/// (slots persistés avant que graphJson ne soit construit à la création).
export function buildGraphForSlot(templateId: string, nTracks: number): { nodes: GraphNode[]; edges: Edge[] } | null {
  const preset = SHAPE_PRESETS.find((p) => p.id === templateId) ?? SHAPE_PRESETS[0];
  if (!preset) return null;
  const built = preset.build(nTracks);
  return { nodes: built.nodes, edges: built.edges };
}

/// MoveSlot — un move = une configuration persistante (graphe + tracks + macros)
/// Tout est un Move. Certains moves sont dans la setlist (l'ordre du spectacle).
/// Un Move peut être lancé indépendamment (live) ou rappelé via GO (spectacle).
/// Résultat typé d'un GO setlist — fini le sniffing du préfixe "GO:"
/// côté appelants (useLiveShortcuts, MovesTable, PerformView).
export interface GoResult {
  ok: boolean;
  message: string;
}

export interface MoveSlot {
  id: string;
  name: string;
  /// Graphe sauvegardé pour ce slot (construit depuis un template, puis éditable)
  graphJson: { nodes: GraphNode[]; edges: Edge[] } | null;
  /// Graphe de modulation per-move (domaine signal → cibles `param:` et
  /// macros du move). Édité dans le tab Mods quand ce slot est édité.
  signalGraph: { nodes: GraphNode[]; edges: Edge[] } | null;
  /// Template d'origine (pour affichage dans l'UI)
  templateId: string;
  /// Track IDs ciblées par ce slot
  trackIds: number[];
  /// ID du movement actif (null = arrêté). Source de vérité = backend.
  movementId: string | null;
  /// Mode preview ou live
  isPreview: boolean;
  /// Macros sauvegardées (appliquées au lancement et au GO)
  macros: MoveMacros;
  /// Durée du fade pour les transitions (GO, stop avec fade)
  fadeDuration: number;
  /// Loop mode : "loop" (défaut) ou "oneshot"
  loopMode: 'loop' | 'oneshot';
  /// Fin de one-shot : "revert" (défaut) ou "hold" (fige la dernière
  /// position en manuelle — sémantique continue).
  endMode?: 'revert' | 'hold';
  /// Ancre : "origin" (défaut), "current" (position courante — chaînage
  /// sans saut) ou "follow" (suit la position de la track cible en continu).
  anchorMode?: 'origin' | 'current' | 'follow';
  /// Track cible du mode "follow" (index de l'objet suivi).
  anchorTarget?: number;
  /// Direction : "forward" (défaut), "backward", ou "ping_pong"
  direction: 'forward' | 'backward' | 'ping_pong';
  /// Enveloppe de fade du cycle worker (début/fin de boucle) — distinct de
  /// fadeDuration (fade d'activation/désactivation du move, wall-clock).
  fadeIn: number;
  fadeOut: number;
  /// Répartition uniforme des phases des tracks sur le cycle (0 = groupé)
  phaseSpread: number;
  /// Index OSC stable (1-based) — le n de `/stagespace/slot <n>`. Persisté,
  /// assigné à la création, NE suit PAS les réordonnancements : ce que la
  /// console a programmé reste valide après réorganisation de la liste.
  oscIndex: number;
  /// Depth + phase offset par track (matché par track_id à l'activation)
  assignments: TrackAssignment[];
  /// Modulations audio-réactives (AudioModSource → AudioModTarget)
  audioMods: AudioMod[];
}

/// Macros d'un move — équivalent des macros du cue
export interface MoveMacros {
  speed: number;
  scale: number;
  shiftX: number;
  shiftY: number;
  shiftZ: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export function defaultMacros(): MoveMacros {
  return { speed: 1.0, scale: 1.0, shiftX: 0, shiftY: 0, shiftZ: 0, yaw: 0, pitch: 0, roll: 0 };
}

/// Sync visuel du node Objects SANS création — utilisé au switch de slot
/// pour édition : on met à jour l'affichage du graphe du slot sans créer
/// de node Objects dans un graphe qui n'en a pas. Partage le cœur avec
/// syncObjectsNode (objectsNodeSync.ts).
export function syncObjectsNodeNoHotSwap(get: () => any) {
  syncObjectsGraphNodes(get);
}

const SLOTS_STORAGE_KEY = 'stagespace-move-slots';
const SETLIST_STORAGE_KEY = 'stagespace-move-setlist';

/// Types de nodes qui ont un paramètre n_objects à sync avec le node
/// Objects — alias de la source unique objectsNodeSync.OBJECT_ENGINE_TYPES
/// (3 copies du même set existaient : holProjectSlice, moveSlotsSlice ×2).
export const ENGINE_TYPES_WITH_N_OBJECTS = OBJECT_ENGINE_TYPES;

/// Movement IDs en cours de fade-out côté backend.
/// deactivate_move(fade>0) retourne immédiatement mais le move reste dans
/// list_active_moves jusqu'à la fin du fade — syncSlotMovements ne doit pas
/// les flagger comme orphelins pendant ce laps de temps.
export const _fadingMoveIds = new Set<string>();

/// Movement IDs orphelins déjà signalés (une seule alerte par id)
export const _orphanWarnedIds = new Set<string>();

export function markFading(movementId: string, fadeDuration: number) {
  _fadingMoveIds.add(movementId);
  // La marge couvre la latence IPC + le jitter du thread de fade côté backend
  setTimeout(() => _fadingMoveIds.delete(movementId), fadeDuration * 1000 + 1500);
}

/// Backfill des champs ajoutés après coup — utilisé par le load localStorage
/// ET le restore .hfg (un slot sérialisé par une ancienne version n'a pas les
/// nouveaux champs ; sans ça ils arrivent undefined dans le store).
export function normalizeSlot(s: any): MoveSlot {
  return {
    ...s,
    macros: s.macros ?? defaultMacros(),
    fadeDuration: s.fadeDuration ?? 2.0,
    loopMode: s.loopMode ?? 'loop',
    direction: s.direction ?? 'forward',
    fadeIn: s.fadeIn ?? 0.5,
    fadeOut: s.fadeOut ?? 0.5,
    phaseSpread: s.phaseSpread ?? 0,
    assignments: s.assignments ?? [],
    audioMods: s.audioMods ?? [],
    signalGraph: s.signalGraph ?? null,
    oscIndex: s.oscIndex ?? 0,
  };
}

export function loadSlotsFromStorage(): MoveSlot[] {
  const slots = safeParseStoredJson<any[]>(SLOTS_STORAGE_KEY, []);
  if (!Array.isArray(slots)) return [];
  // Backfill : les slots pré-oscIndex prennent leur position (index+1).
  return slots.map(normalizeSlot).map((s, i) => (s.oscIndex ? s : { ...s, oscIndex: i + 1 }));
}

/// Projette un slot en `Move` — la forme que l'Inspector édite via
/// `current`. La source de vérité reste le slot : `current` est une vue
/// mutable, write-through vers le slot (updateCurrent → setSlot*).
export function slotToAnimation(raw: MoveSlot): Move {
  // Défensif : des slots peuvent arriver sans les champs récents (setState
  // direct dans les tests, restaurations partielles) — normalizeSlot backfill.
  const slot = normalizeSlot(raw);
  const duration = slot.graphJson ? extractDuration(slot.graphJson.nodes) : 4.0;
  // Reconstruire les assignments complets : les trackIds sans entrée
  // sauvegardée obtiennent les défauts (depth 1, phase 0).
  const assignments = slot.trackIds.map(
    (tid) =>
      slot.assignments.find((a) => a.track_id === tid) ??
      { track_id: tid, depth: 1.0, phase_offset: 0 },
  );
  return {
    id: `slot-${slot.id}`,
    name: slot.name,
    speed: slot.macros.speed,
    duration,
    direction: slot.direction,
    loop_mode: slot.loopMode === 'oneshot' ? 'one_shot' : 'loop',
    scale: slot.macros.scale,
    yaw: slot.macros.yaw,
    pitch: slot.macros.pitch,
    roll: slot.macros.roll,
    offset_x: slot.macros.shiftX,
    offset_y: slot.macros.shiftY,
    offset_z: slot.macros.shiftZ,
    assignments,
    phase_spread: slot.phaseSpread,
    audio_mods: slot.audioMods,
    graph_json: slot.graphJson ?? undefined,
    fade_in: slot.fadeIn,
    fade_out: slot.fadeOut,
  };
}

/// (exporté — drawModeSlice persiste aussi les slots après un dessin)
export function saveSlotsToStorage(slots: MoveSlot[]) {
  safeSetItem(SLOTS_STORAGE_KEY, JSON.stringify(slots));
}

/// Variante debounced pour les hot paths (sliders → pointermove à 60Hz) :
/// stringify+setItem synchrone de toute la librairie de slots à chaque pixel
/// de drag = jank. Trailing edge — la dernière valeur est toujours écrite.
export function saveSlotsToStorageDebounced(slots: MoveSlot[]) {
  debouncedSetItem(SLOTS_STORAGE_KEY, JSON.stringify(slots));
}

// Throttle des push live — un slider en drag ne doit pas spammer l'IPC.
// Keyed par movementId : deux slots draggés en parallèle gardent chacun
// leur trailing call.
export const throttledMoveSpeed = throttleTrailingKeyed((movementId: string, speed: number) => {
  invoke('set_move_speed', { movementId, speed })
    .catch((e) => console.warn('[setSlotMacros] set_move_speed failed:', e));
}, 33);

export function loadSetlistFromStorage(): string[] {
  const parsed = safeParseStoredJson<string[]>(SETLIST_STORAGE_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveSetlistToStorage(setlist: string[]) {
  safeSetItem(SETLIST_STORAGE_KEY, JSON.stringify(setlist));
}
