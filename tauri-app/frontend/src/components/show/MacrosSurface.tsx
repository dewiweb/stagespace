import React from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { Slider } from '../ui/Slider';

/// Surface de macros GLOBALES (merge — affecte tous les moves live).
/// Une seule implémentation pour les 4 anciennes surfaces (Inspector ×3,
/// MacrosPanel, PerformView Global) : mêmes plages, même accent `tracking`,
/// même pacing (debounce 100ms interne au composant).
///
/// Plages = union des valeurs qui existaient (aucune fonctionnalité perdue) :
/// scale 0.1-4 · speed 0-4 · shift ±10 · rotation ±180 · radius 0.1-3 ·
/// height ±5.
export const MacrosSurface: React.FC<{
  /// Afficher aussi radius_scale/height_offset (le merge global les connaît).
  includeRadius?: boolean;
  /// 'stack' = label+valeur au-dessus (overlays), 'row' = labels à gauche.
  layout?: 'row' | 'stack';
  /// Mise en avant des valeurs live (couleur live sur la valeur).
  live?: boolean;
  title?: string;
}> = ({ includeRadius = true, layout = 'row', live = false, title }) => {
  const macros = useGraphStore((s) => s.macros);
  const setMacros = useGraphStore((s) => s.setMacros);
  const pushMacrosToRuntime = useGraphStore((s) => s.pushMacrosToRuntime);
  const debounce = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = (key: string, value: number) => {
    setMacros({ [key]: value } as Partial<typeof macros>);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { void pushMacrosToRuntime(); }, 100);
  };

  const S = (key: keyof typeof macros, label: string, min: number, max: number, step: number, unit?: string, dec?: number) => (
    <Slider
      label={label}
      value={macros[key] as number}
      min={min} max={max} step={step} unit={unit} decimals={dec}
      accent="purple"
      layout={layout}
      live={live}
      onChange={(v) => set(key, v)}
    />
  );

  return (
    <div className="space-y-1.5">
      {title && <div className="text-xs font-semibold text-gray-300 uppercase tracking-wide">{title}</div>}
      {S('scale', 'Scale', 0.1, 4, 0.05)}
      {S('speed', 'Speed', 0, 4, 0.05, 'x')}
      {S('shiftX', 'Shift X', -10, 10, 0.1, 'm')}
      {S('shiftY', 'Shift Y', -10, 10, 0.1, 'm')}
      {S('shiftZ', 'Shift Z', -10, 10, 0.1, 'm')}
      {S('yaw', 'Yaw', -180, 180, 1, '°', 0)}
      {S('pitch', 'Pitch', -180, 180, 1, '°', 0)}
      {S('roll', 'Roll', -180, 180, 1, '°', 0)}
      {includeRadius && (
        <>
          {S('radius_scale', 'Radius ×', 0.1, 3, 0.05)}
          {S('height_offset', 'Height +', -5, 5, 0.1, 'm')}
        </>
      )}
    </div>
  );
};

export default MacrosSurface;
