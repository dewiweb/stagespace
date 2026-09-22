import React from 'react';
import { debugPerf } from '../utils/debugPerf';

export const DebugPerfOverlay: React.FC = () => {
  const [, forceRender] = React.useState(0);

  React.useEffect(() => {
    let raf: number;
    let lastUpdate = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      // Update display ~5x/sec (pas 60fps — inutile)
      if (t - lastUpdate > 200) {
        forceRender((n) => n + 1);
        lastUpdate = t;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const show = debugPerf.mvts > 0 || debugPerf.renderFps > 0;
  if (!show) return null;

  const stutterColor = debugPerf.renderStutter > 0 ? 'text-red-400' : 'text-green-400';
  const ipcColor = debugPerf.ipcMaxGap > 25 ? 'text-red-400' : 'text-green-400';

  return (
    <div className="absolute top-2 left-2 z-30 bg-gray-900/90 backdrop-blur rounded-lg px-3 py-2 border border-gray-700/50 font-mono text-[10px] space-y-0.5">
      <div className="text-gray-500 uppercase tracking-wider text-[10px] mb-1">DEBUG PERF</div>
      <div className="flex gap-2">
        <span className="text-gray-500">Render:</span>
        <span className={stutterColor}>{debugPerf.renderFps.toFixed(0)} fps</span>
        <span className="text-gray-600">stutter:{debugPerf.renderStutter}</span>
      </div>
      <div className="flex gap-2">
        <span className="text-gray-500">IPC:</span>
        <span className={ipcColor}>{debugPerf.ipcFps.toFixed(0)} fps</span>
        <span className="text-gray-600">maxGap:{debugPerf.ipcMaxGap.toFixed(0)}ms</span>
      </div>
      <div className="flex gap-2">
        <span className="text-gray-500">Pos:</span>
        <span className="text-cyan-400">{debugPerf.posLen}</span>
        <span className="text-gray-600">mvts:{debugPerf.mvts}</span>
      </div>
      <div className="flex gap-2">
        <span className="text-gray-500">GL:</span>
        <span className={debugPerf.glMs > 15 ? 'text-red-400' : 'text-green-400'}>{debugPerf.glMs.toFixed(1)}ms</span>
        <span className="text-gray-500">Labels:</span>
        <span className={debugPerf.labelMs > 10 ? 'text-red-400' : 'text-green-400'}>{debugPerf.labelMs.toFixed(1)}ms</span>
      </div>
      <div className="flex gap-2">
        <span className="text-gray-500">Animate:</span>
        <span className={debugPerf.animateMs > 15 ? 'text-red-400' : 'text-green-400'}>{debugPerf.animateMs.toFixed(1)}ms</span>
      </div>
    </div>
  );
};
