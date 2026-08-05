import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { useGraphStore, usePositionListener } from '../store/useGraphStore';
import { MacrosPanel } from './MacrosPanel';
import { DrawModeOverlay } from './DrawModeOverlay';
import { ModeButtons } from './ModeButtons';
import { TrajectoryVisualization } from './TrajectoryVisualization';
import { useHolMarkers } from '../hooks/useHolMarkers';
import { useObjects3D } from '../hooks/useObjects3D';
import { useManipulateHandle } from '../hooks/useManipulateHandle';
import { useInteractionModes } from '../hooks/useInteractionModes';
import { useDrawMode } from '../hooks/useDrawMode';
import { useManipulateMode } from '../hooks/useManipulateMode';
import { useRenderLoop } from '../hooks/useRenderLoop';

interface Scene3DProps {
  width?: string | number;
  height?: string | number;
}

const Scene3D: React.FC<Scene3DProps> = ({ width = '100%', height = '100%' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const labelRendererRef = useRef<CSS2DRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [webglFailed, setWebglFailed] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);

  const positions = useGraphStore((s) => s.positions);
  const isPlaying = useGraphStore((s) => s.isPlaying);
  const macros = useGraphStore((s) => s.macros);
  const nodes = useGraphStore((s) => s.nodes);
  const holProject = useGraphStore((s) => s.holProject);
  const selectedTrackIds = useGraphStore((s) => s.selectedTrackIds);
  const drawMode = useGraphStore((s) => s.drawMode);
  const drawnPoints = useGraphStore((s) => s.drawnPoints);

  // Manipulate mode (drag objects / handle in 3D)
  const [manipulateMode, setManipulateMode] = useState(false);
  // Assign mode — click objects to assign/unassign from trajectory
  const [assignMode, setAssignMode] = useState(false);

  // Multi-movement state — déclaré ici car utilisé par les refs ci-dessous
  const movementPositions = useGraphStore((s) => s.movementPositions);
  const movements = useGraphStore((s) => s.movements);
  const manualPositions = useGraphStore((s) => s.manualPositions);

  usePositionListener();

  // Determine object count from graph (Objects node or default 9)
  const nObjects = React.useMemo(() => {
    const objectsNode = nodes.find((n) => (n.data as any)?.type === 'Objects');
    return (objectsNode?.data as any)?.params?.n_objects ?? 9;
  }, [nodes]);

  // ── Hooks extraits (création des objets 3D, marqueurs, handle, modes) ──
  const { holMarkersRef } = useHolMarkers({ sceneRef, cameraRef, holProject });
  const { objectsRef } = useObjects3D({ sceneRef, nObjects, sceneReady });
  const { handleRef, trajectoryLineRef } = useManipulateHandle({ sceneRef, manipulateMode });
  useInteractionModes({ controlsRef, rendererRef, drawMode, manipulateMode, assignMode });

  // ── Hooks extraits (handlers d'interaction) ──
  const { drawCanvasRef, handleDrawStart, handleDrawMove, handleDrawEnd } =
    useDrawMode({ cameraRef, containerRef });
  const {
    draggingObject,
    draggingHandle,
    draggingObjectRef,
    handleManipulateDown,
    handleManipulateMove,
    handleManipulateUp,
    handleManipulateWheel,
  } = useManipulateMode({
    cameraRef,
    containerRef,
    objectsRef,
    handleRef,
    manipulateMode,
    assignMode,
  });

  // Resize observer — merge du handle resize en un seul effect
  // Met à jour directement les refs Three.js (pas de re-render React)
  useEffect(() => {
    if (!containerRef.current) return;
    const updateDimensions = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const w = Math.max(rect.width, 100);
      const h = Math.max(rect.height, 100);
      setDimensions({ width: w, height: h });
      // Mise à jour directe des refs Three.js — évite un useEffect séparé
      if (cameraRef.current && rendererRef.current && labelRendererRef.current) {
        cameraRef.current.aspect = w / h;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(w, h);
        labelRendererRef.current.setSize(w, h);
      }
    };
    const ro = new ResizeObserver(updateDimensions);
    ro.observe(containerRef.current);
    updateDimensions();
    return () => ro.disconnect();
  }, []);

  // ── Render loop critique 60fps (scène + animate) ──
  // Placé APRÈS le ResizeObserver pour préserver l'ordre d'exécution des effects
  useRenderLoop({
    containerRef,
    sceneRef,
    cameraRef,
    rendererRef,
    labelRendererRef,
    controlsRef,
    objectsRef,
    holMarkersRef,
    handleRef,
    trajectoryLineRef,
    drawCanvasRef,
    positions,
    movements,
    movementPositions,
    macros,
    assignMode,
    selectedTrackIds,
    holProject,
    drawnPoints,
    draggingObjectRef,
    manualPositions,
    setWebglFailed,
    dimensions,
  });

  // Détecter quand la scène est initialisée (useRenderLoop mutate sceneRef.current)
  // pour déclencher la création des objets dans useObjects3D
  useEffect(() => {
    if (sceneReady) return;
    if (sceneRef.current) {
      setSceneReady(true);
      return;
    }
    // La scène n'est pas encore prête — re-vérifier au prochain tick
    const id = setTimeout(() => {
      if (sceneRef.current) setSceneReady(true);
    }, 0);
    return () => clearTimeout(id);
  }, [sceneReady]);

  // Render loop (scène + animate 60fps) → useRenderLoop hook ci-dessus
  // Handle resize → fusionné dans le ResizeObserver ci-dessus
  // .hol tracks markers + labels → useHolMarkers hook
  // Objects sphères + labels → useObjects3D hook
  // TrajectoryVisualization → composant séparé (voir <TrajectoryVisualization /> ci-dessous)
  // Toggle OrbitControls + pointer events → useInteractionModes hook
  // Build trajectory handle + line → useManipulateHandle hook
  // Manipulate handlers → useManipulateMode hook
  // Draw handlers → useDrawMode hook

  return (
    <div ref={containerRef} style={{ width, height, overflow: 'hidden', position: 'relative' }}>
      {webglFailed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-900/90 z-30 p-4">
          <div className="text-4xl">⚠️</div>
          <div className="text-white text-sm font-medium">WebGL unavailable</div>
          <div className="text-gray-400 text-[11px] text-center max-w-xs">
            GPU acceleration is blocked in this environment (sandboxed WebKit).
            <br />
            The 3D preview needs WebGL. You can still use the node editor, cues, macros, and OSC output.
          </div>
          <button
            onClick={() => {
              setWebglFailed(false);
              // Force re-mount by toggling dimensions
              setDimensions((d) => ({ ...d }));
            }}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded"
          >
            Retry
          </button>
        </div>
      )}
      {drawMode && <DrawModeOverlay />}
      {manipulateMode && <MacrosPanel isPlaying={isPlaying} hasMovements={movements.length > 0} />}
      <ModeButtons
        manipulateMode={manipulateMode}
        assignMode={assignMode}
        setManipulateMode={setManipulateMode}
        setAssignMode={setAssignMode}
      />
      {/* Trajectory visualization — composant séparé qui gère ses propres lignes */}
      <TrajectoryVisualization
        sceneRef={sceneRef}
        objectsRef={objectsRef}
        isPlaying={isPlaying}
        hasMovements={movements.length > 0}
        nObjects={nObjects}
      />
      <canvas
        ref={drawCanvasRef}
        className="absolute inset-0 z-10"
        style={{
          width: '100%',
          height: '100%',
          pointerEvents: drawMode ? 'auto' : 'none',
          cursor: drawMode ? 'crosshair' : 'default',
        }}
        onPointerDown={handleDrawStart}
        onPointerMove={handleDrawMove}
        onPointerUp={handleDrawEnd}
        onPointerCancel={handleDrawEnd}
      />
      {/* Manipulate interaction layer */}
      {manipulateMode && (
        <div
          className="absolute inset-0 z-[15]"
          style={{ cursor: draggingHandle || draggingObject !== null ? 'grabbing' : 'grab' }}
          onPointerDown={handleManipulateDown}
          onPointerMove={handleManipulateMove}
          onPointerUp={handleManipulateUp}
          onPointerCancel={handleManipulateUp}
          onWheel={handleManipulateWheel}
        />
      )}
      {/* Active movements indicator — bottom right */}
      {movements.length > 0 && (
        <div className="absolute bottom-2 right-2 z-20 bg-gray-900/80 backdrop-blur rounded-lg px-2 py-1 border border-gray-700/50 flex items-center gap-1.5">
          <span className="text-gray-500 text-[9px] font-mono">MOVEMENTS</span>
          {movements.map((mv, idx) => (
            <span
              key={mv.id}
              className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                mv.is_preview ? 'bg-cyan-900 text-cyan-400' : 'bg-green-900 text-green-400'
              }`}
              title={`${mv.name} — ${mv.track_count} tracks`}
            >
              {idx + 1}{mv.is_preview ? '👁' : '▶'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default Scene3D;
