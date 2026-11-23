/// DEV ONLY — seed de la surface SCORE pour revue visuelle sans
/// backend (`vite dev` + `?score-demo`). Slots/cues factices, clips
/// variés : copies liées multi-lanes, fades clip-local, lane stacked,
/// repeat, orphelins, lane fantôme, loop, courbes clip+master.
/// Le play n'est pas exercé (pas de backend) — rendu/édition seulement.
import { useScoreStore, GLOBALFX_LANE, MODULATION_LANE } from '../store/useScoreStore';
import { useGraphStore } from '../store/useGraphStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { useMoveEditorStore } from '../store/useMoveEditorStore';
import { useSignalGraphStore, buildScoreDemoSignalGraph } from '../store/useSignalGraphStore';

const slot = (id: string, name: string, fadeIn: number, fadeOut: number, trackIds: number[]) =>
  ({
    id, name, oscIndex: 1, templateId: 'circle',
    graphJson: null, signalGraph: null, trackIds,
    movementId: null, isPreview: false, fadeIn, fadeOut,
  }) as never;

export function seedScoreDemo() {
  // 4 objets patchés → 4 lanes objets (manualOscIds = les track_ids).
  useGraphStore.setState({
    manualOscIds: [1, 2, 3, 4],
    moveSlots: [
      slot('s-orbe', 'Orbe', 0.8, 1.5, [1, 2]),
      slot('s-vague', 'Vague', 0.5, 0.5, [2, 3]),
      slot('s-essaim', 'Essaim', 2.0, 3.0, [2, 3, 4]),
    ],
  } as never);
  useCuelistStore.setState({
    cues: [
      // Snapshot touchant les obj_index 0 et 1 → couverture dérivée
      // = track_ids 1 et 2 (via manualOscIds).
      { id: 1, cue_number: '1', name: 'Ouverture', moves: [], track_indices: [0, 1], manual_positions: {} },
      { id: 2, cue_number: '2', name: 'Nuit', moves: [], track_indices: [3], manual_positions: { 2: [0, 1, 0] } },
    ],
  } as never);

  const st = useScoreStore.getState();
  st.setScoreDoc(undefined);
  const s = useScoreStore.getState();

  // Lane obj-2 → stacked : les chevauchements s'empilent en sous-lignes.
  s.setLaneMode('obj-2', 'stacked');

  // Orbe couvre T1+T2 → copie liée sur les deux lanes (chevauche
  // Vague sur T2 → sous-lignes en stacked). Move loopé → tuile par
  // défaut (repeat = un cycle) + fades + courbes clip.
  const c1 = s.addClip({ type: 'slot', slotId: 's-orbe' }, 2_000, {
    durationMs: 12_000, trackIds: [1, 2], repeatEveryMs: 4_000,
  });
  s.setClipFades(c1.id, 800, 1_500);
  s.setClipCurve(c1.id, 'speed', [
    { t: 0, v: 1 }, { t: 4_000, v: 1.8 }, { t: 9_000, v: 0.6 }, { t: 12_000, v: 1 },
  ]);
  s.setClipCurve(c1.id, 'scale', [
    { t: 0, v: 1 }, { t: 6_000, v: 1.5 }, { t: 12_000, v: 0.8 },
  ]);
  // Vague sur T2+T3 — chevauche Orbe sur la lane T2 (stacked) et
  // vit aussi seule sur T3 (fades hérités du slot, tuile par défaut).
  s.addClip({ type: 'slot', slotId: 's-vague' }, 9_000, {
    durationMs: 10_000, trackIds: [2, 3], repeatEveryMs: 5_000,
  });
  // Essaim sur T2+T3+T4 — trois copies liées multi-lanes + tuile.
  s.addClip({ type: 'slot', slotId: 's-essaim' }, 22_000, {
    durationMs: 16_000, trackIds: [2, 3, 4], repeatEveryMs: 4_000,
  });
  // Référence cassée → clip orphelin sur T4 (pointillés, ⚠).
  s.addClip({ type: 'slot', slotId: 'slot-supprime' }, 42_000, { durationMs: 6_000, trackIds: [4] });
  // Lane fantôme : clip couvrant l'objet 9, non patché → T9 ⚠.
  s.addClip({ type: 'slot', slotId: 's-vague' }, 30_000, { durationMs: 8_000, trackIds: [2, 9] });

  // Cues — couverture dérivée du snapshot (T1+T2 / T3+T4).
  s.addClip({ type: 'cue', cueId: '1' }, 15_000, { trackIds: [1, 2] });
  s.addClip({ type: 'cue', cueId: '2' }, 38_000, { trackIds: [3, 4] });
  // Cue orpheline — couverture vide → se rend sur la lane master.
  s.addClip({ type: 'cue', cueId: '999' }, 48_000);

  // Markers → lane globalfx.
  s.addClip({ type: 'stopAll' }, 50_000);
  s.addClip({ type: 'panic' }, 56_000);

  // Courbes GLOBALFX — macros globales (merge), temps absolu partition.
  s.setLaneCurve(GLOBALFX_LANE, 'radius_scale', [
    { t: 0, v: 1 }, { t: 30_000, v: 1.6 }, { t: 60_000, v: 1 },
  ]);
  s.setLaneCurve(GLOBALFX_LANE, 'shift_y', [{ t: 0, v: 0 }, { t: 45_000, v: 2 }]);
  // Courbe MODULATION — valeur nommée injectée dans la map OSC,
  // lisible par un node SignalOsc `/score/energy` du graph Mods.
  s.setLaneCurve(MODULATION_LANE, '/score/energy', [
    { t: 0, v: 0 }, { t: 20_000, v: 1 }, { t: 40_000, v: 0.3 }, { t: 60_000, v: 0 },
  ]);

  // Graphe signal NON-VIDE — le signal graph global est vide par
  // défaut : sans lui la lane MODULATION n'a aucun consommateur.
  // SignalOsc("/score/energy") → Map(0..1→-0.5..+0.5) → SignalOut
  // (scale) : la courbe ci-dessus module l'échelle globale au play.
  const sig = buildScoreDemoSignalGraph();
  useSignalGraphStore.setState({ nodes: sig.nodes, edges: sig.edges, context: 'global' });
  void useSignalGraphStore.getState().pushSignalGraph();

  s.setLoop(20_000, 60_000);

  useMoveEditorStore.getState().setSurface('score');
}
