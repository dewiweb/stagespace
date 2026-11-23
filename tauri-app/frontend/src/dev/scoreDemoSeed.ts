/// DEV ONLY — seed de la surface SCORE pour revue visuelle sans
/// backend (`vite dev` + `?score-demo`). Slots/cues factices, clips
/// variés : fades clip-local, lane stacked, repeat, orphelins, loop.
/// Le play n'est pas exercé (pas de backend) — rendu/édition seulement.
import { useScoreStore } from '../store/useScoreStore';
import { useGraphStore } from '../store/useGraphStore';
import { useCuelistStore } from '../store/useCuelistStore';
import { useMoveEditorStore } from '../store/useMoveEditorStore';

const slot = (id: string, name: string, fadeIn: number, fadeOut: number) =>
  ({
    id, name, oscIndex: 1, templateId: 'circle',
    graphJson: null, signalGraph: null, trackIds: [1],
    movementId: null, isPreview: false, fadeIn, fadeOut,
  }) as never;

export function seedScoreDemo() {
  useGraphStore.setState({
    moveSlots: [
      slot('s-orbe', 'Orbe', 0.8, 1.5),
      slot('s-vague', 'Vague', 0.5, 0.5),
      slot('s-essaim', 'Essaim', 2.0, 3.0),
    ],
  } as never);
  useCuelistStore.setState({
    cues: [
      { id: 1, cue_number: '1', name: 'Ouverture', moves: [] },
      { id: 2, cue_number: '2', name: 'Nuit', moves: [] },
    ],
  } as never);

  const st = useScoreStore.getState();
  st.setScoreDoc(undefined);
  const s = useScoreStore.getState();

  // Lane slots → stacked : les chevauchements s'empilent en sous-lignes.
  s.setTrackMode('trk-slots', 'stacked');

  // Fades clip-local explicites (override du slot).
  const c1 = s.addClip('trk-slots', { type: 'slot', slotId: 's-orbe' }, 2_000, 12_000);
  s.setClipFades(c1.id, 800, 1_500);
  // Chevauchement → sous-ligne 2 en mode stacked (fades hérités du slot).
  s.addClip('trk-slots', { type: 'slot', slotId: 's-vague' }, 9_000, 10_000);
  // Clip répété — ticks ⟳ + fades hérités (2 s/3 s du slot Essaim).
  const c3 = s.addClip('trk-slots', { type: 'slot', slotId: 's-essaim' }, 22_000, 16_000);
  s.setClipRepeat(c3.id, 4_000);
  // Référence cassée → clip orphelin (pointillés, désaturé, ⚠).
  s.addClip('trk-slots', { type: 'slot', slotId: 'slot-supprime' }, 42_000, 6_000);

  s.addClip('trk-cues', { type: 'cue', cueId: '1' }, 15_000);
  s.addClip('trk-cues', { type: 'cue', cueId: '2' }, 38_000);
  s.addClip('trk-cues', { type: 'cue', cueId: '999' }, 48_000); // cue orpheline

  s.addClip('trk-markers', { type: 'stopAll' }, 50_000);
  s.addClip('trk-markers', { type: 'panic' }, 56_000);

  s.setLoop(20_000, 60_000);

  useMoveEditorStore.getState().setSurface('score');
}
