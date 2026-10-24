import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { useGraphStore } from '../store/useGraphStore';
import { useAnimationStore } from '../store/useAnimationStore';
import { TriangleAlert } from 'lucide-react';
import { MacrosPanel } from './MacrosPanel';
import { DebugPerfOverlay } from './DebugPerfOverlay';
import { debugPerf } from '../utils/debugPerf';

// Exposer debugPerf sur window pour le render loop et le listener IPC
(window as any).__debugPerf = debugPerf;
import { DrawModeOverlay } from './DrawModeOverlay';
import { ModeButtons } from './ModeButtons';
import { TrajectoryVisualization } from './TrajectoryVisualization';
import { ZoneVisualization } from './ZoneVisualization';
import { useHolMarkers } from '../hooks/useHolMarkers';
import { useObjects3D } from '../hooks/useObjects3D';
import { useManipulateHandle } from '../hooks/useManipulateHandle';
import { useInteractionModes } from '../hooks/useInteractionModes';
import { useDrawMode } from '../hooks/useDrawMode';
import { useManipulateMode } from '../hooks/useManipulateMode';
import { useRenderLoop } from '../hooks/useRenderLoop';
import { fromThree } from '../utils/coords';

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

  const isPlaying = useGraphStore((s) => s.isPlaying);
  const macros = useGraphStore((s) => s.macros);
  const nodes = useGraphStore((s) => s.nodes);
  const holProject = useGraphStore((s) => s.holProject);
  const drawMode = useGraphStore((s) => s.drawMode);
  const drawnPoints = useGraphStore((s) => s.drawnPoints);

  // Modes d'interaction — slice du store (le handler Esc global peut les
  // annuler avant le panic ; mutual exclusion gérée par le slice)
  const manipulateMode = useGraphStore((s) => s.manipulateMode);
  const setManipulateMode = useGraphStore((s) => s.setManipulateMode);
  const assignMode = useGraphStore((s) => s.assignMode);
  const setAssignMode = useGraphStore((s) => s.setAssignMode);
  const zonePlaceMode = useGraphStore((s) => s.zonePlaceMode);

  // Multi-movement state — movements et movementPositions sont lus via getState()
  // dans useRenderLoop pour éviter 60 re-renders/seconde.
  // On garde movements pour le useMemo nObjects et le rendu conditionnel.
  const movements = useGraphStore((s) => s.movements);
  const manualPositions = useGraphStore((s) => s.manualPositions);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const editingSlotId = useGraphStore((s) => s.editingSlotId);
  const debugPerfVisible = useAnimationStore((s) => s.debugPerfVisible);

  // Determine object count — utilise le max entre:
  // - le node Objects du slot sélectionné
  // - le nombre total de tracks du projet holophonix
  // - le nombre d'osc_ids manuels (l'espace d'indexation complet : la
  //   sélection peut viser les derniers indices — ex "2ème moitié" sur 8
  //   tracks = indices 4-7, il faut le pool entier même si n_objects=4)
  // - le nombre total d'osc_ids uniques across tous les moves actifs
  const nObjects = React.useMemo(() => {
    const objectsNode = nodes.find((n) => (n.data as any)?.type === 'Objects');
    const fromGraph = (objectsNode?.data as any)?.params?.n_objects ?? 0;
    const fromProject = holProject?.tracks?.length ?? 0;
    // Le nombre d'objets doit couvrir le track_index maximum envoyé par le backend.
    // Les positions sont indexées par track_indices (ex: 0,1,10,11 → il faut au moins 12 meshes).
    // On calcule le max track_index depuis les osc_ids des moves actifs.
    const holProj = useGraphStore.getState().holProject;
    let maxTrackIdx = -1;
    movements.forEach((mv) => {
      mv.osc_ids?.forEach((oscId: number) => {
        let idx: number;
        if (holProj) {
          idx = holProj.tracks.findIndex((t: any) => t.id === oscId);
        } else {
          idx = manualOscIds.indexOf(oscId);
        }
        if (idx > maxTrackIdx) maxTrackIdx = idx;
      });
    });
    const fromMoves = maxTrackIdx + 1;
    const result = Math.max(fromGraph, fromProject, fromMoves, holProject ? 0 : manualOscIds.length, 1);
    return result;
  }, [nodes, holProject, movements, manualOscIds]);

  // ── Hooks extraits (création des objets 3D, marqueurs, handle, modes) ──
  const { holMarkersRef } = useHolMarkers({ sceneRef, cameraRef, holProject });
  const { objectsRef } = useObjects3D({ sceneRef, nObjects, sceneReady });
  const { handleRef, trajectoryLineRef } = useManipulateHandle({ sceneRef, manipulateMode });
  useInteractionModes({ controlsRef, rendererRef, drawMode, manipulateMode, assignMode, zonePlaceMode });

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
  });

  // Assign mode — clic sur un objet 3D = toggle de sa track via la même
  // source de vérité que la TrackGrid (toggleTrackSelection → sélection +
  // Objects node + slot en édition). Pas de chemin parallèle : la sélection
  // ne peut pas diverger entre scène et grille.
  const handleAssignDown = useCallback(
    (e: React.PointerEvent) => {
      const camera = cameraRef.current;
      const container = containerRef.current;
      if (!camera || !container) return;
      const rect = container.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      // Même filtre que Manipulate : les tracks cachées par le focus slot
      // ne doivent pas être assignables.
      const hits = raycaster.intersectObjects(
        objectsRef.current.filter((o) => o.visible), true,
      );
      if (hits.length === 0) return;
      let hitObj = hits[0].object as THREE.Mesh;
      let idx = objectsRef.current.indexOf(hitObj);
      while (idx < 0 && hitObj.parent) {
        hitObj = hitObj.parent as THREE.Mesh;
        idx = objectsRef.current.indexOf(hitObj);
      }
      if (idx < 0) return;
      const s = useGraphStore.getState();
      const trackId = s.holProject?.tracks[idx]?.id ?? s.manualOscIds[idx] ?? idx + 1;
      s.toggleTrackSelection(trackId);
    },
    [objectsRef],
  );

  // Zone place mode — clic sur le sol (plan y=0 côté Three = z=0 backend)
  // → enregistre le centre en coords backend pour le formulaire SpatialFX.
  const handleZonePlaceDown = useCallback(
    (e: React.PointerEvent) => {
      const camera = cameraRef.current;
      const container = containerRef.current;
      if (!camera || !container) return;
      const rect = container.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const pt = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt)) return;
      const s = useGraphStore.getState();
      const [bx, by, bz] = fromThree(pt.x, pt.y, pt.z);
      s.setPendingZonePoint([bx, by, bz]);
      s.setZonePlaceMode(false);
    },
    [],
  );

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
    macros,
    manipulateMode,
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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-900/90 z-raised p-4">
          <TriangleAlert size={32} className="text-amber-400" />
          <div className="text-white text-sm font-medium">WebGL unavailable</div>
          <div className="text-gray-400 text-xs text-center max-w-xs">
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
      {assignMode && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-overlay bg-gray-900/90 backdrop-blur rounded-lg px-3 py-1.5 border border-green-600/50">
          <span className="text-green-400 text-xs font-medium">
            Assign — click objects to toggle their track for this move
          </span>
        </div>
      )}
      {zonePlaceMode && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-overlay bg-gray-900/90 backdrop-blur rounded-lg px-3 py-1.5 border border-cyan-600/50">
          <span className="text-cyan-400 text-xs font-medium">
            Place — click on the floor to set the zone center (Esc to cancel)
          </span>
        </div>
      )}
      <ModeButtons
        manipulateMode={manipulateMode}
        setManipulateMode={setManipulateMode}
        assignMode={assignMode}
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
      {/* Zones d'effets spatiaux — volumes translucides (sphere/box + falloff) */}
      <ZoneVisualization sceneRef={sceneRef} />
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
      {/* Interaction layer — manipulate, assign ou place-zone */}
      {zonePlaceMode && (
        <div
          className="absolute inset-0 z-overlay"
          style={{ cursor: 'crosshair' }}
          onPointerDown={handleZonePlaceDown}
        />
      )}
      {assignMode && (
        <div
          className="absolute inset-0 z-overlay"
          style={{ cursor: 'pointer' }}
          onPointerDown={handleAssignDown}
        />
      )}
      {manipulateMode && (
        <div
          className="absolute inset-0 z-overlay"
          style={{
            cursor: draggingHandle || draggingObject !== null ? 'grabbing' : 'grab',
          }}
          onPointerDown={handleManipulateDown}
          onPointerMove={handleManipulateMove}
          onPointerUp={handleManipulateUp}
          onPointerCancel={handleManipulateUp}
          onWheel={handleManipulateWheel}
        />
      )}
      {/* Active movements indicator — bottom right */}
      {movements.length > 0 && (
        <div className="absolute bottom-2 right-2 z-overlay bg-gray-900/80 backdrop-blur rounded-lg px-2 py-1 border border-gray-700/50 flex items-center gap-1.5">
          <span className="text-gray-500 text-xs font-mono">MOVEMENTS</span>
          {movements.map((mv, idx) => (
            <span
              key={mv.id}
              className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                mv.is_preview ? 'bg-cyan-900 text-cyan-400' : 'bg-green-900 text-green-400'
              }`}
              title={`${mv.name} — ${mv.track_count} tracks`}
            >
              {idx + 1}{mv.is_preview ? '👁' : '▶'}
            </span>
          ))}
        </div>
      )}
      {/* État vide — aucun move actif, aucun slot en édition : le canvas
          communique la prochaine action au lieu d'afficher une plaine vide.
          pointer-events-none : l'orbit reste utilisable. */}
      {movements.length === 0 && editingSlotId === null && !manipulateMode && !drawMode && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="text-center bg-gray-900/70 backdrop-blur rounded-xl px-6 py-4 border border-gray-700/40">
            <div className="text-gray-300 text-xs font-medium">No move running</div>
            <div className="text-gray-500 text-xs mt-1.5 leading-relaxed">
              <span className="text-gray-400">+ Move</span> creates a slot · a <span className="text-gray-400">template</span> fills it · <span className="text-gray-400">▶</span> launches it
            </div>
          </div>
        </div>
      )}
      {/* Debug perf overlay — top left, opt-in via le toggle de la barre canvas */}
      {debugPerfVisible && <DebugPerfOverlay />}
    </div>
  );
};

export default Scene3D;
