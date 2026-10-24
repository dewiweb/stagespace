import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { Move3d, Pencil } from 'lucide-react';

interface ModeButtonsProps {
  manipulateMode: boolean;
  setManipulateMode: (v: boolean) => void;
}

/**
 * Boutons toggle Manipulate / Draw — toujours visibles (sauf en draw mode).
 * Extrait de Scene3D. (L'assignation de tracks se fait dans la TrackGrid —
 * le mode assign 3D a été retiré.)
 */
export const ModeButtons: React.FC<ModeButtonsProps> = ({
  manipulateMode, setManipulateMode,
}) => {
  const drawMode = useGraphStore((s) => s.drawMode);
  const setDrawMode = useGraphStore((s) => s.setDrawMode);
  const hasDrawableNode = useGraphStore((s) =>
    s.nodes.some((n) =>
      n.data.type === 'DrawSpline' ||
      n.data.type === 'EvaluateSpline' ||
      n.data.type === 'TrimSpline' ||
      n.data.type === 'OffsetSpline' ||
      // Champ dessiné : le stroke devient des vecteurs tangents (lignes de flux)
      (n.data.type === 'VectorField' && (n.data.params as any)?.field === 'drawn')
    )
  );

  if (drawMode) return null;

  return (
    <>
      <div className="absolute bottom-2 left-2 z-overlay flex gap-1">
        <button
          onClick={() => setManipulateMode(!manipulateMode)}
          className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
            manipulateMode ? 'bg-blue-600 text-white' : 'bg-gray-900/80 text-gray-400 hover:text-white border border-gray-700'
          }`}
        >
          <Move3d size={11} className="inline -mt-0.5" /> Manipulate
        </button>
        {hasDrawableNode && (
          <button
            onClick={() => { setDrawMode(true); setManipulateMode(false); }}
            className="px-2.5 py-1 text-xs rounded font-medium transition-colors bg-gray-900/80 text-gray-400 hover:text-white border border-gray-700"
            title="Draw a freehand spline trajectory (or flow line for a drawn VectorField)"
          >
            <Pencil size={11} className="inline -mt-0.5" /> Draw
          </button>
        )}
      </div>
      {manipulateMode && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-overlay bg-gray-900/90 backdrop-blur rounded-lg px-3 py-1.5 border border-blue-600/50">
          <span className="text-blue-400 text-xs font-medium">
            <Move3d size={11} className="inline -mt-0.5" /> Manipulate — drag handle: move · shift+drag: rotate · scroll: scale · drag object: override
          </span>
        </div>
      )}
    </>
  );
};
