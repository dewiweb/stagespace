import { describe, it, expect, beforeEach } from 'vitest';
// Import ?raw (vite/client) — pas de node:fs/__dirname, absents du tsconfig.
import rawHfg from '../../../../../examples/full-feature-show.hfg?raw';
import { isValidConnection, getInputPorts } from '../connectionRules';
import type { NodeType } from '../../store/useGraphStore';
import {
  useGraphStore,
  getInvokeCalls,
  resetStore,
  setInvokeResponse,
} from '../../store/__tests__/testHelpers';
import { useCuelistStore } from '../../store/useCuelistStore';
import { useGlobalGraphStore } from '../../store/useGlobalGraphStore';
import type { Node, Edge } from '@xyflow/react';

/// Charge examples/full-feature-show.hfg (repo root) et vérifie que le show
/// est chargeable : enveloppe v2, graphes valides (règles de connexion,
/// ports, arité), cohérence slots/tracks/cues.
const raw = JSON.parse(rawHfg);

const nodeType = (n: Node) => (n.data as { type?: NodeType }).type as NodeType;

function validateGraph(label: string, nodes: Node[], edges: Edge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const usedInputs = new Map<string, Set<string>>();
  for (const e of edges) {
    const src = byId.get(e.source);
    const dst = byId.get(e.target);
    expect(src, `${label}: edge ${e.id} source missing`).toBeDefined();
    expect(dst, `${label}: edge ${e.id} target missing`).toBeDefined();
    const from = nodeType(src!);
    const to = nodeType(dst!);
    expect(isValidConnection(from, to), `${label}: ${from} -> ${to}`).toBe(true);
    const th = e.targetHandle ?? 'in';
    expect(getInputPorts(to).map((p) => p.name), `${label}: port ${th} on ${to}`).toContain(th);
    const used = usedInputs.get(e.target) ?? new Set<string>();
    expect(used.has(th), `${label}: ${to}.${th} fed twice`).toBe(false);
    used.add(th);
    usedInputs.set(e.target, used);
  }
}

const VALID_CHANNELS = new Set(['gain', 'spread', 'distance', 'presence', 'yaw', 'aperture', 'lfe']);

describe('examples/full-feature-show.hfg', () => {
  it('is a v2 show envelope', () => {
    expect(raw.format).toBe('stagespace-show');
    expect(raw.version).toBe(2);
    expect(Array.isArray(raw.nodes)).toBe(true);
    expect(Array.isArray(raw.edges)).toBe(true);
  });

  it('top-level graph is valid', () => {
    validateGraph('edited', raw.nodes, raw.edges);
  });

  it('global graph is valid (source + Output, global-only nodes)', () => {
    const types = raw.globalGraph.nodes.map(nodeType);
    expect(types.some((t: NodeType) => ['Input', 'Merge', 'MoveRef'].includes(t))).toBe(true);
    expect(types).toContain('Output');
    validateGraph('global', raw.globalGraph.nodes, raw.globalGraph.edges);
  });

  it('every slot has a valid graph and n_objects == trackIds.length', () => {
    for (const slot of raw.slots) {
      expect(slot.movementId).toBeNull();
      const g = slot.graphJson;
      expect(g, `${slot.id}: missing graphJson`).toBeTruthy();
      validateGraph(slot.id, g.nodes, g.edges);
      const objects = g.nodes.find((n: Node) => nodeType(n) === 'Objects');
      expect(objects).toBeDefined();
      expect(objects.data.params.n_objects).toBe(slot.trackIds.length);
    }
  });

  it('setlist references existing slots only', () => {
    const ids = new Set(raw.slots.map((s: { id: string }) => s.id));
    for (const so of raw.setlistOrder) expect(ids.has(so)).toBe(true);
    expect(ids.has(raw.editingSlotId)).toBe(true);
  });

  it('cues have consistent moves (shared tracks allowed — merge resolves)', () => {
    for (const cue of raw.cues) {
      expect(cue.moves.length).toBeGreaterThan(0);
      const used = new Set<number>();
      let overlap = 0;
      for (const mv of cue.moves) {
        expect(mv.track_indices.length).toBe(mv.osc_ids.length);
        validateGraph(`${cue.id}/${mv.id}`, mv.graph_json.nodes, mv.graph_json.edges);
        for (const ti of mv.track_indices) {
          if (used.has(ti)) overlap++;
          used.add(ti);
        }
      }
      // Seul le cue Superposition partage volontairement des tracks
      // (test de la résolution de conflit du MergeRuntime).
      if (cue.id !== 'cue-superposition') expect(overlap, `${cue.id}`).toBe(0);
    }
  });

  it('tracks are self-consistent without a .hol project', () => {
    expect(raw.tracks.holProject).toBeNull();
    expect(raw.tracks.manualOscIds.length).toBeGreaterThan(0);
    for (const key of Object.keys(raw.tracks.manualPositions)) {
      const idx = Number(key);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(raw.tracks.manualOscIds.length);
    }
    const ids = new Set(raw.tracks.manualOscIds);
    for (const t of raw.tracks.selectedTrackIds) expect(ids.has(t)).toBe(true);
    for (const slot of raw.slots) {
      for (const t of slot.trackIds) expect(ids.has(t), `${slot.id}: track ${t}`).toBe(true);
    }
  });

  it('spatial FX uses only known channels', () => {
    for (const z of raw.spatialFx.zones) {
      expect(z.channels && Object.keys(z.channels).length).toBeGreaterThan(0);
      for (const ch of Object.keys(z.channels)) {
        expect(VALID_CHANNELS.has(ch), `zone channel '${ch}'`).toBe(true);
      }
      expect(['sphere', 'box']).toContain(z.shape.shape);
    }
    for (const m of raw.spatialFx.modulations) {
      expect(['Speed', 'Acceleration', 'Jerk', 'AngularSpeed']).toContain(m.source);
      expect(m.channel.length).toBeGreaterThan(0);
    }
    for (const [obj, channels] of Object.entries(raw.spatialFx.objectChannels)) {
      expect(Number(obj)).toBeLessThan(raw.tracks.manualOscIds.length);
      for (const ch of Object.keys(channels as object)) {
        expect(VALID_CHANNELS.has(ch), `object channel '${ch}'`).toBe(true);
      }
    }
  });
});

