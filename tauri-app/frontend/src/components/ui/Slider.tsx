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
  /// Valeur cliquable → saisie libre (Enter/blur = commit, Esc = annule).
  /// La valeur saisie n'est bornée que par `min` — pas par `max` (le range
  /// sature) : sert pour les champs sans plafond réel (ex. duration, le
  /// backend n'a pas de borne haute).
  editable?: boolean;
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
  editable = false,
  disabled = false,
  decimals,
  className = '',
}) => {
  const dec = decimals ?? (step < 0.1 ? 2 : step < 1 ? 1 : 0);
  const display = `${value.toFixed(dec)}${unit ?? ''}`;
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = () => {
    const v = parseFloat(draft ?? '');
    if (Number.isFinite(v)) onChange(Math.max(min, v));
    setDraft(null);
  };
  const valueEl = (cls: string) =>
    draft !== null ? (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
        className={`bg-gray-900 text-white rounded border border-stagespace-accent/60 px-0.5 ${cls}`}
      />
    ) : (
      <span
        onClick={editable && !disabled ? () => setDraft(value.toFixed(dec)) : undefined}
        title={editable && !disabled ? 'Click to type a value' : undefined}
        className={`text-xs font-mono ${live ? 'text-stagespace-live' : 'text-white'} ${
          editable && !disabled ? 'cursor-text border-b border-dashed border-gray-600 hover:border-gray-400' : ''
        } ${cls}`}
      >
        {display}
      </span>
    );
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
          {valueEl('')}
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
      {valueEl('w-12 text-right flex-shrink-0')}
    </div>
  );
};

export default Slider;
