import React from 'react';

type BannerVariant = 'live' | 'conduite' | 'osc' | 'warning' | 'tracking';

const VARIANTS: Record<BannerVariant, { border: string; text: string }> = {
  live: { border: 'border-stagespace-live/50', text: 'text-stagespace-live' },
  conduite: { border: 'border-stagespace-conduite/50', text: 'text-stagespace-conduite' },
  osc: { border: 'border-stagespace-osc/50', text: 'text-stagespace-osc' },
  warning: { border: 'border-stagespace-warning/50', text: 'text-stagespace-warning' },
  tracking: { border: 'border-stagespace-tracking/50', text: 'text-stagespace-tracking' },
};

/// Banner mode top-center — un seul composant pour les 4 copies
/// (Manipulate / Assign / Place / Edit zones). Position fixe au-dessus du
/// canvas, z-overlay.
export const ModeBanner: React.FC<{ variant: BannerVariant; children: React.ReactNode }> = ({ variant, children }) => (
  <div className={`absolute top-2 left-1/2 -translate-x-1/2 z-overlay bg-gray-900/90 backdrop-blur rounded-lg px-3 py-1.5 border ${VARIANTS[variant].border}`}>
    <span className={`${VARIANTS[variant].text} text-xs font-medium`}>{children}</span>
  </div>
);
