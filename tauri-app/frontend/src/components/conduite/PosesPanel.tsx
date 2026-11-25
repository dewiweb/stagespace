/// Panel Poses — presets de positions nommés (P1, design :
/// docs/position-presets-design.md). Auto-contenu : lit `usePoseStore`
/// directement (les poses sont backend-owned — `invoke` atteint le
/// backend depuis n'importe quelle fenêtre, pas besoin du broadcast
/// de la conduite). Refresh au mount ; mutations → refresh auto.
import React, { useEffect, useState } from 'react';
import { usePoseStore } from '../../store/usePoseStore';
import { useGraphStore } from '../../store/useGraphStore';
import { doPoseCapture, doPoseSnap, doPoseGoto, doPoseMorph } from '../../utils/liveActions';

/// Layout-agnostic — le host décide du cadre (colonne Conduite, tab
/// Atelier, drawer Jeu). `fill` = colonne flex verticale (défaut) ;
/// sans fill le panel s'intègre dans un conteneur scrollable horizontal.
export const PosesPanel: React.FC<{ fill?: boolean }> = ({ fill = true }) => {
  const poses = usePoseStore((s) => s.poses);
  const selectedPoseName = usePoseStore((s) => s.selectedPoseName);
  const selectPose = usePoseStore((s) => s.selectPose);
  const refreshPoses = usePoseStore((s) => s.refreshPoses);
  const deletePose = usePoseStore((s) => s.deletePose);
  const selectedTrackIds = useGraphStore((s) => s.selectedTrackIds);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const [newName, setNewName] = useState('');
  const [gotoDuration, setGotoDuration] = useState(2.0);
  // Source du morph — une seule pose « A » à la fois ; chaque autre
  // row expose alors son bouton morph A→elle.
  const [morphSource, setMorphSource] = useState<string | null>(null);

  useEffect(() => {
    void refreshPoses();
  }, [refreshPoses]);

  const capture = () => {
    const name = newName.trim();
    if (!name) return;
    // Sélection active = la distribution de la capture ; sinon toutes
    // les positions connues (undefined → backend capture tout).
    const sel = Array.from(selectedTrackIds).filter((t) => manualOscIds.includes(t));
    doPoseCapture(name, sel.length ? sel : undefined);
    setNewName('');
  };

  return (
    <div className={fill ? 'flex flex-col flex-1 min-h-0' : 'flex flex-col'}>
      <div className="px-3 py-2 text-[10px] text-gray-500 uppercase tracking-widest border-b border-gray-800 flex items-center justify-between">
        <span>Poses — position presets</span>
        <label className="flex items-center gap-1 normal-case tracking-normal" title="Goto ramp duration (seconds)">
          <span className="text-gray-600">goto</span>
          <input
            type="number"
            min={0.2}
            step={0.5}
            value={gotoDuration}
            onChange={(e) => setGotoDuration(Math.max(0.2, Number(e.target.value) || 2.0))}
            className="w-12 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[10px] text-gray-300 focus:border-stagespace-accent focus:outline-none"
          />
          <span className="text-gray-600">s</span>
        </label>
      </div>

      {/* Capture — nom + tracks sélectionnées (ou toutes). */}
      <div className="px-2 py-2 border-b border-gray-800 flex gap-1">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') capture();
          }}
          placeholder="pose name…"
          className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:border-stagespace-accent focus:outline-none"
        />
        <button
          onClick={capture}
          disabled={!newName.trim()}
          className="px-2 py-1 rounded bg-stagespace-accent/20 hover:bg-stagespace-accent/30 text-stagespace-info text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed"
          title={
            selectedTrackIds.size > 0
              ? `Capture ${selectedTrackIds.size} selected track(s) at their current positions`
              : 'Capture ALL known positions'
          }
        >
          ● cap
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {poses.map((p) => {
          const ntracks = Object.keys(p.positions).length;
          const patched = Object.keys(p.positions).filter((t) =>
            manualOscIds.includes(Number(t))
          ).length;
          return (
            <div
              key={p.name}
              className="px-3 py-2 flex items-center gap-2 text-sm text-gray-300 hover:bg-gray-800/50 group"
            >
              <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => selectPose(selectedPoseName === p.name ? null : p.name)}
                title={
                  selectedPoseName === p.name
                    ? 'Hide pose ghosts in the 3D view'
                    : 'Show pose targets as ghosts in the 3D view'
                }
              >
                <div className={`truncate ${selectedPoseName === p.name ? 'text-stagespace-accent font-semibold' : ''}`}>
                  {selectedPoseName === p.name ? '◈ ' : ''}{p.name}
                </div>
                <div
                  className={`text-[10px] ${patched < ntracks ? 'text-stagespace-warning' : 'text-gray-600'}`}
                  title={
                    patched < ntracks
                      ? `${ntracks - patched} track(s) not patched — skipped at recall`
                      : `${ntracks} track(s)`
                  }
                >
                  {patched < ntracks ? `${patched}/${ntracks} tracks ⚠` : `${ntracks} tracks`}
                </div>
              </div>
              <button
                onClick={() => setMorphSource(morphSource === p.name ? null : p.name)}
                className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                  morphSource === p.name
                    ? 'bg-stagespace-target/25 text-white'
                    : 'bg-gray-800 text-gray-500 hover:text-stagespace-target opacity-70 group-hover:opacity-100'
                }`}
                title={
                  morphSource === p.name
                    ? 'Morph source A — click to unselect'
                    : 'Select as morph source A (then hit A→B on the target pose)'
                }
              >
                A
              </button>
              {morphSource && morphSource !== p.name && (
                <button
                  onClick={() => doPoseMorph(morphSource, p.name, gotoDuration)}
                  className="px-1.5 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs"
                  title={`Morph '${morphSource}' → '${p.name}' in ${gotoDuration}s — objects absent from the source start from their live positions`}
                >
                  A→B
                </button>
              )}
              <button
                onClick={() => doPoseGoto(p.name, gotoDuration)}
                className="px-2 py-0.5 rounded bg-gray-800 hover:bg-stagespace-target/15 text-gray-400 hover:text-stagespace-target text-xs opacity-70 group-hover:opacity-100"
                title={`Goto — ramp objects to this pose in ${gotoDuration}s (smooth, holds the target at the end)`}
              >
                goto
              </button>
              <button
                onClick={() => doPoseSnap(p.name)}
                className="px-2 py-0.5 rounded bg-gray-800 hover:bg-stagespace-target/15 text-gray-400 hover:text-stagespace-target text-xs opacity-70 group-hover:opacity-100"
                title="Snap — instant recall (manual positions, partial: other tracks untouched)"
              >
                snap
              </button>
              <button
                onClick={() => void deletePose(p.name)}
                className="px-1 py-0.5 rounded text-gray-600 hover:text-stagespace-danger text-xs opacity-0 group-hover:opacity-100"
                title="Delete pose"
              >
                ×
              </button>
            </div>
          );
        })}
        {poses.length === 0 && (
          <div className="px-3 py-4 text-gray-600 text-xs">
            No poses — place objects, then capture.
          </div>
        )}
      </div>
    </div>
  );
};

export default PosesPanel;
