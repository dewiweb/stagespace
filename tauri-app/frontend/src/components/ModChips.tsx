import React from 'react';
import { useSignalGraphStore } from '../store/useSignalGraphStore';
import { buildModChips } from '../utils/signalModChips';

/// Chips des modulations globales actives — un SignalOut = un chip
/// `target ← source`. Une modulation oubliée dans le show est sinon
/// indiscernable d'un bug de trajectoire (un yaw oscillant ressemble à
/// un move erratique). Source unique : la StatusBar (toutes surfaces).
export const ModChips: React.FC = () => {
  const nodes = useSignalGraphStore((s) => s.nodes);
  const edges = useSignalGraphStore((s) => s.edges);
  const context = useSignalGraphStore((s) => s.context);

  // Le store porte le graphe en cours d'ÉDITION : context != 'global'
  // signifie qu'on édite le graphe d'un slot — afficher ses nœuds comme
  // modulation globale serait mensonger.
  if (context !== 'global') return null;
  const chips = buildModChips(nodes, edges);
  if (chips.length === 0) return null;

  return (
    <span
      className="px-1.5 py-0.5 rounded font-mono flex-shrink-0 border text-purple-300 bg-purple-900/40 border-purple-700/40"
      title={`Modulation globale active — ${chips.map((c) => c.chainLabel).join(' · ')} (onglet signal de l'éditeur)`}
    >
      MOD {chips.map((c) => `${c.target}←${c.srcLabel}`).join(' ')}
    </span>
  );
};

export default ModChips;
