import React from 'react';
import { OctagonX } from 'lucide-react';
import { useGraphStore } from '../../store/useGraphStore';

/// PANIC — arrêt d'urgence. Composant unique partagé par Toolbar et
/// PerformView : un seul glyphos, une seule sémantique, impossible à
/// diverger.
///
/// Règles live-safety :
/// - JAMAIS inerte : ni recall en cours, ni état du store ne bloque le clic
///   (le backend est idempotent — un panic pendant un recall est valide).
/// - Proéminence : size 'lg' (Perform) ≥ GO ; 'sm' (Toolbar) reste le plus
///   gros contrôle de sa rangée.
/// - Feedback visuel : flash overlay rouge bref monté par ce composant —
///   un panic silencieux est un panic douteux (le toast vient du store).
interface PanicButtonProps {
  size?: 'sm' | 'lg';
}

export const PanicButton: React.FC<PanicButtonProps> = ({ size = 'sm' }) => {
  const panic = useGraphStore((s) => s.panic);
  const [flash, setFlash] = React.useState(false);

  const handleClick = () => {
    // Pas de garde — panic() est inconditionnel et idempotent.
    void panic();
    setFlash(true);
    setTimeout(() => setFlash(false), 350);
  };

  const sizing =
    size === 'lg'
      ? 'px-6 py-2.5 text-lg'
      : 'px-3 py-1.5 text-xs';

  return (
    <>
      <button
        onClick={handleClick}
        className={`${sizing} font-black rounded-lg bg-red-700 hover:bg-red-600 text-white border-2 border-red-500 transition-colors tracking-wider active:scale-95 flex items-center gap-1.5`}
        title="PANIC (Esc) — stops all moves and sends origin positions"
      >
        <OctagonX size={size === 'lg' ? 20 : 14} strokeWidth={2.5} />
        PANIC
      </button>
      {/* Flash overlay — bref, non-bloquant (pointer-events-none) */}
      {flash && (
        <div className="fixed inset-0 z-toast bg-red-600/25 pointer-events-none animate-fade-in" />
      )}
    </>
  );
};

export default PanicButton;
