import React from 'react';

/// Micro-badge inline (labels cue : TRK / w5s / f3s! / TC …).
/// Floor typographique : `text-[10px]` minimum — jamais en dessous du seuil
/// de lisibilité live (l'audit a trouvé du 8-9px dans CuelistPanel).
export const Badge: React.FC<{
  children: React.ReactNode;
  title?: string;
  danger?: boolean;
  className?: string;
}> = ({ children, title, danger, className = '' }) => (
  <span
    className={`text-[10px] font-mono px-1 py-px rounded ${danger ? 'bg-stagespace-danger/20 text-stagespace-danger' : 'bg-gray-700/60 text-gray-300'} ${className}`}
    title={title}
  >
    {children}
  </span>
);
