import { useEffect, useRef, MutableRefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { useGraphStore } from '../store/useGraphStore';
import type { HolProject } from '../store/useGraphStore';
import { strongestZoneInfluence } from '../utils/zoneMath';

/// Conversion backend (x, y, z) où z=up → Three.js (x, z, y) où y=up
/// Le spatial audio utilise Z-up ; Three.js utilise Y-up.
function toThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y];
}

/// Cache un mesh ET ses labels CSS2DObject enfants explicitement.
/// Le CSS2DRenderer devrait le faire via la hiérarchie, mais on force pour être sûr.
function hideMeshAndLabels(mesh: THREE.Mesh) {
  mesh.visible = false;
  mesh.children.forEach((child) => {
    if ((child as any).isCSS2DObject) {
      child.visible = false;
      const el = (child as any).element as HTMLElement | undefined;
      if (el) el.style.display = 'none';
    }
  });
}

/// Montre un mesh ET ses labels CSS2DObject enfants.
function showMeshAndLabels(mesh: THREE.Mesh) {
  mesh.visible = true;
  mesh.children.forEach((child) => {
    if ((child as any).isCSS2DObject) {
      child.visible = true;
      // Ne pas forcer display:'' ici — le CSS2DRenderer le gère
      // en fonction de la projection caméra au prochain render
    }
  });
}

