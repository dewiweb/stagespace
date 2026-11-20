import React from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { useMoveEditorStore } from '../../store/useMoveEditorStore';
import { debugPerf } from '../../utils/debugPerf';
import { ObjectInspectBar } from './ObjectInspectBar';

/// Métriques perf en une ligne — remplace l'ancien overlay flottant
/// top-left. Opt-in via le toggle canvas (debugPerfVisible).
const PerfStrip: React.FC = () => {
  const [, forceRender] = React.useState(0);
  React.useEffect(() => {
    let raf: number;
    let lastUpdate = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      // Update ~5x/sec (pas 60fps — inutile)
      if (t - lastUpdate > 200) {
        forceRender((n) => n + 1);
        lastUpdate = t;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const fpsCls = debugPerf.renderStutter > 0 ? 'text-red-400' : 'text-green-400';
  const ipcCls = debugPerf.ipcMaxGap > 25 ? 'text-red-400' : 'text-green-400';
  const glCls = debugPerf.glMs > 15 ? 'text-red-400' : 'text-green-400';
  const animCls = debugPerf.animateMs > 15 ? 'text-red-400' : 'text-green-400';

  return (
    <span
      className="flex items-center gap-1.5 text-[10px] font-mono whitespace-nowrap"
      title={`Render ${debugPerf.renderFps.toFixed(0)}fps stutter:${debugPerf.renderStutter} · IPC ${debugPerf.ipcFps.toFixed(0)}fps maxGap:${debugPerf.ipcMaxGap.toFixed(0)}ms · GL ${debugPerf.glMs.toFixed(1)}ms labels ${debugPerf.labelMs.toFixed(1)}ms anim ${debugPerf.animateMs.toFixed(1)}ms`}
    >
      <span className="text-gray-600">PERF</span>
      <span className={fpsCls}>{debugPerf.renderFps.toFixed(0)}fps</span>
      <span className={ipcCls} title="IPC position rate / max gap">ipc{debugPerf.ipcFps.toFixed(0)}·{debugPerf.ipcMaxGap.toFixed(0)}ms</span>
      <span className="text-cyan-400" title="positions / movements">p{debugPerf.posLen}·m{debugPerf.mvts}</span>
      <span className={glCls} title="GL frame / labels ms">gl{debugPerf.glMs.toFixed(1)}·lb{debugPerf.labelMs.toFixed(1)}</span>
      <span className={animCls} title="Animate ms">an{debugPerf.animateMs.toFixed(1)}</span>
    </span>
  );
};

/**
 * Status bar dockée en bas de la surface 3D — remplace les indicateurs
 * flottants (chips movements bottom-right, inspect bar bottom-center,
 * overlay debug perf top-left). Rendue uniquement quand il y a du
 * contenu (movements, sélection, ou debug perf actif).
 */
export const ViewerStatusBar: React.FC = () => {
  const movements = useGraphStore((s) => s.movements);
  const selectedObjIndex = useGraphStore((s) => s.selectedObjIndex);
  const emittedPositions = useGraphStore((s) => s.emittedPositions);
  const debugPerfVisible = useMoveEditorStore((s) => s.debugPerfVisible);
  const perfActive = debugPerfVisible && (debugPerf.mvts > 0 || debugPerf.renderFps > 0);

  if (movements.length === 0 && selectedObjIndex === null && !perfActive) return null;

  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-1.5 py-0.5 bg-gray-900/95 border-t border-gray-700/60 min-h-[26px]">
      {movements.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500 text-[10px] font-mono">MOVEMENTS</span>
          {movements.map((mv, idx) => (
            <span
              key={mv.id}
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                mv.is_preview ? 'bg-cyan-900 text-cyan-400' : 'bg-green-900 text-green-400'
              }`}
              title={`${mv.name} — ${mv.track_count} tracks`}
            >
              {idx + 1}{mv.is_preview ? '👁' : '▶'}
            </span>
          ))}
        </div>
      )}
      <span className="flex-1" />
      {selectedObjIndex !== null && <ObjectInspectBar positions={emittedPositions} />}
      {perfActive && <PerfStrip />}
    </div>
  );
};

export default ViewerStatusBar;
