import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { Move3d, MousePointerClick, Pencil } from 'lucide-react';
import { ModeBanner } from './ui/ModeBanner';
import { isDetachedWindow } from '../utils/safeStorage';

interface ModeButtonsProps {
  manipulateMode: boolean;
  setManipulateMode: (v: boolean) => void;
  assignMode: boolean;
  setAssignMode: (v: boolean) => void;
}

/**
 * Boutons toggle Manipulate / Assign / Draw — toujours visibles (sauf en draw mode).
 * Extrait de Scene3D. L'assign 3D passe par `toggleTrackSelection` — même
 * source de vérité que la TrackGrid.
 */
export const ModeButtons: React.FC<ModeButtonsProps> = ({
  manipulateMode, setManipulateMode, assignMode, setAssignMode,
}) => {
  const drawMode = useGraphStore((s) => s.drawMode);
  const setDrawMode = useGraphStore((s) => s.setDrawMode);
  const clearDrawnPoints = useGraphStore((s) => s.clearDrawnPoints);
  // Fenêtre ?view=run : son store est local à ce webview — assign/draw
  // y écriraient un état qui diverge de la fenêtre principale sans
  // persister (le broadcast live:state ne couvre pas l'édition). Seul
  // Manipulate y reste utile : il agit via IPC backend, pas le store.
  const detached = isDetachedWindow();
  const hasDrawableNode = useGraphStore((s) =>
    s.nodes.some((n) =>
      n.data.type === 'DrawSpline' ||
      n.data.type === 'EvaluateSpline' ||
      n.data.type === 'TrimSpline' ||
      n.data.type === 'OffsetSpline' ||
      // Champ dessiné : le stroke devient des vecteurs tangents (lignes de flux)
      (n.data.type === 'VectorField' && n.data.params?.field === 'drawn')
    )
  );

  if (drawMode) {
    // Une sortie de mode au clic — les couches interactives couvrent le
    // canvas, le bouton doit rester accessible (Esc reste le raccourci).
    return (
      <div className="absolute bottom-2 left-2 z-raised flex gap-1">
        <button
          onClick={() => { clearDrawnPoints(); setDrawMode(false); }}
          className="px-2.5 py-1 text-xs rounded font-medium transition-colors bg-orange-700 text-white hover:bg-orange-600"
          title="Quitter le mode dessin (Esc)"
        >
          <Pencil size={11} className="inline -mt-0.5" /> Exit Draw
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="absolute bottom-2 left-2 z-raised flex gap-1">
        <button
          onClick={() => setManipulateMode(!manipulateMode)}
          className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
            manipulateMode ? 'bg-blue-600 text-white' : 'bg-gray-900/80 text-gray-400 hover:text-white border border-gray-700'
          }`}
        >
          <Move3d size={11} className="inline -mt-0.5" /> Manipulate
        </button>
        {!detached && (
          <button
            onClick={() => setAssignMode(!assignMode)}
            className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
              assignMode ? 'bg-green-600 text-white' : 'bg-gray-900/80 text-gray-400 hover:text-white border border-gray-700'
            }`}
            title="Assign mode — click objects in the scene to toggle their track"
          >
            <MousePointerClick size={11} className="inline -mt-0.5" /> Assign
          </button>
        )}
        {!detached && hasDrawableNode && (
          <button
            onClick={() => setDrawMode(true)}
            className="px-2.5 py-1 text-xs rounded font-medium transition-colors bg-gray-900/80 text-gray-400 hover:text-white border border-gray-700"
            title="Draw a freehand spline trajectory (or flow line for a drawn VectorField)"
          >
            <Pencil size={11} className="inline -mt-0.5" /> Draw
          </button>
        )}
      </div>
      {manipulateMode && (
        <ModeBanner variant="tracking">
          <Move3d size={11} className="inline -mt-0.5" /> Manipulate — drag handle: move · shift+drag: rotate · scroll: scale · drag object: override (Esc to cancel)
        </ModeBanner>
      )}
    </>
  );
};
