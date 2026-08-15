import React, { useCallback } from 'react';
import { safeInvoke as invoke } from '../utils/tauri';
import { useGraphStore } from '../store/useGraphStore';

interface MacrosPanelProps {
  isPlaying: boolean;
  hasMovements?: boolean;
}

/**
 * Panneau de macros (Scale, Shift, Speed, Rotation) — extrait de Scene3D.
 * Les macros sont poussées au runtime en temps réel si en lecture.
 */
export const MacrosPanel: React.FC<MacrosPanelProps> = ({ isPlaying, hasMovements = false }) => {
  const macros = useGraphStore((s) => s.macros);
  const setMacros = useGraphStore((s) => s.setMacros);
  const pushMacrosToRuntime = useGraphStore((s) => s.pushMacrosToRuntime);
  const shouldPush = isPlaying || hasMovements;

  const updateMacrosLive = useCallback(
    (partial: Partial<typeof macros>) => {
      const sanitized: Partial<typeof macros> = {};
      for (const [k, v] of Object.entries(partial)) {
        sanitized[k as keyof typeof macros] = typeof v === 'number' && isNaN(v) ? 0 : v;
      }
      setMacros(sanitized);
      if (shouldPush) pushMacrosToRuntime();
    },
    [setMacros, pushMacrosToRuntime, shouldPush],
  );

  const Slider = ({ label, value, min, max, step, suffix, onChange }: {
    label: string; value: number; min: number; max: number; step: number; suffix?: string;
    onChange: (v: number) => void;
  }) => (
    <div className="flex items-center gap-1.5">
      <span className="text-gray-400 text-[10px] w-10">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 accent-blue-500"
      />
      <span className="text-white text-[10px] font-mono w-10 text-right">
        {suffix ? value.toFixed(0) + suffix : value.toFixed(value < 1 ? 2 : 1)}
      </span>
    </div>
  );

  return (
    <div className="absolute top-2 left-2 z-20 bg-gray-900/90 backdrop-blur rounded-lg p-3 border border-blue-600/50 flex flex-col gap-2 min-w-[200px]">
      <div className="flex items-center gap-2">
        <span className="text-blue-400 text-[11px] font-semibold">✥ Manipulate</span>
        {shouldPush && <span className="text-green-400 text-[9px]">LIVE</span>}
      </div>
      <div className="text-gray-500 text-[9px] leading-tight">
        Drag handle ◆ = move all<br />
        Drag sphere = move one (override)<br />
        <span className="text-blue-400">Overrides send real OSC</span>
      </div>
      {shouldPush && (
        <button
          onClick={() => invoke('clear_all_overrides').catch(console.error)}
          className="text-[10px] text-orange-400 hover:text-orange-300 bg-gray-800 hover:bg-gray-700 rounded py-1 transition-colors border border-gray-700"
        >
          Clear All Overrides
        </button>
      )}
      <Slider label="Scale" value={macros.scale} min={0.1} max={4} step={0.05}
        onChange={(v) => updateMacrosLive({ scale: v })} />
      <Slider label="Shift X" value={macros.shiftX} min={-5} max={5} step={0.1}
        onChange={(v) => updateMacrosLive({ shiftX: v })} />
      <Slider label="Shift Y" value={macros.shiftY} min={-5} max={5} step={0.1}
        onChange={(v) => updateMacrosLive({ shiftY: v })} />
      <Slider label="Shift Z" value={macros.shiftZ} min={-5} max={5} step={0.1}
        onChange={(v) => updateMacrosLive({ shiftZ: v })} />
      <Slider label="Speed" value={macros.speed} min={0} max={4} step={0.05}
        onChange={(v) => updateMacrosLive({ speed: v })} />
      <Slider label="Yaw°" value={macros.yaw} min={-180} max={180} step={1} suffix="°"
        onChange={(v) => updateMacrosLive({ yaw: v })} />
      <Slider label="Pitch°" value={macros.pitch} min={-180} max={180} step={1} suffix="°"
        onChange={(v) => updateMacrosLive({ pitch: v })} />
      <Slider label="Roll°" value={macros.roll} min={-180} max={180} step={1} suffix="°"
        onChange={(v) => updateMacrosLive({ roll: v })} />
      <button
        onClick={() => updateMacrosLive({ scale: 1.0, shiftX: 0, shiftY: 0, shiftZ: 0, speed: 1.0, yaw: 0, pitch: 0, roll: 0 })}
        className="text-[10px] text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded py-1 transition-colors"
      >
        Reset
      </button>
    </div>
  );
};
