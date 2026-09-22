import { useToastStore, Toast, ToastType } from '../store/useToastStore';
import { X, TriangleAlert, CircleCheck, Info } from 'lucide-react';

const STYLES: Record<ToastType, { bg: string; border: string; icon: React.ReactNode }> = {
  error:   { bg: 'bg-red-900/95',     border: 'border-red-500',   icon: <X size={13} /> },
  warning: { bg: 'bg-amber-900/95',   border: 'border-amber-500', icon: <TriangleAlert size={13} /> },
  info:    { bg: 'bg-blue-900/95',    border: 'border-blue-500',  icon: <Info size={13} /> },
  success: { bg: 'bg-green-900/95',   border: 'border-green-500', icon: <CircleCheck size={13} /> },
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

  return (
    <div role="alert" aria-live="assertive" className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      <div className="flex flex-col gap-2 pointer-events-auto">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  );
}
