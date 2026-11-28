import React from 'react';
import { useSignalGraphStore } from '../store/useSignalGraphStore';
import { useGraphStore } from '../store/useGraphStore';
import { buildModChips } from '../utils/signalModChips';

/// Chips des modulations actives, par origine — une modulation oubliée
/// dans le show est sinon indiscernable d'un bug de trajectoire (un yaw
/// oscillant ressemble à un move erratique). Source unique : la StatusBar
/// (toutes surfaces).
///
/// Deux origines distinctes (A2.8) :
///   GLOBAL  `target←src`         — modulation du MergeRuntime (macros),
///             lue depuis la copie canonique `global` du store — visible
///             quel que soit le contexte d'édition en cours.
///   PER-MOVE `Slot:target←src`   — modulation d'un slot EN LECTURE dont
///             le document porte un graphe signal. Un slot arrêté ne
///             module rien : sa chip disparaît, honnêteté live.
export const ModChips: React.FC = () => {
  const globalNodes = useSignalGraphStore((s) => s.global.nodes);
  const globalEdges = useSignalGraphStore((s) => s.global.edges);
  const moveSlots = useGraphStore((s) => s.moveSlots);

  const globalChips = buildModChips(globalNodes, globalEdges);
  const perMove = moveSlots
    .filter((sl) => sl.movementId && sl.signalGraph && sl.signalGraph.nodes.length > 0)
    .map((sl) => ({
      name: sl.name,
      chips: buildModChips(sl.signalGraph!.nodes, sl.signalGraph!.edges),
    }))
    .filter((x) => x.chips.length > 0);

  if (globalChips.length === 0 && perMove.length === 0) return null;

  return (
    <>
      {globalChips.length > 0 && (
        <span
          className="px-1.5 py-0.5 rounded font-mono flex-shrink-0 border text-stagespace-modulation bg-stagespace-modulation/15 border-stagespace-modulation/40"
          title={`Modulation GLOBALE active (macros) — ${globalChips.map((c) => c.chainLabel).join(' · ')} (onglet Modulation, scope Global)`}
        >
          MOD {globalChips.map((c) => `${c.target}←${c.srcLabel}`).join(' ')}
        </span>
      )}
      {perMove.map(({ name, chips }) => (
        <span
          key={name}
          className="px-1.5 py-0.5 rounded font-mono flex-shrink-0 border text-stagespace-modulation bg-stagespace-modulation/10 border-stagespace-modulation/25"
          title={`Modulation PER-MOVE active sur « ${name} » — ${chips.map((c) => c.chainLabel).join(' · ')} (onglet Modulation de ce slot)`}
        >
          MOD {name}:{chips.map((c) => `${c.target}←${c.srcLabel}`).join(' ')}
        </span>
      ))}
    </>
  );
};

export default ModChips;
