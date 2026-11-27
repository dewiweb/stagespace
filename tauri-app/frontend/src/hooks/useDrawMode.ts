import { useRef, useState, useCallback, useEffect, MutableRefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useGraphStore } from '../store/useGraphStore';
import { fromThree, toThree } from '../utils/coords';
import { deleteCp, insertCpAtU, nearestU, type DrawView, type Vec3 } from '../utils/splineCore';
import {
  writeSplineClipboard, readSplineClipboard,
  serializeSplineClipboard, parseSplineClipboard,
} from '../utils/graphClipboard';

interface UseDrawModeParams {
  cameraRef: MutableRefObject<THREE.PerspectiveCamera | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  controlsRef: MutableRefObject<OrbitControls | null>;
  // Span de la status bar pour le readout curseur (coords monde sur la
  // feuille) — muté direct : les mousemove 60Hz ne passent pas par React.
  cursorReadoutRef: MutableRefObject<HTMLSpanElement | null>;
}

/** Seuil de hit CP en pixels — cohérent avec la proximité objet (~40px). */
const CP_HIT_PX = 24;

/** Dead-zone du marquee (px) — distingue clic à vide (désélection) du
 * drag à vide (rectangle de sélection). */
const MARQUEE_PX = 4;

/** Plan de dessin Three.js par vue — la feuille passe par l'origine :
 * la 3e coordonnée s'ajuste depuis les vues d'élévation, pas via un
 * offset parallèle (paramètre retiré — redondant avec Front/Side). */
function drawPlane(view: DrawView, offset: number): THREE.Plane {
  switch (view) {
    case 'front':
      // Élévation : plan (x, z) à backend y = offset → three z = offset.
      return new THREE.Plane(new THREE.Vector3(0, 0, 1), -offset);
    case 'side':
      // Élévation latérale : plan (y, z) à backend x = offset → three x = offset.
      return new THREE.Plane(new THREE.Vector3(1, 0, 0), -offset);
    case 'top':
    case 'free':
    default:
      // Plan : (x, y) à backend z = offset → three y = offset.
      return new THREE.Plane(new THREE.Vector3(0, 1, 0), -offset);
  }
}

interface SavedCam {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  up: THREE.Vector3;
  target: THREE.Vector3;
}

/**
 * Spline studio — mode dessin/édition de trajectoires.
 *
 * Trois outils (drawModeSlice.splineTool) :
 * - `freehand` : drag = stroke brut → pointerup fit en CPs → bascule `edit`
 * - `place`    : clic = ajout de point de contrôle
 * - `edit`     : drag CP (= drag de la sélection) / Shift+clic CP =
 *   toggle sélection / drag à vide = marquee / clic-droit CP = delete /
 *   double-clic = insert
 * Le commit (écriture dans le node) est explicité par le bouton Done.
 */
