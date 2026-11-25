import React from 'react';
import { MousePointer, Move3d, Link2, Pencil } from 'lucide-react';
import { useGraphStore } from '../../store/useGraphStore';
import { DRAWABLE_NODE_TYPES } from '../../utils/showFormat';
import { isDetachedWindow } from '../../utils/safeStorage';
import { DrawPaletteTools } from './DrawToolbar';

/**
 * Palette d'outils verticale — colonne gauche du layout éditeur.
 *
 * Section haute = outils de mode (convention éditeurs vectoriels : la
 * sélection de l'outil DÉFINIT le mode d'interaction) :
 * - Select   : neutre — cancelInteractionModes
 * - Manipulate / Assign / Draw : bascule dans le mode correspondant
 *
 * Section basse (draw mode) = DrawPaletteTools : sous-outils du studio.
 * La sélection de l'outil courant est lisible par la couleur d'accent.
 */
export const ViewerToolPalette: React.FC = () => {
  const drawMode = useGraphStore((s) => s.drawMode);
  const setDrawMode = useGraphStore((s) => s.setDrawMode);
  const manipulateMode = useGraphStore((s) => s.manipulateMode);
  const setManipulateMode = useGraphStore((s) => s.setManipulateMode);
  const assignMode = useGraphStore((s) => s.assignMode);
  const setAssignMode = useGraphStore((s) => s.setAssignMode);
  const cancelInteractionModes = useGraphStore((s) => s.cancelInteractionModes);
  const nodes = useGraphStore((s) => s.nodes);
  // Fenêtre ?view=run : store local à ce webview — assign/draw y
  // divergeraient de la fenêtre principale (le broadcast live:state ne
  // couvre pas l'édition). Manipulate agit via IPC backend → autorisé.
  const detached = isDetachedWindow();
  const hasDrawableNode = nodes.some(
    (n) =>
      (DRAWABLE_NODE_TYPES as readonly string[]).includes(n.data.type ?? '') ||
      (n.data.type === 'VectorField' && n.data.params?.field === 'drawn'),
  );

  const modeBtn = (
    active: boolean,
    accent: string,
    title: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled = false,
  ) => (
    <button
      key={title}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`w-7 h-7 flex items-center justify-center rounded transition-colors disabled:opacity-30 ${
        active ? `${accent}` : 'text-gray-400 hover:bg-gray-700/70 hover:text-gray-200'
      }`}
    >
      {icon}
    </button>
  );

  const noneActive = !manipulateMode && !assignMode && !drawMode;

  return (
    <div className="flex-shrink-0 w-9 flex flex-col items-center gap-0.5 py-1.5 bg-gray-900/95 border-r border-gray-700/60">
      {/* Outil Select = retour au neutre (équivaut Esc) */}
      {modeBtn(
        noneActive,
        'bg-gray-600 text-white',
        'Select — neutral mode (Esc)',
        <MousePointer size={13} />,
        () => cancelInteractionModes(),
      )}
      {modeBtn(
        manipulateMode,
        'bg-stagespace-accent text-gray-950',
        'Manipulate — drag objects, Shift+click = multi-select, handle = move all, wheel = scale',
        <Move3d size={13} />,
        () => setManipulateMode(!manipulateMode),
      )}
      {!detached &&
        modeBtn(
          assignMode,
          'bg-stagespace-accent text-gray-950',
          'Assign — click objects to toggle their track for this move',
          <Link2 size={13} />,
          () => setAssignMode(!assignMode),
        )}
      {!detached &&
        modeBtn(
          drawMode,
          'bg-stagespace-accent text-gray-950',
          hasDrawableNode
            ? 'Draw — spline studio (freehand, place, edit)'
            : 'No drawable node — add a DrawSpline / EvaluateSpline / VectorField(drawn) node first',
          <Pencil size={13} />,
          () => setDrawMode(!drawMode),
          !hasDrawableNode,
        )}
      {drawMode && <DrawPaletteTools />}
    </div>
  );
};

export default ViewerToolPalette;
