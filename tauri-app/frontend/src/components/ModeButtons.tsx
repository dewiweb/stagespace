import React from 'react';
import { useGraphStore } from '../store/useGraphStore';

interface ModeButtonsProps {
  manipulateMode: boolean;
  assignMode: boolean;
  setManipulateMode: (v: boolean) => void;
  setAssignMode: (v: boolean) => void;
}

/**
 * Boutons toggle Manipulate / Assign — toujours visibles (sauf en draw mode).
 * Extrait de Scene3D.
 */
export const ModeButtons: React.FC<ModeButtonsProps> = ({
  manipulateMode, assignMode, setManipulateMode, setAssignMode,
}) => {
  const drawMode = useGraphStore((s) => s.drawMode);
  const selectedTrackIds = useGraphStore((s) => s.selectedTrackIds);

  if (drawMode) return null;

  return (
    <>
      <div className="absolute bottom-2 left-2 z-20 flex gap-1">
        <button
          onClick={() => { setManipulateMode(!manipulateMode); setAssignMode(false); }}
          className={`px-2.5 py-1 text-[10px] rounded font-medium transition-colors ${
            manipulateMode ? 'bg-blue-600 text-white' : 'bg-gray-900/80 text-gray-400 hover:text-white border border-gray-700'
          }`}
        >
          ✥ Manipulate
        </button>
        <button
          onClick={() => { setAssignMode(!assignMode); setManipulateMode(false); }}
          className={`px-2.5 py-1 text-[10px] rounded font-medium transition-colors ${
            assignMode ? 'bg-green-600 text-white' : 'bg-gray-900/80 text-gray-400 hover:text-white border border-gray-700'
          }`}
          title="Click objects to assign/unassign them from the trajectory"
        >
          ⊕ Assign
        </button>
      </div>
      {assignMode && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-gray-900/90 backdrop-blur rounded-lg px-3 py-1.5 border border-green-600/50">
          <span className="text-green-400 text-[10px] font-medium">
            ⊕ Assign mode — click objects to toggle assignment ({selectedTrackIds.size} selected)
          </span>
        </div>
      )}
      {manipulateMode && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-gray-900/90 backdrop-blur rounded-lg px-3 py-1.5 border border-blue-600/50">
          <span className="text-blue-400 text-[10px] font-medium">
            ✥ Manipulate — drag handle: move · shift+drag: rotate · scroll: scale · drag object: override
          </span>
        </div>
      )}
    </>
  );
};
