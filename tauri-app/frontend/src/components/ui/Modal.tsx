import React from 'react';
import { useModalGuard } from '../../utils/modalGuard';

/// Shell modal partagé — overlay, fermeture clic-dehors + Esc (via le
/// registre modalGuard : Esc ferme ce modal s'il est au sommet de la
/// stack, jamais le panic live), focus trap basique.
///
/// Remplace les shells dupliqués (SettingsModal, pickers MovesTable).
interface ModalProps {
  /// Titre affiché dans le header (omis = pas de header)
  title?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /// Largeur Tailwind du panneau (défaut max-w-md)
  widthClass?: string;
  /// Clic sur l'overlay ferme le modal (défaut true)
  closeOnOverlay?: boolean;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const Modal: React.FC<ModalProps> = ({
  title,
  onClose,
  children,
  widthClass = 'max-w-md',
  closeOnOverlay = true,
}) => {
  // Esc (via la stack modalGuard — ce modal doit être le composant monté)
  useModalGuard(onClose);

  const panelRef = React.useRef<HTMLDivElement>(null);

  // Focus trap : focus le premier élément focusable au mount, et garde
  // Tab/Shift+Tab dans le panneau tant que le modal est ouvert.
  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
    (focusables[0] ?? panel).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return (
    <div
      className="fixed inset-0 z-popover flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={closeOnOverlay ? onClose : undefined}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`${widthClass} w-full mx-4 max-h-[80vh] overflow-y-auto bg-stagespace-panel border border-stagespace-border rounded-xl shadow-2xl outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-stagespace-border">
            <h2 className="text-white font-semibold text-sm">{title}</h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white text-lg leading-none"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
};

export default Modal;
