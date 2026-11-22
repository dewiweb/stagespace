import { getCurrentWindow } from '@tauri-apps/api/window';

// ResizeDirection n'est pas exporté par l'API — dérivé de la signature.
type ResizeDirection = Parameters<
  ReturnType<typeof getCurrentWindow>['startResizeDragging']
>[0];

/** Vraie fenêtre Tauri ? Même garde que Titlebar — le shim dev-bridge
    pose __TAURI_INTERNALS__ sans fenêtre OS à contrôler. */
const realWindow =
  typeof window !== 'undefined' &&
  '__TAURI_INTERNALS__' in window &&
  !('__STAGESPACE_BRIDGE__' in window);

const EDGE = 6; // px — épaisseur des bandes de bord
const CORNER = 14; // px — zones carrées aux coins

interface Handle {
  dir: ResizeDirection;
  style: React.CSSProperties;
}

const HANDLES: Handle[] = [
  { dir: 'North', style: { top: 0, left: CORNER, right: CORNER, height: EDGE, cursor: 'n-resize' } },
  { dir: 'South', style: { bottom: 0, left: CORNER, right: CORNER, height: EDGE, cursor: 's-resize' } },
  { dir: 'West', style: { top: CORNER, bottom: CORNER, left: 0, width: EDGE, cursor: 'w-resize' } },
  { dir: 'East', style: { top: CORNER, bottom: CORNER, right: 0, width: EDGE, cursor: 'e-resize' } },
  { dir: 'NorthWest', style: { top: 0, left: 0, width: CORNER, height: CORNER, cursor: 'nwse-resize' } },
  { dir: 'NorthEast', style: { top: 0, right: 0, width: CORNER, height: CORNER, cursor: 'nesw-resize' } },
  { dir: 'SouthWest', style: { bottom: 0, left: 0, width: CORNER, height: CORNER, cursor: 'nesw-resize' } },
  { dir: 'SouthEast', style: { bottom: 0, right: 0, width: CORNER, height: CORNER, cursor: 'nwse-resize' } },
];

/** Poignées de resize pour la fenêtre frameless (`decorations: false` —
    wry ne fournit pas de bordures natives). Bandes invisibles de 6px sur
    les bords + carrés de 14px aux coins ; mousedown délègue le drag au
    compositeur via `startResizeDragging` (plus fluide qu'un resize JS,
    et fonctionne pendant que la webview re-render).
    Monté à la racine d'AppMain — les fenêtres détachées ont leurs
    décorations natives, pas besoin de ça. */
export const WindowResizeHandles: React.FC = () => {
  if (!realWindow) return null;
  const appWindow = getCurrentWindow();
  const start = (dir: ResizeDirection) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    void appWindow.startResizeDragging(dir);
  };
  return (
    <>
      {HANDLES.map((h) => (
        <div
          key={h.dir}
          onMouseDown={start(h.dir)}
          className="absolute z-[60]"
          style={h.style}
        />
      ))}
    </>
  );
};
