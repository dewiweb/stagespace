import React from 'react';

/// Slider partagé — remplace les ~6 implémentations locales
/// (Inspector, macros, MovesTable, MacroControls, DrawToolbar).
///
/// layout:
///  - 'row'    : label à gauche (w-16), range, valeur à droite — panels
///  - 'stack'  : label+valeur sur une ligne, range dessous — MacroControls
///  - 'bare'   : range seul — overlays compacts (draw Z, TrackGrid depth)
interface SliderProps {
  label?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /// Suffixe affiché après la valeur ("°", "%", "s", "x")
  unit?: string;
  /// Teinte fonctionnelle du range — accent chrome par défaut,
  /// modulation pour les paramètres pilotés par un signal.
  tone?: 'accent' | 'modulation';
  layout?: 'row' | 'stack' | 'bare';
  /// Affiche la valeur en vert quand le contrôle agit sur un move live
  live?: boolean;
  disabled?: boolean;
  /// Nombre de décimales forcé (sinon déduit du step)
  decimals?: number;
  className?: string;
}

const TONES: Record<NonNullable<SliderProps['tone']>, string> = {
  accent: 'accent-stagespace-accent',
  modulation: 'accent-stagespace-modulation',
};

export const Slider: React.FC<SliderProps> = ({
  label,
  value,
  min,
  max,
  step,
  onChange,
  unit,
  tone = 'accent',
  layout = 'row',
  live = false,
  disabled = false,
  decimals,
  className = '',
}) => {
  const dec = decimals ?? (step < 0.1 ? 2 : step < 1 ? 1 : 0);
  const display = `${value.toFixed(dec)}${unit ?? ''}`;
  const input = (
    <input
      type="range"
      aria-label={label ?? 'slider'}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className={`nodrag flex-1 min-w-0 h-1.5 ${TONES[tone]} disabled:opacity-30 ${
        layout === 'bare' ? className : ''
      }`}
    />
  );

  if (layout === 'bare') return input;

  if (layout === 'stack') {
    return (
      <div className={`space-y-1 ${className}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-400 text-xs truncate" title={label}>{label}</span>
          <span
            className={`text-xs font-mono ${live ? 'text-stagespace-live' : 'text-white'}`}
          >
            {display}
          </span>
        </div>
        {input}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {label !== undefined && (
        <span className="text-gray-400 text-xs w-16 flex-shrink-0 truncate" title={label}>
          {label}
        </span>
      )}
      {input}
      <span
        className={`text-xs font-mono w-12 text-right flex-shrink-0 ${
          live ? 'text-stagespace-live' : 'text-white'
        }`}
      >
        {display}
      </span>
    </div>
  );
};

export default Slider;
