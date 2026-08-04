import React from 'react';
import { useGraphStore } from '../store/useGraphStore';

/**
 * Overlay du mode Draw — slider Z + instructions + bouton Done.
 * Extrait de Scene3D.
 */
export const DrawModeOverlay: React.FC = () => {
  const drawZ = useGraphStore((s) => s.drawZ);
  const setDrawZ = useGraphStore((s) => s.setDrawZ);
  const clearDrawnPoints = useGraphStore((s) => s.clearDrawnPoints);
  const finalizeDrawing = useGraphStore((s) => s.finalizeDrawing);

  return (
    <>
      {/* Z slider overlay */}
      <div className="absolute top-2 left-2 z-20 bg-gray-900/80 backdrop-blur rounded-lg p-2 border border-orange-600/50 flex items-center gap-2">
        <span className="text-orange-400 text-[10px] font-mono">Z</span>
        <input
          type="range" min={-3} max={3} step={0.1} value={drawZ}
          onChange={(e) => setDrawZ(parseFloat(e.target.value))}
          className="w-24 h-1 accent-orange-500"
        />
        <span className="text-white text-[10px] font-mono w-8">{drawZ.toFixed(1)}</span>
        <button
          onClick={async () => { clearDrawnPoints(); await finalizeDrawing(); }}
          className="ml-2 px-2 py-0.5 text-[10px] bg-orange-600 hover:bg-orange-700 text-white rounded font-medium"
        >
          Done
        </button>
      </div>
      {/* Instructions */}
      <div className="absolute top-2 right-2 z-20 bg-gray-900/80 backdrop-blur rounded-lg px-3 py-1.5 border border-orange-600/50">
        <span className="text-orange-400 text-[10px] font-medium">
          ✎ Draw mode — click & drag on the scene
        </span>
      </div>
    </>
  );
};
