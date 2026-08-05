import { useEffect, useRef, MutableRefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { useGraphStore } from '../store/useGraphStore';
import type { HolProject, MovementInfo } from '../store/useGraphStore';

// Types des valeurs store lues dans le render loop
type PositionArray = Array<{ index: number; x: number; y: number; z: number }>;
type MacrosValue = {
  speed: number;
  scale: number;
  shiftX: number;
  shiftY: number;
  shiftZ: number;
  yaw: number;
  pitch: number;
  roll: number;
  radius_scale: number;
  height_offset: number;
};
type DrawnPointsValue = Array<[number, number, number]>;

export interface UseRenderLoopParams {
  containerRef: MutableRefObject<HTMLDivElement | null>;
  sceneRef: MutableRefObject<THREE.Scene | null>;
  cameraRef: MutableRefObject<THREE.PerspectiveCamera | null>;
  rendererRef: MutableRefObject<THREE.WebGLRenderer | null>;
  labelRendererRef: MutableRefObject<CSS2DRenderer | null>;
  controlsRef: MutableRefObject<OrbitControls | null>;
  objectsRef: MutableRefObject<THREE.Mesh[]>;
  holMarkersRef: MutableRefObject<THREE.Mesh[]>;
  handleRef: MutableRefObject<THREE.Mesh | null>;
  trajectoryLineRef: MutableRefObject<THREE.Line | null>;
  drawCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  // Store values (passées pour sync vers refs internes)
  positions: PositionArray;
  movements: MovementInfo[];
  movementPositions: Record<string, PositionArray>;
  macros: MacrosValue;
  assignMode: boolean;
  selectedTrackIds: Set<number>;
  holProject: HolProject | null;
  drawnPoints: DrawnPointsValue;
  draggingObjectRef: MutableRefObject<number | null>;
  manualPositions: Record<number, [number, number, number]>;
  // Pour signaler l'échec WebGL
  setWebglFailed: (v: boolean) => void;
  dimensions: { width: number; height: number };
}

/**
 * Render loop critique 60fps.
 *
 * Crée la scène Three.js complète (caméra, renderer WebGL, CSS2DRenderer, lumières,
 * grille, axes, OrbitControls) et lance la boucle `animate()` via requestAnimationFrame.
 *
 * Les refs internes (positionsRef, movementsRef, etc.) sont créées DANS le hook et
 * synchronisées à chaque render React (cheap — pas d'effet de bord). Le useEffect
 * principal a `[]` dependencies → n'est JAMAIS recréé par React.
 */
export function useRenderLoop({
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
}: UseRenderLoopParams) {
  // Refs internes pour les valeurs changeantes — lues dans le render loop à 60fps
  const positionsRef = useRef(positions);
  const movementsRef = useRef(movements);
  const movementPositionsRef = useRef(movementPositions);
  const macrosRef = useRef(macros);
  const assignModeRef = useRef(assignMode);
  const selectedTrackIdsRef = useRef(selectedTrackIds);
  const holProjectRef = useRef(holProject);
  const drawnPointsRef = useRef(drawnPoints);
  const manualPositionsRef = useRef(manualPositions);
  const lastLineKeyRef = useRef('');
  const lastDrawnKeyRef = useRef('');
  const tmpVecRef = useRef(new THREE.Vector3());

  // Sync des refs à chaque render React (cheap — pas d'effet de bord)
  positionsRef.current = positions;
  movementsRef.current = movements;
  movementPositionsRef.current = movementPositions;
  macrosRef.current = macros;
  assignModeRef.current = assignMode;
  selectedTrackIdsRef.current = selectedTrackIds;
  holProjectRef.current = holProject;
  drawnPointsRef.current = drawnPoints;
  manualPositionsRef.current = manualPositions;

  // Init scene — ne se déclenche qu'une seule fois (deps = [])
  // Les dimensions initiales sont lues directement depuis le container
  // Le ResizeObserver (dans Scene3D) gère les resize ultérieurs sans recréer la scène
  useEffect(() => {
    if (!containerRef.current) return;
    if (sceneRef.current) return; // déjà initialisé

    // Lire la taille réelle du container au moment de l'init
    const rect = containerRef.current.getBoundingClientRect();
    const initW = Math.max(rect.width, 100);
    const initH = Math.max(rect.height, 100);

    try {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0f);
    scene.fog = new THREE.Fog(0x0a0a0f, 15, 40);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, initW / initH, 0.1, 100);
    camera.position.set(6, 5, 8);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, failIfMajorPerformanceCaveat: false });
    } catch (e) {
      console.error('WebGL init failed:', e);
      setWebglFailed(true);
      return;
    }
    renderer.setSize(initW, initH);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.zIndex = '1';
    // pointerEvents géré dynamiquement par l'effect OrbitControls ci-dessous
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // CSS2D renderer for labels
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(initW, initH);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    containerRef.current.appendChild(labelRenderer.domElement);
    labelRendererRef.current = labelRenderer;

    // Lights
    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x6080ff, 0.3);
    fillLight.position.set(-5, 3, -5);
    scene.add(fillLight);

    // Grid + axes
    const grid = new THREE.GridHelper(20, 20, 0x333344, 0x1a1a2e);
    scene.add(grid);
    const axes = new THREE.AxesHelper(3);
    scene.add(axes);

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 2;
    controls.maxDistance = 30;
    controlsRef.current = controls;

    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      controls.update();

      // ── Mise à jour des positions dans le render loop (pas de useEffect) ──
      // Lit les refs au lieu des props React — évite les re-renders à 60fps
      const objs = objectsRef.current;
      const mvts = movementsRef.current;
      const mvPosMap = movementPositionsRef.current;
      const mc = macrosRef.current;
      const holProj = holProjectRef.current;
      const assignMode = assignModeRef.current;
      const selTrackIds = selectedTrackIdsRef.current;
      const dragObj = draggingObjectRef.current;

      // Mode assign: couleurs vert/gris selon la sélection
      if (assignMode && holProj) {
        objs.forEach((mesh, i) => {
          if (i < holProj.tracks.length) {
            const trackId = holProj.tracks[i].id;
            const isSelected = selTrackIds.has(trackId);
            const mat = mesh.material as THREE.MeshStandardMaterial;
            if (isSelected) {
              mat.color.setHex(0x00ff66);
              mat.emissive.setHex(0x004422);
              mat.opacity = 1.0;
              mat.transparent = false;
            } else {
              mat.color.setHex(0x444444);
              mat.emissive.setHex(0x111111);
              mat.opacity = 0.3;
              mat.transparent = true;
            }
          }
        });
      }

      if (mvts.length > 0) {
        // ── Mode multi-move : les positions arrivent du backend via 'global-positions' ──
        // Le MergeRuntime a déjà fait : merge + post-processing (macros, offset, etc.)
        // Le visualiseur est un viewer passif — il ne recalcule RIEN.
        const globalPos = mvPosMap['global'];
        if (globalPos) {
          const posMap = new Map<number, typeof globalPos[0]>();
          for (const p of globalPos) posMap.set(p.index, p);
          objs.forEach((mesh, objIdx) => {
            if (dragObj !== null && objIdx === dragObj) return;
            const p = posMap.get(objIdx);
            if (p) {
              mesh.position.set(p.x, p.y, p.z);
              mesh.visible = true;
              const mat = mesh.material as THREE.MeshStandardMaterial;
              const isPreview = mvts.some((mv) => mv.is_preview);
              if (isPreview) {
                mat.color.setHex(0x00ccff);
                mat.emissive.setHex(0x003344);
              } else {
                mat.color.setHex(0x00ff44);
                mat.emissive.setHex(0x004411);
              }
            } else if (!assignMode) {
              // Pas de position pour cet objet → manualPositions (statique)
              const manualPos = manualPositionsRef.current;
              const mp = manualPos[objIdx];
              if (mp) {
                mesh.position.set(mp[0], mp[1], mp[2]);
                mesh.visible = true;
              }
              const mat = mesh.material as THREE.MeshStandardMaterial;
              mat.color.setHSL(objIdx / objs.length, 0.7, 0.55);
              mat.emissive.setHSL(objIdx / objs.length, 0.5, 0.2);
              mat.opacity = 1.0;
              mat.transparent = false;
            }
          });
        }
      } else {
        // ── Mode statique : aucun move actif, utiliser manualPositions ──
        // Pas de calcul de trajectoire — juste les positions manuelles (drag, .hol, cercle)
        const manualPos = manualPositionsRef.current;
        objs.forEach((mesh, i) => {
          if (dragObj !== null && i === dragObj) return;
          const p = manualPos[i];
          if (p) {
            mesh.position.set(p[0], p[1], p[2]);
            mesh.visible = true;
          }
        });
      }

      // Hol markers font face à la caméra (billboard)
      const camPos = camera.position;
      holMarkersRef.current.forEach((m) => m.lookAt(camPos));

      // Mise à jour du handle + trajectory line en manipulate mode
      if (handleRef.current && trajectoryLineRef.current) {
        // Utiliser uniquement les positions du backend (global-positions) — pas de recalcul
        let pos: Array<{ index: number; x: number; y: number; z: number }> = [];
        if (mvts.length > 0) {
          pos = mvPosMap['global'] ?? [];
        }
        if (pos.length > 0) {
          // Les positions sont déjà transformées par le backend — pas de macros frontend
          const transform = (p: { x: number; y: number; z: number }) =>
            new THREE.Vector3(p.x, p.y, p.z);

          const cx = pos.reduce((s, p) => s + p.x, 0) / pos.length;
          const cy = pos.reduce((s, p) => s + p.y, 0) / pos.length;
          const cz = pos.reduce((s, p) => s + p.z, 0) / pos.length;
          handleRef.current.position.set(cx, cy, cz);

          // Mise à jour de la trajectory line — seulement si les positions ont changé
          const posKey = pos.length + ':' + pos[0]?.x + ',' + pos[0]?.y + ',' + pos[0]?.z;
          if (lastLineKeyRef.current !== posKey) {
            lastLineKeyRef.current = posKey;
            const linePoints = pos.map(transform);
            if (linePoints.length > 2) linePoints.push(linePoints[0].clone());
            const line = trajectoryLineRef.current;
            line.geometry.dispose();
            line.geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
            line.computeLineDistances();
          }
        }
      }

      // Rendu de la trajectory dessinée sur le canvas 2D overlay
      // Skip si rien n'a changé (drawnPoints + caméra) — évite le redraw à chaque frame
      const drawCanvas = drawCanvasRef.current;
      const drawnPts = drawnPointsRef.current;
      if (drawCanvas && drawnPts.length >= 2) {
        // Check si la caméra a bougé ou les points ont changé
        const camKey = camera.position.x + ',' + camera.position.y + ',' + camera.position.z + ',' + camera.rotation.x + ',' + camera.rotation.y;
        const ptsKey = drawnPts.length + ':' + (drawnPts[0]?.[0] ?? 0);
        const fullKey = camKey + '|' + ptsKey;
        if (lastDrawnKeyRef.current === fullKey) {
          // Rien n'a changé — skip le redraw
        } else {
          lastDrawnKeyRef.current = fullKey;
        const ctx = drawCanvas.getContext('2d');
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          const rect = drawCanvas.getBoundingClientRect();
          if (drawCanvas.width !== rect.width * dpr || drawCanvas.height !== rect.height * dpr) {
            drawCanvas.width = rect.width * dpr;
            drawCanvas.height = rect.height * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
          ctx.clearRect(0, 0, rect.width, rect.height);
          ctx.strokeStyle = '#ff8800';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.shadowColor = '#ff8800';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          const projVec = tmpVecRef.current;
          let first = true;
          for (const p of drawnPointsRef.current) {
            projVec.set(p[0], p[1], p[2]).project(camera);
            const sx = ((projVec.x + 1) / 2) * rect.width;
            const sy = ((-projVec.y + 1) / 2) * rect.height;
            if (first) { ctx.moveTo(sx, sy); first = false; }
            else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Draw start point marker (reuse projVec)
          projVec.set(drawnPointsRef.current[0][0], drawnPointsRef.current[0][1], drawnPointsRef.current[0][2]).project(camera);
          const startX = ((projVec.x + 1) / 2) * rect.width;
          const startY = ((-projVec.y + 1) / 2) * rect.height;
          ctx.fillStyle = '#ffaa00';
          ctx.beginPath();
          ctx.arc(startX, startY, 6, 0, Math.PI * 2);
          ctx.fill();
        }
        } // end else (redraw needed)
      }

      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      controls.dispose();
      // Disposer tous les objets Three.js pour éviter les fuites GPU
      objectsRef.current.forEach((obj) => {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      });
      objectsRef.current = [];
      holMarkersRef.current.forEach((m) => {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      holMarkersRef.current = [];
      // pathLinesRef est géré par TrajectoryVisualization (composant séparé)
      if (handleRef.current) {
        handleRef.current.geometry.dispose();
        (handleRef.current.material as THREE.Material).dispose();
        handleRef.current = null;
      }
      if (trajectoryLineRef.current) {
        trajectoryLineRef.current.geometry.dispose();
        (trajectoryLineRef.current.material as THREE.Material).dispose();
        trajectoryLineRef.current = null;
      }
      renderer.dispose();
      // CSS2DRenderer has no dispose() — just remove the DOM element
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
      if (containerRef.current && labelRenderer.domElement) {
        containerRef.current.removeChild(labelRenderer.domElement);
      }
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      labelRendererRef.current = null;
      controlsRef.current = null;
    };
    } catch (e) {
      console.error('Scene3D init failed:', e);
      setWebglFailed(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // ← deps vide : la scène n'est créée qu'une fois. Le ResizeObserver gère les resize.
}
