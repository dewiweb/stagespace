import React from 'react';

type ChipVariant = 'live' | 'conduite' | 'osc' | 'warning' | 'danger' | 'tracking' | 'dim';

const VARIANTS: Record<ChipVariant, string> = {
  live: 'text-stagespace-live bg-stagespace-live/10 border-stagespace-live/40',
  conduite: 'text-stagespace-conduite bg-stagespace-conduite/10 border-stagespace-conduite/40',
  osc: 'text-stagespace-osc bg-stagespace-osc/10 border-stagespace-osc/40',
  warning: 'text-stagespace-warning bg-stagespace-warning/10 border-stagespace-warning/40',
  danger: 'text-stagespace-danger bg-stagespace-danger/10 border-stagespace-danger/40 animate-pulse',
  tracking: 'text-stagespace-tracking bg-stagespace-tracking/10 border-stagespace-tracking/40',
  dim: 'text-stagespace-dim bg-gray-800/40 border-gray-700',
};

/// Chip d'état live — un seul vocabulaire visuel pour PARKED / CONSOLE / TC /
/// ARM / DRY-RUN / LIVE, partagé par PerformView, ConduitePage et StatusBar.
/// `pulse` force le clignotement (état demandant action immédiate).
export const StatusChip: React.FC<{
  variant: ChipVariant;
  children: React.ReactNode;
  pulse?: boolean;
  title?: string;
  className?: string;
}> = ({ variant, children, pulse, title, className = '' }) => (
  <span
    className={`px-1.5 py-0.5 rounded border text-xs font-bold flex items-center gap-1 ${VARIANTS[variant]} ${pulse ? 'animate-pulse' : ''} ${className}`}
    title={title}
  >
    {children}
  </span>
);
