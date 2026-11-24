/// Colonne « Paramètres » de la zone haute du score — sélection de la
/// courbe éditée dans la colonne éditeur. Le contexte (clip slot,
/// lane GLOBALFX, lane MODULATION) est résolu par ScoreView qui
/// fournit les groupes de lignes déjà filtrés.
import React from 'react';
import { SCORE_DRAG_MIME } from '../../utils/scoreDopesheet';

export interface ParamRow {
  id: string;
  active: boolean;
  hasData: boolean;
  title?: string;
  display?: string;
  /// Payload JSON de drag&drop (bibliothèque → timeline) — la ligne
  /// devient draggable vers une lane (`SCORE_DRAG_MIME`).
  dragPayload?: string;
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
  /// Mode compact à hauteur fixe (dopesheet) — les rangées s'alignent
  /// pixel-pour-pixel sur les rangées du plot voisin.
  rowHeight?: number;
  headerHeight?: number;
  /// Scroll vertical synchronisé avec le plot (dopesheet).
  scrollTop?: number;
  onVScroll?: (top: number) => void;
  /// Onglets de navigation entre les vues de la zone haute
  /// (contexte / dopesheet / bibliothèque) — rendus sous le titre
  /// quand plus d'une vue est disponible.
  tabs?: { id: string; label: string }[];
  activeTab?: string;
  onTab?: (id: string) => void;
}> = ({
  frac, contextLabel, showStrategy, mergeStrategy, onMergeStrategy,
  modName, onModNameChange, onModNameCommit,
  onSelectParam, groups, emptyContent,
  rowHeight, headerHeight, scrollTop, onVScroll,
  tabs, activeTab, onTab,
}) => {
  /// Scroll vertical piloté par le plot voisin (dopesheet).
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (scrollTop !== undefined && listRef.current && listRef.current.scrollTop !== scrollTop)
      listRef.current.scrollTop = scrollTop;
  }, [scrollTop]);
  return (
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
    {tabs && tabs.length > 1 && (
      <div className="flex gap-px rounded bg-gray-800/50 p-px shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onTab?.(t.id)}
            className={`flex-1 px-1 py-0.5 rounded-sm text-[9px] uppercase tracking-wide ${
              activeTab === t.id
                ? 'bg-gray-700 text-cyan-300'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    )}
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
    <div
      ref={listRef}
      className={`flex-1 overflow-y-auto flex flex-col pr-1 ${rowHeight ? '' : 'gap-0.5'}`}
      onScroll={onVScroll ? (e) => onVScroll(e.currentTarget.scrollTop) : undefined}
    >
      {groups.length === 0 && emptyContent}
      {groups.map((g, gi) => (
        <React.Fragment key={gi}>
          {g.header && (
            <div
              className="px-1 text-[9px] uppercase text-gray-600 flex items-end"
              style={headerHeight ? { height: headerHeight } : { paddingTop: 4 }}
            >{g.header}</div>
          )}
          {g.rows.map((r) => (
            <button
              key={r.id}
              title={r.title}
              onClick={() => onSelectParam(r.id)}
              draggable={!!r.dragPayload}
              onDragStart={r.dragPayload
                ? (e) => {
                    e.dataTransfer.setData(SCORE_DRAG_MIME, r.dragPayload!);
                    e.dataTransfer.effectAllowed = 'copy';
                  }
                : undefined}
              style={rowHeight ? { height: rowHeight } : undefined}
              className={`w-full text-left px-2 ${rowHeight ? 'py-0 flex items-center' : 'py-1'} text-[10px] font-bold rounded border ${r.dragPayload ? 'cursor-grab ' : ''}${
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
};
