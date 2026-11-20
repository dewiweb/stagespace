import React from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { Move3d, MousePointerClick, Pencil } from 'lucide-react';
import { isDetachedWindow } from '../../utils/safeStorage';

/**
 * Groupe de modes — Manipulate / Assign / Draw — rendu INLINE dans la
 * ViewerToolbar (plus d'overlay flottant). En draw mode, seul un bouton
 * Exit est rendu (Esc reste le raccourci).
 * L'assign 3D passe par `toggleTrackSelection` — même source de vérité
 * que la TrackGrid.
 */
export const ModeButtons: React.FC = () => {
  const drawMode = useGraphStore((s) => s.drawMode);
  const setDrawMode = useGraphStore((s) => s.setDrawMode);
  const clearDrawnPoints = useGraphStore((s) => s.clearDrawnPoints);
  const manipulateMode = useGraphStore((s) => s.manipulateMode);
  const setManipulateMode = useGraphStore((s) => s.setManipulateMode);
  const assignMode = useGraphStore((s) => s.assignMode);
  const setAssignMode = useGraphStore((s) => s.setAssignMode);
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
    return (
      <button
        onClick={() => { clearDrawnPoints(); setDrawMode(false); }}
        className="px-2.5 py-1 text-xs rounded font-medium transition-colors bg-orange-700 text-white hover:bg-orange-600"
        title="Quitter le mode dessin (Esc)"
      >
        <Pencil size={11} className="inline -mt-0.5" /> Exit Draw
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setManipulateMode(!manipulateMode)}
        className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
          manipulateMode ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
        }`}
      >
        <Move3d size={11} className="inline -mt-0.5" /> Manipulate
      </button>
      {!detached && (
        <button
          onClick={() => setAssignMode(!assignMode)}
          className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
            assignMode ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
          }`}
          title="Assign mode — click objects in the scene to toggle their track"
        >
          <MousePointerClick size={11} className="inline -mt-0.5" /> Assign
        </button>
      )}
      {!detached && (
        <button
          onClick={() => hasDrawableNode && setDrawMode(true)}
          disabled={!hasDrawableNode}
          className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
            hasDrawableNode
              ? 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
              : 'bg-gray-900/40 text-gray-600 border border-gray-800 cursor-not-allowed'
          }`}
          title={hasDrawableNode
            ? 'Draw a freehand spline trajectory (or flow line for a drawn VectorField)'
            : 'No drawable node — add a DrawSpline / EvaluateSpline / VectorField(drawn) node first'}
        >
          <Pencil size={11} className="inline -mt-0.5" /> Draw
        </button>
      )}
    </>
  );
};

export default ModeButtons;
