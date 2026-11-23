/// Colonne « Paramètres » de la zone haute du score — sélection de la
/// courbe éditée dans la colonne éditeur. Le contexte (clip slot,
/// lane GLOBALFX, lane MODULATION) est résolu par ScoreView qui
/// fournit les groupes de lignes déjà filtrés.
import React from 'react';

export interface ParamRow {
  id: string;
  active: boolean;
  hasData: boolean;
  title?: string;
  display?: string;
}
export interface ParamGroup {
  header?: string;
  rows: ParamRow[];
}

export const ScoreParamsPanel: React.FC<{
  /// Part de la zone haute allouée à la colonne paramètres (0–1).
  frac: number;
  /// Libellé de contexte affiché à droite du titre (lane/clip).
  contextLabel?: React.ReactNode;
  /// Sélecteur de stratégie de merge — contexte GLOBALFX seulement.
  showStrategy?: boolean;
  mergeStrategy?: string;
  onMergeStrategy?: (s: string) => void;
  /// Contexte MODULATION — champ de nommage d'une nouvelle valeur.
  modName?: string;
  onModNameChange?: (v: string) => void;
  onModNameCommit?: (name: string) => void;
  onSelectParam: (id: string) => void;
  groups: ParamGroup[];
  /// Contenu affiché quand `groups` est vide (ex. rien sélectionné).
  emptyContent?: React.ReactNode;
}> = ({
  frac, contextLabel, showStrategy, mergeStrategy, onMergeStrategy,
  modName, onModNameChange, onModNameCommit,
  onSelectParam, groups, emptyContent,
}) => (
  <div className="min-w-0 flex flex-col px-2 py-1.5 gap-1" style={{ flexGrow: frac, flexBasis: 0 }}>
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Paramètres</span>
      {contextLabel}
      {showStrategy && (
        <label className="flex items-center gap-1 text-[10px] text-gray-500" title="MergeStrategy — comment les moves simultanés se composent. État show global (aussi fixé par les cues et le node Merge du graphe Global FX).">
          stratégie
          <select
            value={mergeStrategy}
            onChange={(e) => onMergeStrategy?.(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-[10px] text-cyan-300"
          >
            <option value="override">override</option>
            <option value="crossfade">crossfade</option>
            <option value="blend">blend</option>
            <option value="priority">priority</option>
          </select>
        </label>
      )}
    </div>
    {modName !== undefined && (
      <input
        value={modName}
        onChange={(e) => onModNameChange?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && modName.trim()) onModNameCommit?.(modName.trim());
        }}
        placeholder="/score/energy — nom de la valeur"
        className="w-full bg-gray-800/60 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-amber-200 placeholder:text-gray-600 outline-none focus:border-amber-500"
      />
    )}
    <div className="flex-1 overflow-y-auto flex flex-col gap-0.5 pr-1">
      {groups.length === 0 && emptyContent}
      {groups.map((g, gi) => (
        <React.Fragment key={gi}>
          {g.header && <div className="px-1 pt-1 text-[9px] uppercase text-gray-600">{g.header}</div>}
          {g.rows.map((r) => (
            <button
              key={r.id}
              title={r.title}
              onClick={() => onSelectParam(r.id)}
              className={`w-full text-left px-2 py-1 text-[10px] font-bold rounded border ${
                r.active
                  ? 'border-cyan-500 text-cyan-300 bg-cyan-900/30'
                  : 'border-gray-700/60 text-gray-400 hover:text-gray-200 hover:bg-gray-800/40'
              }`}
            >
              {r.display ?? r.id}{r.hasData ? ' •' : ''}
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  </div>
);
