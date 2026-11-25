import React from 'react';

export type ContextMenuItem =
  | { separator: true }
  | {
      separator?: false;
      label: string;
      danger?: boolean;
      disabled?: boolean;
      title?: string;
      onClick: () => void;
    };

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  /// Titre optionnel (header grisé — ex: nom de l'objet ciblé).
  header?: string;
}

/// Menu contextuel générique (clic-droit) — même langue visuelle que le
/// node-menu de l'éditeur : fixed, clampé au viewport, fermeture sur
/// clic dehors / Esc / action. Les items disabled restent visibles avec
/// un title explicatif (comme MenuBar — dire pourquoi c'est grisé).
export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose, header }) => {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = React.useState({ x, y });

  // Clamp au viewport — mesure réelle post-mount (taille variable selon
  // le nombre d'items), re-clamp sur changement d'items.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    });
  }, [x, y, items.length]);

  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Capture : un clic sur le canvas ReactFlow en dessous ne doit pas
    // démarrer un drag avant la fermeture.
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-menu min-w-[180px] bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
    >
      {header && (
        <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-800 truncate max-w-[240px]">
          {header}
        </div>
      )}
      {items.map((item, i) => ('separator' in item && item.separator) ? (
        <div key={i} className="border-t border-gray-800 my-0.5" />
      ) : (
        <button
          key={i}
          role="menuitem"
          disabled={item.disabled}
          title={item.disabled ? item.title : undefined}
          onClick={() => {
            onClose();
            item.onClick();
          }}
          className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
            item.disabled
              ? 'text-gray-600 cursor-default'
              : item.danger
                ? 'text-stagespace-danger hover:bg-stagespace-danger/15'
                : 'text-gray-300 hover:bg-stagespace-accent/10 hover:text-white'
          }`}
        >
          {item.label}
        </button>
      ))}


    </div>
  );
};

export default ContextMenu;
