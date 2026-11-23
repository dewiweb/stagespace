import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { useGraphStore } from '../../store/useGraphStore';
import { TriangleAlert } from 'lucide-react';
import { debugPerf } from '../../utils/debugPerf';

// Exposer debugPerf sur window pour le render loop et le listener IPC
(window as any).__debugPerf = debugPerf;
import { ViewerToolbar } from './ViewerToolbar';
import { ViewerStatusBar } from './ViewerStatusBar';
import { ViewerToolPalette } from './ViewerToolPalette';
import { fromThree } from '../../utils/coords';
import { TrajectoryVisualization } from './TrajectoryVisualization';
import { ZoneVisualization } from './ZoneVisualization';
import { useHolMarkers } from '../../hooks/useHolMarkers';
import { useObjects3D } from '../../hooks/useObjects3D';
import { useManipulateHandle } from '../../hooks/useManipulateHandle';
import { useInteractionModes } from '../../hooks/useInteractionModes';
import { useDrawMode } from '../../hooks/useDrawMode';
import { useManipulateMode } from '../../hooks/useManipulateMode';
import { useRenderLoop } from '../../hooks/useRenderLoop';
import { useScenePicking } from '../../hooks/useScenePicking';
import { useZoneGestures } from '../../hooks/useZoneGestures';
import { useSceneGestures } from '../../hooks/useSceneGestures';
import { SceneInteractionLayers } from './SceneInteractionLayers';
import ContextMenu from '../ui/ContextMenu';
import { buildObjectMenuItems } from '../../utils/objectMenuItems';

interface Scene3DProps {
  width?: string | number;
  height?: string | number;
}