// ─── End-to-end : le fichier réel passe par loadGraphFromFile (invoke mocké) ───

describe('loadGraphFromFile — full-feature-show.hfg', () => {
  beforeEach(() => {
    resetStore();
    setInvokeResponse('load_graph_from_file', raw);
    // Le mock résout `undefined` par défaut — les list_* FX doivent renvoyer
    // des valeurs pour que refreshSpatialFx ne lise pas `.zones` sur undefined.
    setInvokeResponse('list_zones', []);
    setInvokeResponse('list_channel_modulations', []);
    setInvokeResponse('list_spatial_channels', {});
    setInvokeResponse('list_graph_effects', { zones: [], modulations: [] });
    setInvokeResponse('osc_list_mappings', []);
  });

  it('restores the whole show without errors', async () => {
    await useGraphStore.getState().loadGraphFromFile('/tmp/full-feature-show.hfg');
    const s = useGraphStore.getState();

    // Slots + setlist + édition
    expect(s.moveSlots.map((sl: { id: string }) => sl.id)).toEqual(raw.setlistOrder);
    expect(s.editingSlotId).toBe('slot-orbit');
    expect(s.nodes.length).toBeGreaterThan(0);

    // Tracks manuelles
    expect(s.manualOscIds).toEqual(raw.tracks.manualOscIds);
    expect(Array.from(s.selectedTrackIds as Set<number>)).toEqual(raw.tracks.selectedTrackIds);

    // Cues restaurées
    expect(useCuelistStore.getState().cues.map((c) => c.id)).toEqual(raw.cues.map((c: { id: string }) => c.id));

    // Graphe global restauré + pushé au backend
    expect(useGlobalGraphStore.getState().nodes.length).toBe(raw.globalGraph.nodes.length);

    // Config OSC poussée
    const oscPush = getInvokeCalls().find((c) => c.cmd === 'set_osc_output');
    expect(oscPush?.args?.address).toBe('127.0.0.1');
    expect(oscPush?.args?.profile).toBe('holophonix');

    // Spatial FX replayés : clear + 2 zones + 3 modulations + channels + smoothing
    expect(getInvokeCalls().some((c) => c.cmd === 'clear_zones')).toBe(true);
    expect(getInvokeCalls().filter((c) => c.cmd === 'add_zone')).toHaveLength(2);
    expect(getInvokeCalls().filter((c) => c.cmd === 'add_channel_modulation')).toHaveLength(3);
    // Modulation par-objet (object: 2 → Jerk→Gain) présente dans le replay
    const objMod = getInvokeCalls()
      .filter((c) => c.cmd === 'add_channel_modulation')
      .find((c) => c.args?.params?.object_index === 2);
    expect(objMod?.args?.params?.source).toBe('jerk');
    expect(getInvokeCalls().filter((c) => c.cmd === 'set_spatial_channel')).toHaveLength(2);
    expect(getInvokeCalls().some((c) => c.cmd === 'set_kinematic_smoothing')).toBe(true);

    // OSC IN mappings replayés (macro, channel wildcard, position, handler)
    expect(getInvokeCalls().some((c) => c.cmd === 'osc_clear_mappings')).toBe(true);
    expect(getInvokeCalls().filter((c) => c.cmd === 'osc_add_mapping')).toHaveLength(4);

    // Macros globales
    expect(s.macros.radius_scale).toBe(1);
  });

  it('replayed zones carry valid backend params', async () => {
    await useGraphStore.getState().loadGraphFromFile('/tmp/full-feature-show.hfg');
    const zoneCalls = getInvokeCalls().filter((c) => c.cmd === 'add_zone');
    const sphere = zoneCalls[0].args?.params;
    expect(sphere.shape).toBe('sphere');
    expect(sphere.channels).toEqual({ spread: 1 });
    const box = zoneCalls[1].args?.params;
    expect(box.shape).toBe('box');
    expect(box.channels).toEqual({ gain: -3 });
  });
});
