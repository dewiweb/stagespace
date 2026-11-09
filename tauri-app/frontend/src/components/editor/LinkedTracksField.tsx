import React from 'react';

/// Classe input partagée des params node — les 7 copies verbatim dans
/// CustomNode divergeaient silencieusement (focus:border-blue vs cyan).
export const NODE_INPUT_CLS =
  'w-full px-2 py-1 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none';
export const NODE_INPUT_MONO_CLS = `${NODE_INPUT_CLS} font-mono`;
const TRACKS_CLS =
  'w-full mt-0.5 px-2 py-1 bg-gray-900 text-cyan-300 text-xs font-mono rounded border border-gray-700 focus:border-cyan-500 focus:outline-none';

/// Champ "Linked Tracks" des nodes Objects — deux copies identiques
/// (expanded + collapsed) dans CustomNode, qui divergeaient sur le nombre
/// de chips affichés (16 vs 12). `maxShown` conserve les deux seuils.
export const LinkedTracksField: React.FC<{
  value: string;
  onChangeText: (v: string) => void;
  onCommit: () => void;
  ids: number[];
  maxShown: number;
}> = ({ value, onChangeText, onCommit, ids, maxShown }) => (
  <div>
    <label className="text-cyan-400 text-xs font-mono">Linked Tracks</label>
    <input
      type="text"
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
      placeholder="ex: 1, 2, 3..."
      className={TRACKS_CLS}
    />
    {ids.length > 0 && (
      <div className="flex flex-wrap gap-0.5 mt-1">
        {ids.slice(0, maxShown).map((id) => (
          <span key={id} className="text-xs font-mono px-1 py-0.5 bg-cyan-900/40 text-cyan-400 rounded">
            {id}
          </span>
        ))}
        {ids.length > maxShown && (
          <span className="text-xs text-gray-500">+{ids.length - maxShown}</span>
        )}
      </div>
    )}
  </div>
);

export default LinkedTracksField;
