import { useEffect, useRef, MutableRefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { useGraphStore } from '../store/useGraphStore';
import type { HolProject } from '../store/useGraphStore';
import { strongestZoneInfluence } from '../utils/zoneMath';
import { toThree } from '../utils/coords';
import { sampleSpline } from '../utils/splineCore';
import { VIZ } from '../utils/uiColors';

/// Cache un mesh ET ses labels CSS2DObject enfants.
/// ATTENTION : CSS2DRenderer teste object.visible du CSS2DObject lui-même,
/// pas celui du parent — il faut toggler le flag sur les enfants (booléen
/// JS cheap, PAS d'écriture el.style.display — le renderer la gère).
function hideMeshAndLabels(mesh: THREE.Mesh) {
  mesh.visible = false;
  mesh.children.forEach((child) => {
    if ((child as any).isCSS2DObject) child.visible = false;
  });
}

function showMeshAndLabels(mesh: THREE.Mesh) {
  mesh.visible = true;
  mesh.children.forEach((child) => {
    if ((child as any).isCSS2DObject) child.visible = true;
  });
}

// Couleurs de tinte des objets affectés par une zone — match
// ZoneVisualization (tokens VIZ, une seule source).
const ZONE_MANUAL_TINT = VIZ.zoneManual;
const ZONE_GRAPH_TINT = VIZ.zoneGraph;

// Types des valeurs store lues dans le render loop
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
  macros: MacrosValue;
  manipulateMode: boolean;
  holProject: HolProject | null;
  drawnPoints: DrawnPointsValue;
  // Spline studio — CPs éditables + flag closed (preview miroir du backend).
  controlPoints: DrawnPointsValue;
  splineClosed: boolean;
  // Indices des CPs sélectionnés (outil edit) — highlight orange.
  cpSelection: ReadonlySet<number>;
  // Ensemble en cours de drag (multi-drag manipulate) — le render loop
  // garde les membres visibles au lieu de les cacher pendant le geste.
  draggingSetRef: MutableRefObject<Set<number>>;
  // Plan de travail du draw mode — le loop crée/oriente la grille de la
  // "feuille" (par l'origine) selon drawView ; pure visu, pas de handle.
  workPlaneRef: MutableRefObject<THREE.Group | null>;
  // Pour signaler l'échec WebGL
  setWebglFailed: (v: boolean) => void;
  dimensions: { width: number; height: number };
  /// Incrémenté pour forcer une ré-init (bouton Retry après échec WebGL).
  initKey?: number;
}