// Couleurs de tinte des objets affectés par une zone — match ZoneVisualization
const ZONE_MANUAL_TINT = 0x22d3ee; // cyan — zones manuelles
const ZONE_GRAPH_TINT = 0x8b5cf6; // violet — zones graph-déclarées

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
  // NOTE: movementPositions et movements sont lus via getState() dans la boucle
  // pour éviter 60 re-renders React par seconde.
  positions: PositionArray;
  macros: MacrosValue;
  assignMode: boolean;
  manipulateMode: boolean;
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
  macros,
  assignMode,
  manipulateMode,
  selectedTrackIds,
  holProject,
  drawnPoints,
  draggingObjectRef,
  manualPositions,
  setWebglFailed,
}: UseRenderLoopParams) {
  // Refs internes pour les valeurs changeantes — lues dans le render loop à 60fps
  const positionsRef = useRef(positions);
  const macrosRef = useRef(macros);
  const assignModeRef = useRef(assignMode);
  const manipulateModeRef = useRef(manipulateMode);
  const selectedTrackIdsRef = useRef(selectedTrackIds);
  const holProjectRef = useRef(holProject);
  const drawnPointsRef = useRef(drawnPoints);
  const manualPositionsRef = useRef(manualPositions);
  const lastLineKeyRef = useRef('');
  const lastDrawnKeyRef = useRef('');

  // Sync des refs à chaque render React (cheap — pas d'effet de bord)
  positionsRef.current = positions;
  macrosRef.current = macros;
  assignModeRef.current = assignMode;
  manipulateModeRef.current = manipulateMode;
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
      renderer = new THREE.WebGLRenderer({ antialias: false, failIfMajorPerformanceCaveat: false });
    } catch (e) {
      console.error('WebGL init failed:', e);
      setWebglFailed(true);
      return;
    }
    renderer.setSize(initW, initH);
    // Limiter le pixel ratio à 1.5 — sur HiDPI, devicePixelRatio=2 ou 3
    // multiplie le travail GPU par 4x ou 9x pour un bénéfice visuel minimal
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
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
    let renderFrameCount = 0;
    let renderStutterCount = 0;
    let renderLastPerf = performance.now();
    let renderLastFrameTime = performance.now();
    let animateTotalMs = 0;
    const animate = () => {
      const animateStart = performance.now();
      animationId = requestAnimationFrame(animate);
      const frameNow = performance.now();
      const frameDelta = frameNow - renderLastFrameTime;
      renderLastFrameTime = frameNow;
      controls.update();

      // Debug FPS — log toutes les ~2s
      renderFrameCount++;
      if (frameDelta > 25) renderStutterCount++;
      if (frameNow - renderLastPerf > 2000) {
        const fps = renderFrameCount / ((frameNow - renderLastPerf) / 1000);
        const storeState0 = useGraphStore.getState();
        const globalPos = (storeState0.movementPositions as any)['global'];
        // Mettre à jour l'objet debug (pas de set() React)
        const dp = (window as any).__debugPerf;
        if (dp) {
          dp.renderFps = fps;
          dp.renderStutter = renderStutterCount;
          dp.posLen = globalPos?.length ?? 0;
          dp.mvts = storeState0.movements.length;
          dp.animateMs = animateTotalMs;
        }
        renderFrameCount = 0;
        renderStutterCount = 0;
        renderLastPerf = frameNow;
      }

      // ── Mise à jour des positions dans le render loop (pas de useEffect) ──
      // Lit les refs au lieu des props React — évite les re-renders à 60fps.
      // movements et movementPositions sont lus via getState() car ils changent
      // à 60fps (event global-positions) — un abonnement React déclencherait
      // 60 re-renders/seconde de tout Scene3D et ses enfants.
      const objs = objectsRef.current;
      const storeState = useGraphStore.getState();
      const mvts = storeState.movements;
      const mvPosMap = storeState.movementPositions;
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

          // Déterminer les tracks du move sélectionné (editingSlotId → movementId → track_indices)
          const editingSlotId = storeState.editingSlotId;
          const selectedMove = editingSlotId
            ? storeState.moveSlots.find((s) => s.id === editingSlotId && s.movementId)
            : null;
          const selectedMoveInfo = selectedMove
            ? mvts.find((mv) => mv.id === selectedMove.movementId)
            : null;
          // Construire le set des track_indices du move sélectionné
          const highlightedTracks = new Set<number>();
          if (selectedMoveInfo) {
            // Le move a des osc_ids ; on doit retrouver les track_indices via holProject
            // En mode multi-move, les positions sont indexées par track_index global.
            // On highlight les tracks dont les positions sont dans ce move.
            // Pour simplifier, on compare les osc_ids du move avec les osc_ids globaux.
            // Mais plus simple : le render loop connaît objIdx (track_index).
            // On peut retrouver les track_indices du move via le store.
            const slot = storeState.moveSlots.find((s) => s.id === editingSlotId);
            if (slot?.trackIds) {
              // trackIds sont des osc_ids (track.id du projet hol)
              // Convertir en track_indices
              if (holProj) {
                slot.trackIds.forEach((trackId) => {
                  const idx = holProj.tracks.findIndex((t) => t.id === trackId);
                  if (idx >= 0) highlightedTracks.add(idx);
                });
              }
            }
          }

          // Couleur par défaut si pas de hol
          const defaultColor = new THREE.Color();
          const holTracks = holProj?.tracks ?? [];

          // Zones actives — pour le highlight des objets affectés
          const manualZones = storeState.zones ?? [];
          const graphZones = storeState.graphZones ?? [];
          const hasZones = !assignMode && (manualZones.length > 0 || graphZones.length > 0);
          const zoneTint = new THREE.Color();

          // D'abord, cacher tous les meshes qui ne sont pas dans posMap
          // (ils seront remis en position manuelle si pas en mode assign)
          objs.forEach((mesh) => { hideMeshAndLabels(mesh); });

          // Ensuite, appliquer les positions du backend à chaque mesh par index
          objs.forEach((mesh, objIdx) => {
            if (dragObj !== null && objIdx === dragObj) return;
            const p = posMap.get(objIdx);
            if (p) {
              const [tx, ty, tz] = toThree(p.x, p.y, p.z);
              mesh.position.set(tx, ty, tz);
              showMeshAndLabels(mesh);
              const mat = mesh.material as THREE.MeshStandardMaterial;

              // Couleur d'origine : couleur hol de la track, ou HSL par défaut
              const holTrack = holTracks[objIdx];
              if (holTrack?.color) {
                mat.color.set(holTrack.color);
              } else {
                defaultColor.setHSL(objIdx / Math.max(objs.length, 1), 0.7, 0.55);
                mat.color.copy(defaultColor);
              }

              // Emissive : léger pour toutes les tracks en mouvement, renforcé pour le move sélectionné
              const isHighlighted = highlightedTracks.has(objIdx);
              const isPreview = mvts.some((mv) => mv.is_preview);
              if (isPreview) {
                // Preview : cyan override
                mat.color.setHex(0x00ccff);
                mat.emissive.setHex(0x003344);
              } else if (isHighlighted) {
                // Track du move sélectionné : emissive renforcé (blanc chaud)
                mat.emissive.setHex(0x664400);
              } else {
                // Track en mouvement normal : emissive léger de la même teinte
                mat.emissive.copy(mat.color).multiplyScalar(0.15);
              }

              // Zone influence : tinte l'emissive vers la couleur de la zone
              // (violet si graph-déclarée domine, cyan si manuelle domine) —
              // l'objet "s'allume" proportionnellement à son influence.
              if (hasZones) {
                const inGraph = strongestZoneInfluence(graphZones, objIdx, p.x, p.y, p.z);
                const inManual = strongestZoneInfluence(manualZones, objIdx, p.x, p.y, p.z);
                const influence = Math.max(inGraph, inManual);
                if (influence > 0) {
                  zoneTint.setHex(inGraph >= inManual ? ZONE_GRAPH_TINT : ZONE_MANUAL_TINT);
                  mat.emissive.lerp(zoneTint, Math.min(influence, 1));
                }
              }
            } else if (!assignMode) {
              // Pas de position pour cet objet → manualPositions (statique)
              const manualPos = manualPositionsRef.current;
              const mp = manualPos[objIdx];
              if (mp) {
                const [tx, ty, tz] = toThree(mp[0], mp[1], mp[2]);
                mesh.position.set(tx, ty, tz);
                showMeshAndLabels(mesh);
              }
              const mat = mesh.material as THREE.MeshStandardMaterial;
              // Couleur hol ou HSL par défaut
              const holTrack = holTracks[objIdx];
              if (holTrack?.color) {
                mat.color.set(holTrack.color);
              } else {
                mat.color.setHSL(objIdx / Math.max(objs.length, 1), 0.7, 0.55);
              }
              mat.emissive.setHSL(objIdx / Math.max(objs.length, 1), 0.5, 0.2);
              mat.opacity = 1.0;
              mat.transparent = false;
            }
          });
        } else {
          // globalPos est undefined (moves en cours de stop, positions pas encore arrivées)
          // Cacher tous les meshes pour éviter les labels orphelins sur la dernière trajectoire
          objs.forEach((mesh) => { hideMeshAndLabels(mesh); });
        }
      } else {
        // ── Mode statique : aucun move actif ──
        // Les hol markers (anneaux + labels "TrackName (#19)") suffisent pour
        // afficher les positions .hol. Les sphères objets ne sont montrées
        // qu'en manipulate mode (pour le drag) ou assign mode (pour la sélection).
        const manualPos = manualPositionsRef.current;
        const manipMode = manipulateModeRef.current;
        const asgnMode = assignModeRef.current;
        objs.forEach((mesh) => { hideMeshAndLabels(mesh); });
        if (manipMode || asgnMode) {
          objs.forEach((mesh, i) => {
            if (dragObj !== null && i === dragObj) return;
            const p = manualPos[i];
            if (p) {
              const [tx, ty, tz] = toThree(p[0], p[1], p[2]);
              mesh.position.set(tx, ty, tz);
              showMeshAndLabels(mesh);
            }
          });
        }
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
          const transform = (p: { x: number; y: number; z: number }) => {
            const [tx, ty, tz] = toThree(p.x, p.y, p.z);
            return new THREE.Vector3(tx, ty, tz);
          };

          const cx = pos.reduce((s, p) => s + p.x, 0) / pos.length;
          const cy = pos.reduce((s, p) => s + p.z, 0) / pos.length; // z=up → y
          const cz = pos.reduce((s, p) => s + p.y, 0) / pos.length; // y=depth → z
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

      // Rendu de la trajectory dessinée — ligne 3D dans la scène (bouge avec la caméra)
      const drawCanvas = drawCanvasRef.current;
      const drawnPts = drawnPointsRef.current;
      if (drawCanvas) {
        // Toujours clearer le canvas 2D overlay — le spline est rendu en 3D maintenant
        const ctx = drawCanvas.getContext('2d');
        if (ctx) {
          const rect = drawCanvas.getBoundingClientRect();
          ctx.clearRect(0, 0, rect.width, rect.height);
        }
      }
      // Rendu 3D du spline dessiné via une ligne dans la scène
      const ptsKey = drawnPts.length + ':' + (drawnPts[0]?.[0] ?? 0);
      if (lastDrawnKeyRef.current !== ptsKey) {
        lastDrawnKeyRef.current = ptsKey;
        // Retirer l'ancienne ligne de spline
        const oldLine = scene.getObjectByName('__drawSplineLine') as THREE.Line | undefined;
        if (oldLine) {
          scene.remove(oldLine);
          oldLine.geometry.dispose();
          (oldLine.material as THREE.Material).dispose();
        }
        if (drawnPts.length >= 2) {
          const linePoints = drawnPts.map((p) => {
            const [tx, ty, tz] = toThree(p[0], p[1], p[2]);
            return new THREE.Vector3(tx, ty, tz);
          });
          const geom = new THREE.BufferGeometry().setFromPoints(linePoints);
          const mat = new THREE.LineBasicMaterial({ color: 0xff8800, linewidth: 3 });
          const line = new THREE.Line(geom, mat);
          line.name = '__drawSplineLine';
          scene.add(line);
          // Marqueur de point de départ
          const startGeom = new THREE.SphereGeometry(0.08, 16, 16);
          const startMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
          const startMarker = new THREE.Mesh(startGeom, startMat);
          startMarker.name = '__drawSplineStart';
          startMarker.position.copy(linePoints[0]);
          scene.add(startMarker);
        }
      }

      // Timing précis des phases du render loop
      const t0 = performance.now();
      renderer.render(scene, camera);
      const t1 = performance.now();
      labelRenderer.render(scene, camera);
      const t2 = performance.now();
      // Mettre à jour debugPerf avec le timing
      const dp = (window as any).__debugPerf;
      if (dp) {
        dp.glMs = t1 - t0;
        dp.labelMs = t2 - t1;
      }
      animateTotalMs = performance.now() - animateStart;
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
      // Cleanup draw spline line + start marker
      const drawLine = scene.getObjectByName('__drawSplineLine') as THREE.Line | undefined;
      if (drawLine) {
        scene.remove(drawLine);
        drawLine.geometry.dispose();
        (drawLine.material as THREE.Material).dispose();
      }
      const drawStart = scene.getObjectByName('__drawSplineStart') as THREE.Mesh | undefined;
      if (drawStart) {
        scene.remove(drawStart);
        drawStart.geometry.dispose();
        (drawStart.material as THREE.Material).dispose();
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
