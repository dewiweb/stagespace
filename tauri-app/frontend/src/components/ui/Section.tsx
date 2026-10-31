import React, { useState } from 'react';
import { ConfirmModal } from './ConfirmModal';

/// Section accordéon unifiée — remplace Inspector.Section (accordéon) et
/// SpatialFxPanel.Section (statique + count/clear). `defaultOpen` contrôle
/// l'état initial ; `onClear` ajoute un lien d'effacement.
/// `confirm` : texte de la modale de confirmation requise avant onClear —
/// les clear-all destructifs ne partent pas en un seul clic.
export const Section: React.FC<{
  title: string;
  count?: number;
  badge?: React.ReactNode;
  badgeColor?: string;
  defaultOpen?: boolean;
  onClear?: () => void;
  /// Si fourni, un ConfirmModal s'interpose avant onClear.
  confirm?: { title: string; message: React.ReactNode; label?: string };
  children: React.ReactNode;
}> = ({ title, count, badge, badgeColor = 'bg-gray-700', defaultOpen = true, onClear, confirm, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  const [confirming, setConfirming] = useState(false);
  const requestClear = () => (confirm ? setConfirming(true) : onClear?.());
  return (
    <div className="border-b border-stagespace-border">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-800/40 transition-colors"
      >
        <span className="text-gray-500 text-xs">{open ? '▾' : '▸'}</span>
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">{title}</span>
        {count != null && <span className="text-xs text-gray-500">{count}</span>}
        {badge && <span className={`text-[10px] px-1.5 py-0.5 rounded ${badgeColor}`}>{badge}</span>}
        <span className="flex-1" />
        {onClear && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); requestClear(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); requestClear(); } }}
            className="text-xs text-gray-500 hover:text-stagespace-danger transition-colors"
          >
            clear all
          </span>
        )}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
      {confirming && confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label ?? 'Clear all'}
          onConfirm={() => { setConfirming(false); onClear?.(); }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
};
