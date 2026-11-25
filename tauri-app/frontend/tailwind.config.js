/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        stagespace: {
          bg: '#0a0a0f',
          panel: '#12121a',
          border: '#1e1e2e',
          accent: '#3b82f6',
          // Tokens de rôle — la couleur code la fonction, pas le goût.
          // live = playing/armé/GO · conduite = cues NOW/NEXT · osc = liens
          // réseau · warning = partagé/orphelin · danger = panic/delete ·
          // tracking = cues tracking/expert · dim = secondaire.
          live: '#22c55e',
          conduite: '#f59e0b',
          osc: '#22d3ee',
          warning: '#f97316',
          danger: '#ef4444',
          tracking: '#a855f7',
          dim: '#6b7280',
          // info = états système informationnels non-actionnables
          // (compiled, document chargé) — ni live ni warning.
          info: '#60a5fa',
          // target = visualisation de destination (ghosts pose, ancres,
          // projections) — distinct de tracking (QUI pilote) et d'osc
          // (liens réseau) : les cibles spatiales sont teal-vert.
          target: '#2dd4bf',
          // derived = états projetés non-actionnables (blast radius,
          // audition) — toujours translucide, jamais plein.
          derived: '#94a3b8',
          // modulation = paramètre piloté par un signal (audio-mod,
          // LFO, envelope) — indigo, distinct de tracking purple.
          modulation: '#818cf8',
        },
      },
      // Échelle de z-index nommée — fini les z-10/z-50/z-[9999] ad hoc.
      // Tout nouvel overlay DOIT utiliser un token, pas un nombre.
      zIndex: {
        overlay: '20', // overlays dans le canvas 3D (mode UI, indicateurs)
        raised: '30',  // headers sticky de palette, debug overlay
        popover: '50', // tooltips, modals, dropdowns
        menu: '70',    // menus contextuels (au-dessus des modals)
        toast: '9999', // toasts + flash panic — toujours au sommet
      },
    },
  },
  plugins: [],
};