// Temps partagés du readout curseur hors-draw (floor plane) — alloués
// une fois, les mousemove ne churnent pas le GC.
const _readoutNdc = new THREE.Vector2();
const _readoutRay = new THREE.Raycaster();
const _readoutHit = new THREE.Vector3();
const _floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

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
  // Incrémenté par le bouton Retry — refire l'init du render loop
  // (avant : retry était mort, l'effect [] ne se relançait jamais).
  const [initKey, setInitKey] = useState(0);

  const isPlaying = useGraphStore((s) => s.movements.length > 0);
  const macros = useGraphStore((s) => s.macros);
  const nodes = useGraphStore((s) => s.nodes);
  const holProject = useGraphStore((s) => s.holProject);
  const drawMode = useGraphStore((s) => s.drawMode);
  const drawnPoints = useGraphStore((s) => s.drawnPoints);
  const controlPoints = useGraphStore((s) => s.controlPoints);
  const splineClosed = useGraphStore((s) => s.splineClosed);
  const cpSelection = useGraphStore((s) => s.cpSelection);

  // Modes d'interaction — slice du store (le handler Esc global peut les
  // annuler avant le panic ; mutual exclusion gérée par le slice)
  const manipulateMode = useGraphStore((s) => s.manipulateMode);
  const assignMode = useGraphStore((s) => s.assignMode);
  const zonePlaceMode = useGraphStore((s) => s.zonePlaceMode);
  const zoneEditMode = useGraphStore((s) => s.zoneEditMode);

  // Multi-movement state — movements et movementPositions sont lus via getState()
  // dans useRenderLoop pour éviter 60 re-renders/seconde.
  // On garde movements pour le useMemo nObjects et le rendu conditionnel.
  const movements = useGraphStore((s) => s.movements);
  // NOTE : manualPositions est lu via getState() dans useRenderLoop — une
  // subscription ici re-rendrait Scene3D ~30×/s pendant un drag d'objet.
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const editingSlotId = useGraphStore((s) => s.editingSlotId);

  // Determine object count — utilise le max entre:
  // - le node Objects du slot sélectionné
  // - le nombre total de tracks du projet holophonix
  // - le nombre d'osc_ids manuels (l'espace d'indexation complet : la
  //   sélection peut viser les derniers indices — ex "2ème moitié" sur 8
  //   tracks = indices 4-7, il faut le pool entier même si n_objects=4)
  // - le nombre total d'osc_ids uniques across tous les moves actifs
  const nObjects = React.useMemo(() => {
    const objectsNode = nodes.find((n) => n.data.type === 'Objects');
    const fromGraph = Number(objectsNode?.data.params?.n_objects ?? 0);
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
  useInteractionModes({ controlsRef, rendererRef, drawMode, manipulateMode, assignMode, zonePlaceMode, zoneEditMode });

  // Plan de travail du draw mode — grille de visu créée par useRenderLoop.
  const workPlaneRef = useRef<THREE.Group | null>(null);
  // Readout curseur de la status bar — span muté direct (60Hz sans React).
  const cursorReadoutRef = useRef<HTMLSpanElement | null>(null);

  // ── Hooks extraits (handlers d'interaction) ──
  const { drawCanvasRef, marqueeDivRef, handleDrawStart, handleDrawMove, handleDrawEnd, handleDrawDoubleClick } =
    useDrawMode({ cameraRef, containerRef, controlsRef, cursorReadoutRef });
  const {
    draggingObject,
    draggingHandle,
    draggingSetRef,
    handleManipulateDown,
    handleManipulateMove,
    handleManipulateUp,
    handleManipulateWheel,
  } = useManipulateMode({
    cameraRef,
    controlsRef,
    containerRef,
    objectsRef,
    handleRef,
    manipulateMode,
  });

  // ── Gestes extraits — pick/raycast, zones, gestes transverses ──
  // useScenePicking : NDC→raycast + pick objet proximité + zone index + zoom
  // useZoneGestures : place + drag/resize des zones manuelles
  // useSceneGestures : tap-select + release clic-droit + assign
  const { handleZoomWheel, raycastAt, pickObjectIndexAt, zoneIndexAt } =
    useScenePicking({ cameraRef, controlsRef, containerRef, sceneRef, objectsRef });
  const {
    handleZonePlaceDown,
    handleZoneEditDown,
    handleZoneEditMove,
    handleZoneEditUp,
    handleZoneEditWheel,
  } = useZoneGestures({ raycastAt, zoneIndexAt });
  // Menu clic-droit objet — état lu via getState() à l'ouverture (pas de
  // subscription 30Hz à emittedPositions ici).
  const [objMenu, setObjMenu] = useState<{ x: number; y: number; obj: number } | null>(null);
  const { handleScenePointerDown, handleScenePointerUp, handleAssignDown } =
    useSceneGestures({
      pickObjectIndexAt,
      // Clic-droit tap sur un objet → menu (Release/Park/Copy/Paste) —
      // instantané reste Ctrl+clic, géré dans le hook.
      onObjectContextMenu: (obj, x, y) => setObjMenu({ x, y, obj }),
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
    macros,
    manipulateMode,
    holProject,
    drawnPoints,
    controlPoints,
    splineClosed,
    cpSelection,
    draggingSetRef,
    workPlaneRef,
    setWebglFailed,
    dimensions,
    initKey,
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
    // Pas d'overflow-hidden ici : le popover transform de la toolbar déborde
    // volontairement dans le canvas. Le canvas garde SON overflow:hidden.
    <div style={{ width, height }} className="flex flex-col">
      {/* Menu bar — contexte document (vues, commit) — layout éditeur :
          palette d'outils à gauche, status bar en bas. */}
      <ViewerToolbar isPlaying={isPlaying} />
      <div className="flex flex-1 min-h-0">
        {/* Palette d'outils verticale — modes + sous-outils draw */}
        <ViewerToolPalette />
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: 'hidden', position: 'relative' }}
        onPointerDown={handleScenePointerDown}
        onPointerUp={handleScenePointerUp}
        onPointerMove={(e) => {
          // Readout floor-plane hors draw mode (en draw, le handler du
          // canvas overlay écrit les coords sur la feuille de la vue).
          const span = cursorReadoutRef.current;
          const camera = cameraRef.current;
          const container = containerRef.current;
          if (!span || !camera || !container || drawMode) return;
          const rect = container.getBoundingClientRect();
          _readoutNdc.set(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1,
          );
          _readoutRay.setFromCamera(_readoutNdc, camera);
          if (_readoutRay.ray.intersectPlane(_floorPlane, _readoutHit)) {
            const [bx, by, bz] = fromThree(_readoutHit.x, _readoutHit.y, _readoutHit.z);
            span.textContent = `x ${bx.toFixed(2)}  y ${by.toFixed(2)}  z ${bz.toFixed(2)}`;
          }
        }}
        onPointerLeave={() => {
          if (cursorReadoutRef.current) cursorReadoutRef.current.textContent = '';
        }}
      >
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
              // Re-tenter l'init réelle — incrémenter initKey refire
              // l'effect du render loop (cleanup + scène recréée).
              setSceneReady(false);
              setInitKey((k) => k + 1);
            }}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded"
          >
            Retry
          </button>
        </div>
      )}
      {/* Trajectory visualization — composant séparé qui gère ses propres lignes */}
      <TrajectoryVisualization
        sceneRef={sceneRef}
        objectsRef={objectsRef}
        isPlaying={isPlaying}
        hasMovements={movements.length > 0}
        nObjects={nObjects}
        sceneReady={sceneReady}
      />
      {/* Zones d'effets spatiaux — volumes translucides (sphere/box + falloff) */}
      <ZoneVisualization sceneRef={sceneRef} />
      {/* Interaction layer — canvas draw + overlays des modes
          (exclusifs par le slice) : manipulate, assign, place-zone, edit-zone */}
      <SceneInteractionLayers
        drawMode={drawMode}
        zoneEditMode={zoneEditMode}
        zonePlaceMode={zonePlaceMode}
        assignMode={assignMode}
        manipulateMode={manipulateMode}
        draggingHandle={draggingHandle}
        draggingObject={draggingObject}
        drawCanvasRef={drawCanvasRef}
        marqueeDivRef={marqueeDivRef}
        handleDrawStart={handleDrawStart}
        handleDrawMove={handleDrawMove}
        handleDrawEnd={handleDrawEnd}
        handleDrawDoubleClick={handleDrawDoubleClick}
        handleZoomWheel={handleZoomWheel}
        raycastAt={raycastAt}
        zoneIndexAt={zoneIndexAt}
        handleZoneEditDown={handleZoneEditDown}
        handleZoneEditMove={handleZoneEditMove}
        handleZoneEditUp={handleZoneEditUp}
        handleZoneEditWheel={handleZoneEditWheel}
        handleZonePlaceDown={handleZonePlaceDown}
        handleAssignDown={handleAssignDown}
        handleManipulateDown={handleManipulateDown}
        handleManipulateMove={handleManipulateMove}
        handleManipulateUp={handleManipulateUp}
        handleManipulateWheel={handleManipulateWheel}
      />
      {/* Menu clic-droit sur un objet — Release/Park/Copy/Paste position.
          Positions/état lus à l'ouverture via getState(). */}
      {objMenu && (() => {
        const st = useGraphStore.getState();
        return (
          <ContextMenu
            x={objMenu.x}
            y={objMenu.y}
            header={`Object ${st.manualOscIds[objMenu.obj] ?? objMenu.obj + 1}`}
            onClose={() => setObjMenu(null)}
            items={buildObjectMenuItems(
              objMenu.obj,
              st.objectStates[objMenu.obj] ?? 'track',
              st.emittedPositions[objMenu.obj],
            )}
          />
        );
      })()}
      {/* État vide — aucun move actif, aucun slot en édition : le canvas
          communique la prochaine action au lieu d'afficher une plaine vide.
          pointer-events-none : l'orbit reste utilisable. */}
      {movements.length === 0 && editingSlotId === null && !manipulateMode && !drawMode && (
        <div className="absolute inset-0 z-overlay flex items-center justify-center pointer-events-none">
          <div className="text-center bg-gray-900/70 backdrop-blur rounded-xl px-6 py-4 border border-gray-700/40">
            <div className="text-gray-300 text-xs font-medium">No move running</div>
            <div className="text-gray-500 text-xs mt-1.5 leading-relaxed">
              <span className="text-gray-400">+ Move</span> creates a slot · a <span className="text-gray-400">template</span> fills it · <span className="text-gray-400">▶</span> launches it
            </div>
          </div>
        </div>
      )}
      </div>
      </div>
      {/* Status bar dockée — footer : hint, compteurs, coords, perf */}
      <ViewerStatusBar cursorReadoutRef={cursorReadoutRef} />
    </div>
  );
};

export default Scene3D;
