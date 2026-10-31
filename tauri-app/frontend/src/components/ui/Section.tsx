import React, { useState } from 'react';

/// Section accordéon unifiée — remplace Inspector.Section (accordéon) et
/// SpatialFxPanel.Section (statique + count/clear). `defaultOpen` contrôle
/// l'état initial ; `onClear` ajoute un lien d'effacement (garde : la
/// confirmation reste au call site).
export const Section: React.FC<{
  title: string;
  count?: number;
  badge?: React.ReactNode;
  badgeColor?: string;
  defaultOpen?: boolean;
  onClear?: () => void;
  children: React.ReactNode;
}> = ({ title, count, badge, badgeColor = 'bg-gray-700', defaultOpen = true, onClear, children }) => {
  const [open, setOpen] = useState(defaultOpen);
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
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onClear(); } }}
            className="text-xs text-gray-500 hover:text-stagespace-danger transition-colors"
          >
            clear all
          </span>
        )}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
};