/**
 * Render loop critique 60fps.
 *
 * Crée la scène Three.js complète (caméra, renderer WebGL, CSS2DRenderer, lumières,
 * grille, axes, OrbitControls) et lance la boucle `animate()` via requestAnimationFrame.
 *
 * Les refs internes (macrosRef, movementsRef, etc.) sont créées DANS le hook et
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
  initKey = 0,
}: UseRenderLoopParams) {
  // Refs internes pour les valeurs changeantes — lues dans le render loop à 60fps
  const macrosRef = useRef(macros);
  const manipulateModeRef = useRef(manipulateMode);
  const holProjectRef = useRef(holProject);
  const drawnPointsRef = useRef(drawnPoints);
  const lastDrawnKeyRef = useRef('');
  const controlPointsRef = useRef(controlPoints);
  const splineClosedRef = useRef(splineClosed);
  const cpSelectionRef = useRef(cpSelection);
  const lastCpsRef = useRef<DrawnPointsValue | null>(null);
  const lastClosedRef = useRef(false);
  const lastSelRef = useRef<ReadonlySet<number> | null>(null);

  // Sync des refs à chaque render React (cheap — pas d'effet de bord)
  macrosRef.current = macros;
  manipulateModeRef.current = manipulateMode;
  holProjectRef.current = holProject;
  drawnPointsRef.current = drawnPoints;
  controlPointsRef.current = controlPoints;
  splineClosedRef.current = splineClosed;
  cpSelectionRef.current = cpSelection;

  // Init scene — ne se déclenche qu'une seule fois (deps = [])
  // Les dimensions initiales sont lues directement depuis le container
  // Le ResizeObserver (dans Scene3D) gère les resize ultérieurs sans recréer la scène
  useEffect(() => {
    if (!containerRef.current) return;
    if (sceneRef.current) return; // déjà initialisé

    // Capturer le container une fois — le cleanup doit retirer les DOM de CE
    // container même si le ref a été réassigné entre-temps.
    const container = containerRef.current;

    // Lire la taille réelle du container au moment de l'init
    const rect = container.getBoundingClientRect();
    const initW = Math.max(rect.width, 100);
    const initH = Math.max(rect.height, 100);

    try {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(VIZ.env.bg);
    scene.fog = new THREE.Fog(VIZ.env.bg, 15, 40);
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
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // CSS2D renderer for labels
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(initW, initH);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(labelRenderer.domElement);
    labelRendererRef.current = labelRenderer;

    // Lights
    const ambient = new THREE.AmbientLight(VIZ.env.ambient, 0.6);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(VIZ.env.key, 0.8);
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(VIZ.env.fill, 0.3);
    fillLight.position.set(-5, 3, -5);
    scene.add(fillLight);

    // Grid + axes
    const grid = new THREE.GridHelper(20, 20, VIZ.env.gridMajor, VIZ.env.gridMinor);
    scene.add(grid);
    const axes = new THREE.AxesHelper(3);
    scene.add(axes);

    // Plan de travail du draw mode — grille translucide, pure visu :
    // la "feuille" passe par l'origine, centrée sur le centroïde des
    // CPs. Visible uniquement en drawMode (repère utile en Front/Side
    // où la grille du sol n'existe pas).
    const workPlane = new THREE.Group();
    const wpGrid = new THREE.GridHelper(10, 10, VIZ.env.workplaneMajor, VIZ.env.workplaneMinor);
    (wpGrid.material as THREE.Material).transparent = true;
    (wpGrid.material as THREE.Material).opacity = 0.45;
    workPlane.add(wpGrid);
    workPlane.visible = false;
    scene.add(workPlane);
    workPlaneRef.current = workPlane;

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
    // Structures scratch réutilisées à chaque frame — évite les allocations
    // Map/Set/Color dans la boucle 60fps (pression GC constante).
    const scratch = {
      posMap: new Map<number, { index: number; x: number; y: number; z: number }>(),
      highlighted: new Set<number>(),
      focused: new Set<number>(),
      previewTracks: new Set<number>(),
      liveTracks: new Set<number>(),
      defaultColor: new THREE.Color(),
      zoneTint: new THREE.Color(),
    };
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
        const globalPos = storeState0.movementPositions['global'];
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
      const dragSet = draggingSetRef.current;

      // Structures scratch réutilisées à chaque frame — pas d'allocation
      // dans la boucle (Map/Set/Color recréés à 60fps = pression GC).
      const posMap = scratch.posMap; posMap.clear();
      const highlightedTracks = scratch.highlighted; highlightedTracks.clear();
      const focusedTracks = scratch.focused; focusedTracks.clear();
      const previewTracks = scratch.previewTracks; previewTracks.clear();
      const liveTracks = scratch.liveTracks; liveTracks.clear();
      const defaultColor = scratch.defaultColor;
      const zoneTint = scratch.zoneTint;

      const globalPos = mvPosMap['global'];
      const holTracks = holProj?.tracks ?? [];
      const manualIds = storeState.manualOscIds;
      // Prefs visualiseurs (Settings) — focus doux + fantômes au repos.
      const dimUnfocused = storeState.viewerDimUnfocused;
      const restGhosts = storeState.viewerRestGhosts;
      const trackPos = storeState.trackPositions;
      // Origine d'un objet — track_id-keyed : holTracks[objIdx].id en
      // mode .hol, manualOscIds[objIdx] sinon (même mapping que les labels).
      const restPosOf = (objIdx: number): [number, number, number] | undefined => {
        const trackId = holTracks[objIdx]?.id ?? manualIds[objIdx];
        return trackId != null ? trackPos?.[trackId] : undefined;
      };

      // ── Focus : slot sélectionné → la scène ne montre que SES tracks ──
      // Pas de slot sélectionné = vue d'ensemble (tous les moves/tracks).
      const editingSlotId = storeState.editingSlotId;
      const editingSlot = editingSlotId
        ? storeState.moveSlots.find((s) => s.id === editingSlotId)
        : null;
      const focusActive = !!editingSlot;
      if (focusActive) {
        editingSlot.trackIds.forEach((trackId) => {
          const idx = holProj
            ? holTracks.findIndex((t) => t.id === trackId)
            : manualIds.indexOf(trackId);
          if (idx >= 0) focusedTracks.add(idx);
        });
      }

      // Sets par move — une track est "preview" si un move preview la couvre
      // et qu'AUCUN move live ne la couvre (un move live gagne toujours).
      for (const mv of mvts) {
        const mvPos = mvPosMap[mv.id];
        if (!mvPos) continue;
        const target = mv.is_preview ? previewTracks : liveTracks;
        for (const p of mvPos) target.add(p.index);
      }

      if (mvts.length > 0 && globalPos) {
        // ── Mode multi-move : les positions arrivent du backend via 'global-positions' ──
        // Le MergeRuntime a déjà fait : merge + post-processing (macros, offset, etc.)
        // Le visualiseur est un viewer passif — il ne recalcule RIEN.
        for (const p of globalPos) posMap.set(p.index, p);

        // Tracks du move sélectionné → highlight (le set focused est déjà
        // calculé plus haut ; on ne highlight que si le slot est live)
        if (editingSlot?.movementId) {
          focusedTracks.forEach((idx) => highlightedTracks.add(idx));
        }

        // Zones actives — pour le highlight des objets affectés
        const manualZones = storeState.zones ?? [];
        const graphZones = storeState.graphZones ?? [];
        const hasZones = manualZones.length > 0 || graphZones.length > 0;

        // Cacher tous les meshes, puis réafficher ceux qui ont une position
        objs.forEach((mesh) => { hideMeshAndLabels(mesh); });

        objs.forEach((mesh, objIdx) => {
          // Membre en cours de drag : sa position est écrite par le
          // handler de drag — le loop ne la touche pas, mais l'objet
          // RESTE VISIBLE (avant : hide+skip → invisible pendant le drag).
          if (dragSet.has(objIdx)) {
            showMeshAndLabels(mesh);
            const dm = mesh.material as THREE.MeshStandardMaterial;
            dm.emissive.set(VIZ.obj.drag);
            dm.opacity = 1;
            dm.transparent = false;
            return;
          }
          // Focus : hors des tracks du slot édité → caché — ou ESTOMPÉ si
          // viewerDimUnfocused (Settings) — SAUF en assign : les non-membres
          // doivent rester visibles et cliquables sinon on ne peut jamais
          // AJOUTER une track, seulement retirer.
          const unfocused = focusActive && !focusedTracks.has(objIdx) && !storeState.assignMode;
          if (unfocused && !dimUnfocused) return;
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
            if (unfocused) {
              // Fantôme hors-sélection — l'objet garde sa couleur et sa
              // position réelles, rendu à ~20% pour marquer le focus.
              mat.emissive.set(VIZ.obj.off);
              mat.opacity = 0.22;
              mat.transparent = true;
              return;
            }

            // Preview : cyan uniquement pour les tracks couvertes par un move
            // preview ET par aucun move live (avant : UN move preview rendait
            // toute la scène cyan, on ne distinguait plus ce qui était on air).
            const isPreviewTrack = previewTracks.has(objIdx) && !liveTracks.has(objIdx);
            const isHighlighted = highlightedTracks.has(objIdx);
            const isSelected =
              storeState.selectedObjIndex === objIdx ||
              storeState.manipSelection.has(objIdx);
            if (isPreviewTrack) {
              mat.color.set(VIZ.obj.preview);
              mat.emissive.set(VIZ.obj.previewEmissive);
            } else if (isSelected) {
              // Parité radar : l'objet sélectionné (clic proximité) reçoit
              // le même highlight visible — emissive blanc au lieu de l'anneau.
              mat.emissive.set(VIZ.obj.selected);
            } else if (isHighlighted) {
              // Track du move sélectionné : emissive renforcé (blanc chaud)
              mat.emissive.set(VIZ.obj.hot);
            } else {
              // Track en mouvement normal : emissive léger de la même teinte
              mat.emissive.copy(mat.color).multiplyScalar(0.15);
            }

            // Assign : membre du slot édité = emissive vert (feedback du
            // toggle — le clic sur un non-membre l'allume), non-membre =
            // fortement atténué. Sans ça l'assign n'a aucun retour visuel.
            if (storeState.assignMode && editingSlot) {
              if (focusedTracks.has(objIdx)) {
                mat.emissive.set(VIZ.obj.assignMember);
                mat.opacity = 1;
                mat.transparent = false;
              } else {
                mat.emissive.set(VIZ.obj.off);
                mat.opacity = 0.3;
                mat.transparent = true;
              }
            }

            // Zone influence : tinte l'emissive vers la couleur de la zone
            // (violet si graph-déclarée domine, cyan si manuelle domine) —
            // l'objet "s'allume" proportionnellement à son influence.
            if (hasZones) {
              const inGraph = strongestZoneInfluence(graphZones, objIdx, p.x, p.y, p.z);
              const inManual = strongestZoneInfluence(manualZones, objIdx, p.x, p.y, p.z);
              const influence = Math.max(inGraph, inManual);
              if (influence > 0) {
                zoneTint.set(inGraph >= inManual ? ZONE_GRAPH_TINT : ZONE_MANUAL_TINT);
                mat.emissive.lerp(zoneTint, Math.min(influence, 1));
              }
            }
          } else {
            // Pas de position → manualPositions (statique), puis origine
            // en fantôme (viewerRestGhosts — un objet jamais animé reste
            // visible là où panic/le repos le place).
            const mp = storeState.manualPositions[objIdx];
            const rp = !mp && restGhosts ? restPosOf(objIdx) : undefined;
            const src = mp ?? rp;
            if (src) {
              const [tx, ty, tz] = toThree(src[0], src[1], src[2]);
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
            // Même feedback assign pour les objets sans position live.
            if (storeState.assignMode && editingSlot) {
              if (focusedTracks.has(objIdx)) {
                mat.emissive.set(VIZ.obj.assignMember);
              } else {
                mat.emissive.set(VIZ.obj.off);
                mat.opacity = 0.3;
                mat.transparent = true;
              }
            }
            // Fantôme au repos — après la normalisation matériau : très
            // estompé, aucun emissive (ce n'est pas une position live).
            if (!mp && rp && !storeState.assignMode) {
              mat.emissive.set(VIZ.obj.off);
              mat.opacity = unfocused ? 0.1 : 0.15;
              mat.transparent = true;
            }
          }
        });
      } else {
        // ── Mode statique : aucun move actif, OU positions pas encore arrivées
        // (transition après GO/recall — on montre les positions manuelles
        // plutôt qu'un flash de scène vide) ──
        const manualPos = storeState.manualPositions;
        const manipMode = manipulateModeRef.current;
        // Les modes qui cliquent sur les objets (assign) ou les placent
        // dans l'espace (zones) ont besoin de LES VOIR — sinon ils opèrent
        // à l'aveugle sur une scène vide quand aucun move ne tourne.
        const needsObjects =
          manipMode ||
          storeState.assignMode ||
          storeState.zonePlaceMode ||
          storeState.zoneEditMode ||
          // Draw aussi : on dessine une trajectoire AUTOUR des objets —
          // une scène vide rendrait le geste aveugle.
          storeState.drawMode;
        const showObjects = needsObjects || mvts.length > 0;
        objs.forEach((mesh) => { hideMeshAndLabels(mesh); });
        if (showObjects) {
          objs.forEach((mesh, i) => {
            // Membre en cours de drag : position gérée par le handler —
            // visible + marqué, pas effacé par le hide global.
            if (dragSet.has(i)) {
              showMeshAndLabels(mesh);
              const dm = mesh.material as THREE.MeshStandardMaterial;
              dm.emissive.set(VIZ.obj.drag);
              dm.opacity = 1;
              dm.transparent = false;
              return;
            }
            // Focus : hors des tracks du slot édité → caché ou estompé
            // (viewerDimUnfocused) — SAUF en assign (les non-membres
            // restent visibles pour être ajoutés).
            const unfocused = focusActive && !focusedTracks.has(i) && !storeState.assignMode;
            if (unfocused && !dimUnfocused) return;
            const p = manualPos[i];
            // Fantôme au repos — jamais animé : l'origine comme repère.
            const rp = !p && restGhosts ? restPosOf(i) : undefined;
            const src = p ?? rp;
            if (src) {
              const [tx, ty, tz] = toThree(src[0], src[1], src[2]);
              mesh.position.set(tx, ty, tz);
            }
            // Sans position manuelle l'objet garde sa position spawn —
            // affiché quand même : assign/zones doivent viser ce qui existe.
            if (src || needsObjects) {
              showMeshAndLabels(mesh);
              const mat = mesh.material as THREE.MeshStandardMaterial;
              // Normalisation à chaque frame — l'état style (assign,
              // sélection) dérive du store sans résidu à la sortie.
              mat.opacity = 1;
              mat.transparent = false;
              mat.emissive.setHSL(i / Math.max(objs.length, 1), 0.5, 0.2);
              if (storeState.assignMode && editingSlot) {
                // Feedback d'appartenance : membre = emissive vert,
                // non-membre = atténué — sinon le toggle n'a aucun retour.
                if (focusedTracks.has(i)) {
                  mat.emissive.set(VIZ.obj.assignMember);
                } else {
                  mat.emissive.set(VIZ.obj.off);
                  mat.opacity = 0.3;
                  mat.transparent = true;
                }
              } else if (storeState.manipulateMode && storeState.manipSelection.has(i)) {
                // Sélection manipulate = même accent que selectedObjIndex.
                mat.emissive.set(VIZ.obj.selected);
              }
              // Estompage — fantôme au repos (origine, pas position live)
              // ou objet hors-sélection en focus doux.
              if (unfocused) {
                mat.emissive.set(VIZ.obj.off);
                mat.opacity = 0.22;
                mat.transparent = true;
              } else if (!p && rp) {
                mat.emissive.set(VIZ.obj.off);
                mat.opacity = 0.15;
                mat.transparent = true;
              }
            }
          });
        }
      }


      // Hol markers : billboard + règle focus (slot sélectionné → seuls les
      // markers de ses tracks). visible=false cache aussi le label enfant.
      const camPos = camera.position;
      holMarkersRef.current.forEach((m, i) => {
        m.visible = !focusActive || focusedTracks.has(i) || storeState.assignMode;
        if (m.visible) m.lookAt(camPos);
      });

      // Mise à jour du handle + trajectory line en manipulate mode
      if (handleRef.current && trajectoryLineRef.current) {
        // Utiliser uniquement les positions du backend (global-positions) — pas de recalcul
        let pos: Array<{ index: number; x: number; y: number; z: number }> = [];
        if (mvts.length > 0) {
          pos = mvPosMap['global'] ?? [];
        }
        if (pos.length > 0) {
          // Les positions sont déjà transformées par le backend — pas de macros frontend
          const cx = pos.reduce((s, p) => s + p.x, 0) / pos.length;
          const cy = pos.reduce((s, p) => s + p.z, 0) / pos.length; // z=up → y
          const cz = pos.reduce((s, p) => s + p.y, 0) / pos.length; // y=depth → z
          handleRef.current.position.set(cx, cy, cz);

          // Mise à jour de la trajectory line EN PLACE — le buffer est
          // préalloué (capacité fixe), on réécrit les positions et on ajuste
          // le drawRange. Avant : dispose + new BufferGeometry chaque frame
          // (la clé changeait à chaque mouvement → churn GPU à 60fps).
          const line = trajectoryLineRef.current;
          const nPts = pos.length > 2 ? pos.length + 1 : pos.length; // fermeture du loop
          const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
          if (!attr || attr.count < nPts) {
            // Capacité insuffisante — recréer une fois (rare : le nb de points
            // ne grandit qu'avec le nb de tracks)
            const capacity = Math.max(nPts * 2, 256);
            line.geometry.dispose();
            line.geometry = new THREE.BufferGeometry();
            line.geometry.setAttribute(
              'position',
              new THREE.BufferAttribute(new Float32Array(capacity * 3), 3),
            );
          }
          const arr = (line.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
          for (let i = 0; i < pos.length; i++) {
            arr[i * 3] = pos[i].x;
            arr[i * 3 + 1] = pos[i].z; // backend z=up → three y
            arr[i * 3 + 2] = pos[i].y; // backend y=depth → three z
          }
          if (pos.length > 2) {
            const last = pos.length * 3;
            arr[last] = pos[0].x;
            arr[last + 1] = pos[0].z;
            arr[last + 2] = pos[0].y;
          }
          const posAttr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
          posAttr.needsUpdate = true;
          line.geometry.setDrawRange(0, nPts);
          line.computeLineDistances();
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
        // Retirer l'ancien marqueur de départ aussi — sinon une sphère
        // s'accumule à chaque point ajouté pendant le dessin (fuite).
        const oldStart = scene.getObjectByName('__drawSplineStart') as THREE.Mesh | undefined;
        if (oldStart) {
          scene.remove(oldStart);
          oldStart.geometry.dispose();
          (oldStart.material as THREE.Material).dispose();
        }
        if (drawnPts.length >= 2) {
          const linePoints = drawnPts.map((p) => {
            const [tx, ty, tz] = toThree(p[0], p[1], p[2]);
            return new THREE.Vector3(tx, ty, tz);
          });
          const geom = new THREE.BufferGeometry().setFromPoints(linePoints);
          const mat = new THREE.LineBasicMaterial({ color: VIZ.draw.stroke });
          const line = new THREE.Line(geom, mat);
          line.name = '__drawSplineLine';
          scene.add(line);
          // Marqueur de point de départ
          const startGeom = new THREE.SphereGeometry(0.08, 16, 16);
          const startMat = new THREE.MeshBasicMaterial({ color: VIZ.draw.start });
          const startMarker = new THREE.Mesh(startGeom, startMat);
          startMarker.name = '__drawSplineStart';
          startMarker.position.copy(linePoints[0]);
          scene.add(startMarker);
        }
      }

      // ── Spline studio : preview de la courbe fittée + marqueurs CP ──
      // La preview échantillonne le même Catmull-Rom que le backend
      // (splineCore) — ce qu'on voit est ce qui sera émis.
      const cps = controlPointsRef.current;
      const closed = splineClosedRef.current;
      // Les CPs sont immutables (nouvel array à chaque édition) — rebuild
      // seulement sur changement de référence ou de flag, jamais par frame.
      const cpsDirty = lastCpsRef.current !== cps || lastClosedRef.current !== closed;
      if (cpsDirty) {
        lastCpsRef.current = cps;
        lastClosedRef.current = closed;

        // Marqueurs CP — rebuild quand le count change, sinon reposition.
        // Deux matériaux partagés stockés en userData : cyan par défaut,
        // orange pour les CPs sélectionnés (assignation par index).
        let cpGroup = scene.getObjectByName('__splineCps') as THREE.Group | undefined;
        if (cpGroup && cpGroup.children.length !== cps.length) {
          const ud = cpGroup.userData as { geom?: THREE.BufferGeometry; matBase?: THREE.Material; matSel?: THREE.Material };
          ud.geom?.dispose();
          ud.matBase?.dispose();
          ud.matSel?.dispose();
          scene.remove(cpGroup);
          cpGroup = undefined;
        }
        if (!cpGroup && cps.length > 0) {
          cpGroup = new THREE.Group();
          cpGroup.name = '__splineCps';
          const geom = new THREE.SphereGeometry(0.09, 12, 12);
          const matBase = new THREE.MeshBasicMaterial({ color: VIZ.draw.cp });
          const matSel = new THREE.MeshBasicMaterial({ color: VIZ.draw.cpSel });
          cpGroup.userData = { geom, matBase, matSel };
          for (let i = 0; i < cps.length; i++) cpGroup.add(new THREE.Mesh(geom, matBase));
          scene.add(cpGroup);
        }
        if (cpGroup) {
          const sel = cpSelectionRef.current;
          cps.forEach((p, i) => {
            const m = cpGroup!.children[i] as THREE.Mesh | undefined;
            if (m) {
              const [tx, ty, tz] = toThree(p[0], p[1], p[2]);
              m.position.set(tx, ty, tz);
              m.material = sel.has(i) ? cpGroup!.userData.matSel : cpGroup!.userData.matBase;
            }
          });
        }

        // Preview de la courbe fittée (cyan).
        const oldPrev = scene.getObjectByName('__splinePreview') as THREE.Line | undefined;
        if (oldPrev) {
          scene.remove(oldPrev);
          oldPrev.geometry.dispose();
          (oldPrev.material as THREE.Material).dispose();
        }
        if (cps.length >= 2) {
          const preview = sampleSpline(cps, closed, 0.5, 160);
          const linePoints = preview.map((p) => {
            const [tx, ty, tz] = toThree(p[0], p[1], p[2]);
            return new THREE.Vector3(tx, ty, tz);
          });
          const geom = new THREE.BufferGeometry().setFromPoints(linePoints);
          const mat = new THREE.LineBasicMaterial({ color: VIZ.draw.preview });
          const line = new THREE.Line(geom, mat);
          line.name = '__splinePreview';
          scene.add(line);
        }
      }

      // Highlight sélection hors rebuild — la sélection change sans que
      // les CPs bougent (marquee, shift+clic) : recolor seul, pas de
      // rebuild de la preview. La Set est recréée à chaque mutation.
      const sel = cpSelectionRef.current;
      if (lastSelRef.current !== sel) {
        lastSelRef.current = sel;
        // Si cpsDirty a déjà tourné cette frame, les matériaux sont à
        // jour (le bloc ci-dessus assigne sel.has(i)) — sinon recolor.
        const grp = scene.getObjectByName('__splineCps') as THREE.Group | undefined;
        if (grp && !cpsDirty) {
          grp.children.forEach((m, i) => {
            (m as THREE.Mesh).material = sel.has(i) ? grp.userData.matSel : grp.userData.matBase;
          });
        }
      }

      // Plan de travail — "feuille" passant par l'origine, orientée
      // selon la vue, centrée sur le centroïde des CPs (origine sinon).
      // Epsilon sur la normale pour éviter le z-fighting avec la grille
      // du sol en vue top. Visible uniquement en drawMode.
      const wp = workPlaneRef.current;
      if (wp) {
        const dw = storeState.drawMode;
        wp.visible = dw;
        if (dw) {
          const v = storeState.drawView;
          let ax = 0, ay = 0, az = 0;
          if (cps.length > 0) {
            for (const p of cps) {
              const [tx, ty, tz] = toThree(p[0], p[1], p[2]);
              ax += tx; ay += ty; az += tz;
            }
            ax /= cps.length; ay /= cps.length; az /= cps.length;
          }
          const eps = 0.001;
          wp.rotation.set(0, 0, 0);
          if (v === 'front') {
            wp.rotation.x = Math.PI / 2; // grille → plan XY (normale three z)
            wp.position.set(ax, ay, eps);
          } else if (v === 'side') {
            wp.rotation.z = Math.PI / 2; // grille → plan YZ (normale three x)
            wp.position.set(eps, ay, az);
          } else {
            wp.position.set(ax, eps, az); // top/free — normale three y
          }
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
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      if (labelRenderer.domElement.parentNode === container) {
        container.removeChild(labelRenderer.domElement);
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
  }, [initKey]); // ← la scène n'est créée qu'une fois par initKey (Retry WebGL
  // incrémente → cleanup + ré-init). Le ResizeObserver gère les resize.
}