export function useDrawMode({ cameraRef, containerRef, controlsRef, cursorReadoutRef }: UseDrawModeParams) {
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  // Anchor CP du group-drag + flag "a réellement bougé" (le clic sur un
  // membre sans mouvement collapse la sélection à ce seul CP au release).
  const draggingCpRef = useRef<number | null>(null);
  const cpDragMovedRef = useRef(false);
  // Marquee (edit, drag à vide) : {x,y,shift} = pos de départ ; le flag
  // active s'arme au-delà de la dead-zone. Le div DOM est muté direct.
  const marqueeRef = useRef<{ x: number; y: number; shift: boolean } | null>(null);
  const marqueeActiveRef = useRef(false);
  const marqueeDivRef = useRef<HTMLDivElement | null>(null);
  const savedCamRef = useRef<SavedCam | null>(null);

  const drawMode = useGraphStore((s) => s.drawMode);
  const drawView = useGraphStore((s) => s.drawView);
  const topOri = useGraphStore((s) => s.viewerTopOrientation);

  // ── Vues fixées : snap caméra + verrou rotation + restore sur 'free' ──
  // Actives dans TOUS les modes (inspection ortho, pas seulement le draw) :
  // le snap préserve la cible et la distance (framing gardé), pan/zoom
  // restent actifs, seule la rotation est verrouillée (convention CAD).
  // ── Vues fixées : snap caméra + verrou rotation + restore sur 'free' ──
  // Actives dans TOUS les modes (inspection ortho, pas seulement le draw) :
  // le snap préserve la cible et la distance (framing gardé), pan/zoom
  // restent actifs, seule la rotation est verrouillée (convention CAD).
  // Retry RAF : une vue persistée (ex. 'top') hydratée au mount doit
  // s'appliquer dès que cameraRef/controlsRef sont peuplés — un early
  // return laisserait la vue active sans jamais snapper la caméra.
  useEffect(() => {
    let raf = 0;
    const apply = () => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !controls) {
        raf = requestAnimationFrame(apply);
        return;
      }
      const view = drawView;
      if (view === 'free') {
        if (savedCamRef.current) {
          camera.position.copy(savedCamRef.current.pos);
          camera.quaternion.copy(savedCamRef.current.quat);
          camera.up.copy(savedCamRef.current.up);
          controls.target.copy(savedCamRef.current.target);
          savedCamRef.current = null;
        }
        controls.enableRotate = true;
        controls.update();
        return;
      }
      if (!savedCamRef.current) {
        savedCamRef.current = {
          pos: camera.position.clone(),
          quat: camera.quaternion.clone(),
          up: camera.up.clone(),
          target: controls.target.clone(),
        };
      }
      const t = controls.target;
      const d = Math.max(camera.position.distanceTo(t), 2);
      camera.up.set(0, 1, 0);
      // Epsilon latéral sur la vue top — évite la singularité de pôle
      // exacte d'OrbitControls (azimuth indéterminé à polar=0).
      // Orientation top/side — réglage utilisateur partagé avec le radar
      // (les deux viewers montrent le même sens, quel que soit le choix).
      // 'upstage-up' : +Y en haut d'écran (avec −X à droite — cohérence
      // caméra physique) ; 'downstage-up' = rotation 180°.
      const up = topOri === 'upstage-up' ? 1 : -1;
      if (view === 'top') {
        camera.up.set(0, 0, up); // ±z three = ±y backend en haut de l'écran
        camera.position.set(t.x, t.y + d, t.z + d * 0.001);
      } else if (view === 'front') {
        camera.position.set(t.x, t.y, t.z + d);
      } else {
        // side : le profil suit la même rotation — 'upstage-up' se voit
        // depuis +x (−y à droite), 'downstage-up' depuis −x (+y à droite).
        camera.position.set(t.x + d * up, t.y, t.z);
      }
      controls.enableRotate = false;
      controls.update();
    };
    apply();
    return () => cancelAnimationFrame(raf);
  }, [drawView, topOri, cameraRef, controlsRef]);

  // Convert screen coords to world coords on the view's drawing plane
  const screenToWorld = useCallback(
    (screenX: number, screenY: number): [number, number, number] | null => {
      const camera = cameraRef.current;
      const container = containerRef.current;
      if (!camera || !container) return null;

      const rect = container.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((screenX - rect.left) / rect.width) * 2 - 1,
        -((screenY - rect.top) / rect.height) * 2 + 1,
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);

      const plane = drawPlane(useGraphStore.getState().drawView, 0);
      const intersection = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, intersection)) {
        // Convertir Three.js (x, y=up, z=depth) → backend (x, y=depth, z=up)
        return fromThree(intersection.x, intersection.y, intersection.z);
      }
      return null;
    },
    [cameraRef, containerRef],
  );

  // Projection world→pixels de tous les CPs — base commune du hit-test
  // et du marquee (pas de raycast : les CPs sont des positions connues).
  const cpScreenPositions = useCallback((): Array<{ x: number; y: number }> => {
    const camera = cameraRef.current;
    const container = containerRef.current;
    const cps = useGraphStore.getState().controlPoints;
    if (!camera || !container || cps.length === 0) return [];

    const rect = container.getBoundingClientRect();
    const v = new THREE.Vector3();
    return cps.map((p) => {
      const [tx, ty, tz] = toThree(p[0], p[1], p[2]);
      v.set(tx, ty, tz).project(camera);
      return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height };
    });
  }, [cameraRef, containerRef]);

  // Index du CP le plus proche du curseur (< CP_HIT_PX écran).
  const cpIndexAt = useCallback(
    (screenX: number, screenY: number): number | null => {
      const container = containerRef.current;
      const positions = cpScreenPositions();
      if (!container || positions.length === 0) return null;

      const rect = container.getBoundingClientRect();
      const px = screenX - rect.left;
      const py = screenY - rect.top;
      let best: number | null = null;
      let bestD = CP_HIT_PX;
      for (let i = 0; i < positions.length; i++) {
        const d = Math.hypot(positions[i].x - px, positions[i].y - py);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    },
    [containerRef, cpScreenPositions],
  );

  const handleDrawStart = useCallback(
    (e: React.PointerEvent) => {
      if (!drawMode) return;
      const st = useGraphStore.getState();

      if (st.splineTool === 'edit' && e.button === 2) {
        // Clic-droit sur un CP = suppression.
        const idx = cpIndexAt(e.clientX, e.clientY);
        if (idx !== null) st.setControlPoints(deleteCp(st.controlPoints, idx));
        return;
      }
      if (e.button !== 0) return; // autres boutons : release/gestes transverses

      const world = screenToWorld(e.clientX, e.clientY);
      if (!world) return;

      if (st.splineTool === 'place') {
        st.setControlPoints([...st.controlPoints, world]);
        return;
      }

      if (st.splineTool === 'edit') {
        const idx = cpIndexAt(e.clientX, e.clientY);
        if (idx !== null) {
          if (e.shiftKey) {
            st.toggleCpSelection(idx); // Shift+clic CP = toggle, pas de drag
            return;
          }
          // Le CP draggé doit faire partie de la sélection — sinon elle
          // devient {idx} (convention éditeurs vectoriels). Clic sur un
          // membre sans bouger = collapse au release (voir handleDrawEnd).
          if (!st.cpSelection.has(idx)) st.setCpSelection(new Set([idx]));
          st.pushCpSnapshot(); // un seul snapshot pour tout le drag
          draggingCpRef.current = idx;
          cpDragMovedRef.current = false;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        } else {
          // Drag à vide = marquee de sélection ; dead-zone pour
          // distinguer le clic (désélection) du rectangle.
          marqueeRef.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
          marqueeActiveRef.current = false;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }
        return;
      }

      // freehand — collecte du stroke brut
      st.clearDrawnPoints();
      st.addDrawnPoint(world);
      setIsDrawing(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [drawMode, screenToWorld, cpIndexAt],
  );

  // Readout curseur — coords monde sur la feuille de la vue active,
  // écrites dans le span de la status bar (footer éditeur).
  const updateCursorReadout = useCallback(
    (screenX: number, screenY: number) => {
      const span = cursorReadoutRef.current;
      if (!span) return;
      const w = screenToWorld(screenX, screenY);
      span.textContent = w ? `x ${w[0].toFixed(2)}  y ${w[1].toFixed(2)}  z ${w[2].toFixed(2)}` : '';
    },
    [screenToWorld, cursorReadoutRef],
  );

  const handleDrawMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawMode) return;
      updateCursorReadout(e.clientX, e.clientY);
      const st = useGraphStore.getState();

      // Marquee : drag à vide en edit = rectangle de sélection. Armé
      // après dead-zone ; le div DOM est muté direct (pas de re-render).
      if (marqueeRef.current) {
        const m = marqueeRef.current;
        if (!marqueeActiveRef.current) {
          if (Math.hypot(e.clientX - m.x, e.clientY - m.y) < MARQUEE_PX) return;
          marqueeActiveRef.current = true;
        }
        const div = marqueeDivRef.current;
        const container = containerRef.current;
        if (div && container) {
          const rect = container.getBoundingClientRect();
          div.style.display = 'block';
          div.style.left = `${Math.min(m.x, e.clientX) - rect.left}px`;
          div.style.top = `${Math.min(m.y, e.clientY) - rect.top}px`;
          div.style.width = `${Math.abs(e.clientX - m.x)}px`;
          div.style.height = `${Math.abs(e.clientY - m.y)}px`;
        }
        return;
      }

      // Drag d'un CP en mode edit = drag de la SÉLECTION — conventions
      // éditeurs vectoriels + préservation de la coordonnée normale :
      // - le delta est calculé sur l'ancre (réponse 1:1 sous le curseur)
      // - la coordonnée normale au plan est préservée (drag en Top ne
      //   casse pas la hauteur z des points)
      // - Shift = contrainte verticale (Front/Side : z ; Top/Free : y)
      const cpIdx = draggingCpRef.current;
      if (cpIdx !== null) {
        const world = screenToWorld(e.clientX, e.clientY);
        if (!world) return;
        const cur = st.controlPoints[cpIdx];
        if (!cur) return;
        const v = st.drawView;
        let next: Vec3;
        if (e.shiftKey) {
          next = v === 'front' || v === 'side'
            ? [cur[0], cur[1], world[2]]
            : [cur[0], world[1], cur[2]];
        } else {
          next = v === 'front' ? [world[0], cur[1], world[2]]
            : v === 'side' ? [cur[0], world[1], world[2]]
            : [world[0], world[1], cur[2]];
        }
        const delta: Vec3 = [next[0] - cur[0], next[1] - cur[1], next[2] - cur[2]];
        if (delta[0] || delta[1] || delta[2]) cpDragMovedRef.current = true;
        const sel = st.cpSelection.size > 0 ? st.cpSelection : new Set([cpIdx]);
        st.translateCps(sel, delta);
        return;
      }

      if (st.splineTool !== 'freehand' || !isDrawing) return;
      const world = screenToWorld(e.clientX, e.clientY);
      if (!world) return;
      // Threshold to avoid too many points
      const pts = st.drawnPoints;
      const last = pts[pts.length - 1];
      if (last) {
        const dist = Math.sqrt(
          (world[0] - last[0]) ** 2 +
          (world[1] - last[1]) ** 2 +
          (world[2] - last[2]) ** 2,
        );
        if (dist < 0.05) return;
      }
      st.addDrawnPoint(world);
    },
    [drawMode, isDrawing, screenToWorld, updateCursorReadout],
  );

  const handleDrawEnd = useCallback(
    (e: React.PointerEvent) => {
      if (!drawMode) return;
      const st = useGraphStore.getState();
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // capture déjà relâchée (sortie de canvas, unmount) — pas bloquant
      }
      if (marqueeRef.current) {
        const m = marqueeRef.current;
        marqueeRef.current = null;
        const div = marqueeDivRef.current;
        if (div) div.style.display = 'none';
        if (marqueeActiveRef.current) {
          marqueeActiveRef.current = false;
          // Rectangle fermé : CPs dont la projection tombe dedans.
          // Shift au départ = union avec la sélection existante.
          const container = containerRef.current;
          if (container) {
            const rect = container.getBoundingClientRect();
            const x0 = Math.min(m.x, e.clientX) - rect.left;
            const x1 = Math.max(m.x, e.clientX) - rect.left;
            const y0 = Math.min(m.y, e.clientY) - rect.top;
            const y1 = Math.max(m.y, e.clientY) - rect.top;
            const inside = new Set<number>();
            cpScreenPositions().forEach((p, i) => {
              if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) inside.add(i);
            });
            st.setCpSelection(m.shift ? new Set([...st.cpSelection, ...inside]) : inside);
          }
        } else if (!m.shift) {
          st.setCpSelection(new Set()); // clic à vide = désélection (CAD)
        }
        return;
      }
      if (draggingCpRef.current !== null) {
        const anchor = draggingCpRef.current;
        draggingCpRef.current = null;
        // Clic sur un membre sans bouger = collapse la sélection à ce
        // seul CP (le drag l'aurait déplacée) — convention éditeurs.
        if (!cpDragMovedRef.current && !e.shiftKey) {
          st.setCpSelection(new Set([anchor]));
        }
        return;
      }
      if (!isDrawing) return;
      setIsDrawing(false);
      // Le stroke devient un jeu de CPs éditable — commit explicite via Done.
      useGraphStore.getState().commitStroke();
    },
    [drawMode, isDrawing, cpScreenPositions, containerRef],
  );

  // Double-clic en mode edit = insertion d'un CP sur la courbe au point
  // cliqué (nearest-u → splice). En mode place : rien (clics simples suffisent).
  const handleDrawDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!drawMode) return;
      const st = useGraphStore.getState();
      if (st.splineTool !== 'edit' || st.controlPoints.length < 2) return;
      const world = screenToWorld(e.clientX, e.clientY);
      if (!world) return;
      const u = nearestU(st.controlPoints, world, st.splineClosed);
      st.setControlPoints(insertCpAtU(st.controlPoints, u, st.splineClosed));
    },
    [drawMode, screenToWorld],
  );

  // Sortie du mode : cacher le div marquee s'il restait affiché (sortie
  // pendant un drag annulé — pointercancel couvre le reste).
  useEffect(() => {
    if (!drawMode && marqueeDivRef.current) marqueeDivRef.current.style.display = 'none';
  }, [drawMode]);

  // Copy/paste de CPs — Ctrl+C copie la sélection (tous si rien de
  // sélectionné : dupliquer une forme entière entre moves), Ctrl+V
  // colle en fin de spline avec un offset visible. Miroir dans le
  // clipboard système (enveloppe 'spline') — une forme dessinée voyage
  // entre shows comme une chaîne de nœuds.
  useEffect(() => {
    if (!drawMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable]')) return;
      const st = useGraphStore.getState();
      if (st.splineTool !== 'edit') return;
      const key = e.key.toLowerCase();
      if (key === 'c') {
        const sel = st.cpSelection;
        const points =
          sel.size > 0
            ? [...sel].sort((a, b) => a - b).map((i) => st.controlPoints[i])
            : st.controlPoints;
        if (points.length === 0) return;
        e.preventDefault();
        const payload = { points: points.map((p): Vec3 => [...p]), closed: st.splineClosed };
        writeSplineClipboard(payload);
        navigator.clipboard?.writeText(serializeSplineClipboard(payload)).catch(() => {});
        return;
      }
      if (key === 'v') {
        e.preventDefault();
        const applyPaste = (payload: { points: Vec3[]; closed: boolean } | null) => {
          if (!payload || payload.points.length === 0) return;
          const s2 = useGraphStore.getState();
          // +0.3m sur X : la copie doit être visible, pas empilée.
          const pasted = payload.points.map(
            (p): Vec3 => [p[0] + 0.3, p[1], p[2]],
          );
          const base = s2.controlPoints.length;
          s2.setControlPoints([...s2.controlPoints, ...pasted]);
          s2.setCpSelection(new Set(pasted.map((_, i) => base + i)));
        };
        const clip = readSplineClipboard();
        if (clip) {
          applyPaste(clip);
          return;
        }
        navigator.clipboard
          ?.readText()
          .then((text) => applyPaste(parseSplineClipboard(text)))
          .catch(() => {});
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawMode]);

  return {
    isDrawing,
    drawCanvasRef,
    marqueeDivRef,
    handleDrawStart,
    handleDrawMove,
    handleDrawEnd,
    handleDrawDoubleClick,
  };
}
