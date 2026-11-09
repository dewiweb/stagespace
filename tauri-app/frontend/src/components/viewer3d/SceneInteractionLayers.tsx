import React, { MutableRefObject } from 'react';
import * as THREE from 'three';

/// Props du bundle interaction — handlers produits par les hooks
/// (useScenePicking / useZoneGestures / useSceneGestures / useDrawMode /
/// useManipulateMode). Le composant ne connaît rien de la scène : il câble
/// les overlays plein-écran des modes interactifs + le canvas draw.
export interface SceneInteractionLayersProps {
  drawMode: boolean;
  zoneEditMode: boolean;
  zonePlaceMode: boolean;
  assignMode: boolean;
  manipulateMode: boolean;
  draggingHandle: boolean;
  draggingObject: number | null;
  drawCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  handleDrawStart: (e: React.PointerEvent) => void;
  handleDrawMove: (e: React.PointerEvent) => void;
  handleDrawEnd: (e: React.PointerEvent) => void;
  handleZoomWheel: (e: React.WheelEvent) => void;
  raycastAt: (e: { clientX: number; clientY: number }) => THREE.Raycaster | null;
  zoneIndexAt: (r: THREE.Raycaster) => number | null;
  handleZoneEditDown: (e: React.PointerEvent) => void;
  handleZoneEditMove: (e: React.PointerEvent) => void;
  handleZoneEditUp: (e: React.PointerEvent) => void;
  handleZoneEditWheel: (e: React.WheelEvent) => void;
  handleZonePlaceDown: (e: React.PointerEvent) => void;
  handleAssignDown: (e: React.PointerEvent) => void;
  handleManipulateDown: (e: React.PointerEvent) => void;
  handleManipulateMove: (e: React.PointerEvent) => void;
  handleManipulateUp: (e: React.PointerEvent) => void;
  handleManipulateWheel: (e: React.WheelEvent) => void;
}

/**
 * Couches interactives du viewer 3D — overlays plein-écran des modes +
 * canvas draw. L'exclusion mutuelle (slice) garantit qu'un seul overlay
 * est monté ; l'ordre DOM détermine la capture des events.
 */
export const SceneInteractionLayers: React.FC<SceneInteractionLayersProps> = (p) => (
  <>
    <canvas
      ref={p.drawCanvasRef}
      className="absolute inset-0 z-overlay"
      style={{
        width: '100%',
        height: '100%',
        pointerEvents: p.drawMode ? 'auto' : 'none',
        cursor: p.drawMode ? 'crosshair' : 'default',
      }}
      onPointerDown={p.handleDrawStart}
      onPointerMove={p.handleDrawMove}
      onPointerUp={p.handleDrawEnd}
      onPointerCancel={p.handleDrawEnd}
      onWheel={p.handleZoomWheel}
    />
    {p.zoneEditMode && (
      <div
        className="absolute inset-0 z-overlay"
        style={{ cursor: 'move' }}
        onPointerDown={p.handleZoneEditDown}
        onPointerMove={p.handleZoneEditMove}
        onPointerUp={p.handleZoneEditUp}
        onPointerCancel={p.handleZoneEditUp}
        onWheel={(e) => {
          // Resize si la molette est au-dessus d'une zone — sinon zoom.
          const r = p.raycastAt(e);
          if (r && p.zoneIndexAt(r) !== null) p.handleZoneEditWheel(e);
          else p.handleZoomWheel(e);
        }}
      />
    )}
    {p.zonePlaceMode && (
      <div
        className="absolute inset-0 z-overlay"
        style={{ cursor: 'crosshair' }}
        onPointerDown={p.handleZonePlaceDown}
        onWheel={p.handleZoomWheel}
      />
    )}
    {p.assignMode && (
      <div
        className="absolute inset-0 z-overlay"
        style={{ cursor: 'pointer' }}
        onPointerDown={p.handleAssignDown}
        onWheel={p.handleZoomWheel}
      />
    )}
    {p.manipulateMode && (
      <div
        className="absolute inset-0 z-overlay"
        style={{ cursor: p.draggingHandle || p.draggingObject !== null ? 'grabbing' : 'grab' }}
        onPointerDown={p.handleManipulateDown}
        onPointerMove={p.handleManipulateMove}
        onPointerUp={p.handleManipulateUp}
        onPointerCancel={p.handleManipulateUp}
        onWheel={p.handleManipulateWheel}
      />
    )}
  </>
);

export default SceneInteractionLayers;
