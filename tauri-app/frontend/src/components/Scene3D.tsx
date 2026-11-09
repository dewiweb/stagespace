import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { useGraphStore } from '../store/useGraphStore';
import { useMoveEditorStore } from '../store/useMoveEditorStore';
import { TriangleAlert } from 'lucide-react';
import { MacrosPanel } from './MacrosPanel';
import { DebugPerfOverlay } from './DebugPerfOverlay';
import { debugPerf } from '../utils/debugPerf';

// Exposer debugPerf sur window pour le render loop et le listener IPC
(window as any).__debugPerf = debugPerf;
import { DrawModeOverlay } from './DrawModeOverlay';
import { ModeButtons } from './ModeButtons';
import { ModeBanner } from './ui/ModeBanner';
import { TrajectoryVisualization } from './TrajectoryVisualization';
import { ZoneVisualization } from './ZoneVisualization';
import { useHolMarkers } from '../hooks/useHolMarkers';
import { useObjects3D } from '../hooks/useObjects3D';
import { useManipulateHandle } from '../hooks/useManipulateHandle';
import { useInteractionModes } from '../hooks/useInteractionModes';
import { useDrawMode } from '../hooks/useDrawMode';
import { useManipulateMode } from '../hooks/useManipulateMode';
import { useRenderLoop } from '../hooks/useRenderLoop';
import { fromThree, toThree } from '../utils/coords';
import { dollyCamera } from '../utils/three';
import { zoneToParams, zoneToParamsResized } from '../store/slices/spatialFxSlice';
import { doClearPosition } from '../utils/liveActions';

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
  // Incrémenté par le bouton Retry — refire l'init du render loop
  // (avant : retry était mort, l'effect [] ne se relançait jamais).
  const [initKey, setInitKey] = useState(0);

  const isPlaying = useGraphStore((s) => s.movements.length > 0);
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
  const zoneEditMode = useGraphStore((s) => s.zoneEditMode);

  // Multi-movement state — movements et movementPositions sont lus via getState()
  // dans useRenderLoop pour éviter 60 re-renders/seconde.
  // On garde movements pour le useMemo nObjects et le rendu conditionnel.
  const movements = useGraphStore((s) => s.movements);
  // NOTE : manualPositions est lu via getState() dans useRenderLoop — une
  // subscription ici re-rendrait Scene3D ~30×/s pendant un drag d'objet.
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const editingSlotId = useGraphStore((s) => s.editingSlotId);
  const debugPerfVisible = useMoveEditorStore((s) => s.debugPerfVisible);

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
    controlsRef,
    containerRef,
    objectsRef,
    handleRef,
    manipulateMode,
  });

  // Zoom manuel (dolly vers controls.target) — OrbitControls est désactivé
  // pendant les modes interactifs : sans ça la molette ne zoomait plus.
  const handleZoomWheel = useCallback((e: React.WheelEvent) => {
    dollyCamera(controlsRef.current, e.deltaY < 0 ? 0.92 : 1.08);
  }, []);

  // Pick partagé — NDC→raycast sur les objets visibles, avec fallback
  // proximité écran : une sphère en mouvement est dure à viser, l'objet
  // le plus proche du clic (< proximityPx) est retourné. Utilisé par
  // assign, release clic-droit — même sémantique que useManipulateMode.
  const pickObjectIndexAt = useCallback(
    (
      e: { clientX: number; clientY: number },
      opts?: { proximityPx?: number },
    ): number | null => {
      const camera = cameraRef.current;
      const container = containerRef.current;
      if (!camera || !container) return null;
      const rect = container.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const visibleObjs = objectsRef.current.filter((o) => o.visible);
      const hits = raycaster.intersectObjects(visibleObjs, true);
      if (hits.length > 0) {
        let hitObj = hits[0].object as THREE.Mesh;
        let idx = objectsRef.current.indexOf(hitObj);
        while (idx < 0 && hitObj.parent) {
          hitObj = hitObj.parent as THREE.Mesh;
          idx = objectsRef.current.indexOf(hitObj);
        }
        if (idx >= 0) return idx;
      }
      const maxPx = opts?.proximityPx ?? 0;
      if (maxPx <= 0) return null;
      let bd = maxPx;
      let best: number | null = null;
      for (const o of visibleObjs) {
        const p = o.position.clone().project(camera);
        if (p.z < -1 || p.z > 1) continue; // derrière la caméra
        const sx = ((p.x + 1) / 2) * rect.width;
        const sy = ((1 - p.y) / 2) * rect.height;
        const d = Math.hypot(sx - (e.clientX - rect.left), sy - (e.clientY - rect.top));
        if (d < bd) {
          bd = d;
          best = objectsRef.current.indexOf(o);
        }
      }
      return best;
    },
    [cameraRef, containerRef, objectsRef],
  );

  // Assign mode — clic sur un objet 3D = toggle de sa track via la même
  const handleAssignDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return; // clic droit = release, pas assign
      const idx = pickObjectIndexAt(e, { proximityPx: 40 });
      if (idx === null) return;
      const s = useGraphStore.getState();
      const trackId = s.holProject?.tracks[idx]?.id ?? s.manualOscIds[idx] ?? idx + 1;
      s.toggleTrackSelection(trackId);
    },
    [pickObjectIndexAt],
  );

  // Zone place mode — clic sur le sol (plan y=0 côté Three = z=0 backend)
  // → enregistre le centre en coords backend pour le formulaire SpatialFX.
  const handleZonePlaceDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return; // clic droit = release, pas place
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

  // Zone edit mode — drag d'un mesh de zone (tagué userData.isZone par
  // ZoneVisualization) : le centre suit le curseur sur le plan horizontal
  // à la hauteur de la zone (backend z = three y), resize à la molette.
  // updateZone throttlé ~30Hz — un invoke par pointermove saturerait l'IPC
  // (même discipline que le drag d'objets dans useManipulateMode).
  const draggingZoneRef = useRef<number | null>(null);
  const lastZoneUpdateRef = useRef(0);
  const zoneRaycast = useCallback(
    (e: { clientX: number; clientY: number }): THREE.Raycaster | null => {
      const camera = cameraRef.current;
      const container = containerRef.current;
      if (!camera || !container) return null;
      const rect = container.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const r = new THREE.Raycaster();
      r.setFromCamera(ndc, camera);
      return r;
    },
    [],
  );
  const zoneIndexAt = useCallback(
    (raycaster: THREE.Raycaster): number | null => {
      const scene = sceneRef.current;
      if (!scene) return null;
      const hits = raycaster.intersectObjects(scene.children, true);
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o && o.userData.isZone !== true) o = o.parent;
        if (o?.userData.isZone === true) return o.userData.zoneIndex as number;
      }
      return null;
    },
    [],
  );
  const handleZoneEditDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return; // clic droit = release, pas edit
      const r = zoneRaycast(e);
      if (!r) return;
      const idx = zoneIndexAt(r);
      if (idx !== null) {
        draggingZoneRef.current = idx;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
    },
    [zoneRaycast, zoneIndexAt],
  );
  const handleZoneEditMove = useCallback(
    (e: React.PointerEvent) => {
      const zi = draggingZoneRef.current;
      if (zi === null) return;
      const r = zoneRaycast(e);
      if (!r) return;
      const s = useGraphStore.getState();
      const zone = s.zones[zi];
      if (!zone) return;
      // Plan horizontal à la hauteur de la zone — le drag conserve z (up).
      const centerB = zone.shape.shape === 'sphere'
        ? zone.shape.center
        : zone.shape.shape === 'box'
          ? [(zone.shape.min[0] + zone.shape.max[0]) / 2, (zone.shape.min[1] + zone.shape.max[1]) / 2, (zone.shape.min[2] + zone.shape.max[2]) / 2] as [number, number, number]
          : [0, 0, 0] as [number, number, number];
      const [, cy] = toThree(centerB[0], centerB[1], centerB[2]);
      const pt = new THREE.Vector3();
      if (!r.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -cy), pt)) return;
      const now = performance.now();
      if (now - lastZoneUpdateRef.current < 33) return;
      lastZoneUpdateRef.current = now;
      const [bx, by, bz] = fromThree(pt.x, pt.y, pt.z);
      s.updateZone(zi, zoneToParams(zone, [bx, by, bz]))
        .catch((err) => console.error('zone drag update failed:', err));
    },
    [zoneRaycast],
  );
  const handleZoneEditUp = useCallback(() => { draggingZoneRef.current = null; }, []);
  const handleZoneEditWheel = useCallback(
    (e: React.WheelEvent) => {
      const r = zoneRaycast(e);
      if (!r) return;
      const zi = zoneIndexAt(r);
      if (zi === null) return;
      const s = useGraphStore.getState();
      const zone = s.zones[zi];
      if (!zone) return;
      const dir = e.deltaY < 0 ? 1 : -1;
      const params = zone.shape.shape === 'sphere'
        ? zoneToParamsResized(zone, { radius: zone.shape.radius + dir * 0.25 })
        : zoneToParamsResized(zone, { scale: 1 + dir * 0.05 });
      s.updateZone(zi, params).catch((err) => console.error('zone resize failed:', err));
    },
    [zoneRaycast, zoneIndexAt],
  );

  // Release uniforme — clic-droit (SANS drag) sur un objet = relâche sa
  // position manuelle, dans TOUS les modes (pas seulement manipulate).
  // Le pan OrbitControls utilise le drag droit : on distingue le clic
  // du drag par le déplacement (<6px) et la durée (<500ms). Le contexte
  // menu natif est déjà supprimé globalement dans App.tsx.
  const rightDownRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const handleScenePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 2) rightDownRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  }, []);
  const handleScenePointerUp = useCallback((e: React.PointerEvent) => {
    const d = rightDownRef.current;
    rightDownRef.current = null;
    if (e.button !== 2 || !d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || Date.now() - d.t > 500) return;
    const idx = pickObjectIndexAt(e, { proximityPx: 40 });
    if (idx !== null) doClearPosition(idx);
  }, [pickObjectIndexAt]);

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
    <div
      ref={containerRef}
      style={{ width, height, overflow: 'hidden', position: 'relative' }}
      onPointerDown={handleScenePointerDown}
      onPointerUp={handleScenePointerUp}
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
      {drawMode && <DrawModeOverlay />}
      {manipulateMode && <MacrosPanel isPlaying={isPlaying} hasMovements={movements.length > 0} />}
      {assignMode && (
        <ModeBanner variant="live">Assign — click objects to toggle their track for this move (Esc to cancel)</ModeBanner>
      )}
      {zonePlaceMode && (
        <ModeBanner variant="osc">Place — click on the floor to set the zone center (Esc to cancel)</ModeBanner>
      )}
      {zoneEditMode && (
        <ModeBanner variant="osc">Edit zones — drag a zone to move it, scroll over it to resize (Esc to cancel)</ModeBanner>
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
        className="absolute inset-0 z-overlay"
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
        onWheel={handleZoomWheel}
      />
      {/* Interaction layer — manipulate, assign, place-zone ou edit-zone */}
      {zoneEditMode && (
        <div
          className="absolute inset-0 z-overlay"
          style={{ cursor: 'move' }}
          onPointerDown={handleZoneEditDown}
          onPointerMove={handleZoneEditMove}
          onPointerUp={handleZoneEditUp}
          onPointerCancel={handleZoneEditUp}
          onWheel={(e) => {
            // Resize si la molette est au-dessus d'une zone — sinon zoom.
            const r = zoneRaycast(e);
            if (r && zoneIndexAt(r) !== null) handleZoneEditWheel(e);
            else handleZoomWheel(e);
          }}
        />
      )}
      {zonePlaceMode && (
        <div
          className="absolute inset-0 z-overlay"
          style={{ cursor: 'crosshair' }}
          onPointerDown={handleZonePlaceDown}
          onWheel={handleZoomWheel}
        />
      )}
      {assignMode && (
        <div
          className="absolute inset-0 z-overlay"
          style={{ cursor: 'pointer' }}
          onPointerDown={handleAssignDown}
          onWheel={handleZoomWheel}
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
        <div className="absolute inset-0 z-overlay flex items-center justify-center pointer-events-none">
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
