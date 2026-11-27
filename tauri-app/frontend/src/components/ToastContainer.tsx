import { useToastStore, Toast, ToastType } from '../store/useToastStore';
import { X, TriangleAlert, CircleCheck, Info } from 'lucide-react';

const STYLES: Record<ToastType, { bg: string; border: string; icon: React.ReactNode }> = {
  error:   { bg: 'bg-stagespace-danger/15', border: 'border-stagespace-danger',   icon: <X size={13} /> },
  warning: { bg: 'bg-stagespace-warning/15', border: 'border-stagespace-warning', icon: <TriangleAlert size={13} /> },
  info:    { bg: 'bg-stagespace-info/15', border: 'border-stagespace-info',  icon: <Info size={13} /> },
  success: { bg: 'bg-stagespace-live/15', border: 'border-stagespace-live', icon: <CircleCheck size={13} /> },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const style = STYLES[toast.type] ?? STYLES.info;
  return (
    <div
      role="alert"
      tabIndex={0}
      className={`${style.bg} ${style.border} border-l-4 text-white text-xs px-3 py-2 rounded shadow-lg flex items-start gap-2 min-w-[260px] max-w-[420px] cursor-pointer animate-fadein`}
      onClick={() => onDismiss(toast.id)}
      onKeyDown={(e) => {
        // stopPropagation : sans ça la touche remonte au handler global —
        // Enter déclenchait aussi GO / Space aussi play (double action).
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onDismiss(toast.id);
        }
      }}
    >
      <span className="flex-shrink-0 font-bold text-sm leading-tight">{style.icon}</span>
      <span className="flex-1 leading-snug break-words">{toast.message}</span>
      <span className="flex-shrink-0 text-gray-400 hover:text-white text-xs"><X size={12} /></span>
    </div>
  );
}

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  // Dedup — une rafale de toasts identiques (spam OSC, erreurs répétées)
  // s'effondre en une entrée ×N au lieu d'une pile qui recouvre la
  // télémétrie exactement quand il y a le plus à signaler (audit U4).
  const grouped: { toast: Toast; count: number }[] = [];
  for (const t of toasts) {
    const last = grouped[grouped.length - 1];
    if (last && last.toast.type === t.type && last.toast.message === t.message) {
      last.count += 1;
      last.toast = t; // id le plus récent — dismiss purge le groupe
    } else {
      grouped.push({ toast: t, count: 1 });
    }
  }
  // Cap visible — les plus anciens s'effondrent en « +N » plutôt que de
  // monter la pile jusqu'au centre de l'écran.
  const MAX_VISIBLE = 3;
  const hidden = Math.max(0, grouped.length - MAX_VISIBLE);
  const visible = grouped.slice(-MAX_VISIBLE);

  return (
    // bottom-16 : au-dessus de la statusbar (h-7) ET de la légende radar
    // jeu — les deux zones que la pile recouvrait systématiquement.
    <div role="alert" aria-live="assertive" className="fixed bottom-16 right-4 z-toast flex flex-col gap-2 pointer-events-none">
      <div className="flex flex-col gap-2 pointer-events-auto">
        {hidden > 0 && (
          <div className="text-gray-500 text-[10px] text-right pr-1">+{hidden} more…</div>
        )}
        {visible.map(({ toast: t, count }) => (
          <div key={t.id} className="relative">
            {count > 1 && (
              <span className="absolute -top-1.5 -right-1.5 z-10 bg-gray-800 border border-gray-600 text-gray-300 text-[9px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                ×{count}
              </span>
            )}
            <ToastItem toast={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </div>
  );
}
