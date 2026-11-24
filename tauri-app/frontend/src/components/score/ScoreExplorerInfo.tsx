/// Fiche « mediainfo » de l'item sélectionné dans la bibliothèque
/// (explorer de clips — colonne PARAMÈTRES du score) : lecture seule
/// des caractéristiques d'un move slot ou d'une cue, + insertion au
/// playhead (alternative au drag & drop vers la timeline).
import React from 'react';
import { extractDuration, type MoveSlot } from '../../store/slices/moveSlotsTypes';
import type { Cue } from '../../types/generated/Cue';

export type ExplorerItem =
  | { kind: 'slot'; slot: MoveSlot }
  | { kind: 'cue'; cue: Cue; index: number };

const Row: React.FC<{ k: string; children: React.ReactNode }> = ({ k, children }) => (
  <div className="flex items-baseline gap-2">
    <span className="w-24 shrink-0 text-gray-500">{k}</span>
    <span className="text-gray-300 min-w-0">{children}</span>
  </div>
);

export const ScoreExplorerInfo: React.FC<{
  item: ExplorerItem;
  /// Insère le clip au playhead (même payload que le drag & drop).
  onInsert: () => void;
}> = ({ item, onInsert }) => {
  const s = item.kind === 'slot' ? item.slot : null;
  const c = item.kind === 'cue' ? item.cue : null;

  const durMs = s?.graphJson ? extractDuration(s.graphJson.nodes) * 1000 : null;
  const nodeCount = s?.graphJson?.nodes?.length ?? null;

  return (
    <div className="flex-1 min-w-0 overflow-y-auto px-3 py-2 text-[10px] text-gray-400">
      <div className="font-bold text-gray-200 mb-2">
        {s ? s.name : `CUE ${c!.cue_number ?? (item.kind === 'cue' ? item.index + 1 : '')} ${c!.name}`}
      </div>
      <div className="flex flex-col gap-1 max-w-md">
        <Row k="type">{s ? 'move (slot)' : 'cue — recall de snapshot'}</Row>
        {s && (
          <>
            <Row k="template">{s.templateId}</Row>
            <Row k="objets">{s.trackIds.length ? s.trackIds.map((t) => `T${t}`).join(' ') : '—'}</Row>
            <Row k="durée">{durMs != null ? `${(durMs / 1000).toFixed(1)} s` : '—'}</Row>
            <Row k="lecture">
              {s.loopMode}
              {s.direction !== 'forward' ? ` · ${s.direction}` : ''}
              {s.loopMode === 'oneshot' ? ` · fin ${s.endMode ?? 'revert'}` : ''}
            </Row>
            <Row k="ancre">{s.anchorMode ?? 'origin'}{s.anchorMode === 'follow' && s.anchorTarget != null ? ` → T${s.anchorTarget}` : ''}</Row>
            <Row k="graphe">{nodeCount != null ? `${nodeCount} node(s)` : 'aucun'}</Row>
            <Row k="fades">{`${s.fadeIn}s in · ${s.fadeOut}s out (cycle) · ${s.fadeDuration}s (activation)`}</Row>
            {s.oscIndex > 0 && <Row k="/stagespace/slot">{s.oscIndex}</Row>}
          </>
        )}
        {c && (
          <>
            <Row k="mode">{c.mode}</Row>
            <Row k="moves">{c.moves.length ? `${c.moves.length} move(s) snapshotés` : 'aucun'}</Row>
            {(c.zones?.length ?? 0) > 0 && <Row k="zones">{c.zones!.length}</Row>}
            {(c.channel_modulations?.length ?? 0) > 0 && <Row k="chanMods">{c.channel_modulations!.length}</Row>}
            {Object.keys(c.manual_positions ?? {}).length > 0 && (
              <Row k="pos. manuelles">{Object.keys(c.manual_positions).length}</Row>
            )}
            {c.pre_wait > 0 && <Row k="pre-wait">{c.pre_wait}s</Row>}
            {c.follow != null && <Row k="follow">{c.follow}s</Row>}
            {c.timecode != null && <Row k="timecode">{c.timecode}</Row>}
          </>
        )}
        <div className="mt-2 flex items-center gap-2">
          <button
            className="hover:text-gray-200 border border-gray-700 rounded px-2 py-0.5"
            title="Insérer ce clip au playhead sur la lane appropriée"
            onClick={onInsert}
          >⤵ insérer au playhead</button>
          <span className="text-gray-600 italic">ou glisser sur la timeline</span>
        </div>
      </div>
    </div>
  );
};
