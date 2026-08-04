import React from 'react';
import { useGraphStore } from '../store/useGraphStore';

export const MacroControls: React.FC = () => {
  const macros = useGraphStore((s) => s.macros);
  const setMacros = useGraphStore((s) => s.setMacros);
  const pushMacrosToRuntime = useGraphStore((s) => s.pushMacrosToRuntime);
  const setLoopMode = useGraphStore((s) => s.setLoopMode);
  const isPlaying = useGraphStore((s) => s.isPlaying);
  const movements = useGraphStore((s) => s.movements);
  const shouldPush = isPlaying || movements.length > 0;
  const [loopMode, setLoopModeState] = React.useState<'loop' | 'oneshot'>('loop');

  const reset = async () => {
    setMacros({ speed: 1.0, scale: 1.0, shiftX: 0, shiftY: 0, shiftZ: 0, yaw: 0, pitch: 0, roll: 0 });
    if (shouldPush) await pushMacrosToRuntime();
  };

  const handleMacroChange = async (partial: Partial<typeof macros>) => {
    setMacros(partial);
    if (shouldPush) await pushMacrosToRuntime();
  };

  const handleLoopMode = async (mode: 'loop' | 'oneshot') => {
    setLoopModeState(mode);
    await setLoopMode(mode);
  };

  return (
    <div className="p-3 h-full flex flex-col gap-2 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">Macro Controls</h3>
        {shouldPush && (
          <span className="text-green-400 text-[10px] font-medium">LIVE</span>
        )}
      </div>

      {/* Loop mode */}
      <div className="flex gap-1 p-1 bg-gray-800/50 rounded border border-gray-700/50">
        <button
          onClick={() => handleLoopMode('loop')}
          className={`flex-1 py-1 text-[10px] rounded font-medium transition-colors ${
            loopMode === 'loop' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          Loop ∞
        </button>
        <button
          onClick={() => handleLoopMode('oneshot')}
          className={`flex-1 py-1 text-[10px] rounded font-medium transition-colors ${
            loopMode === 'oneshot' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          One-shot
        </button>
      </div>

      {/* Section: Speed & Scale */}
      <div className="space-y-1.5">
        <div className="text-gray-500 text-[9px] font-semibold uppercase tracking-wider">Motion</div>
        <Slider
          label="Speed"
          value={macros.speed}
          min={0}
          max={4}
          step={0.05}
          onChange={(v) => handleMacroChange({ speed: v })}
          live={shouldPush}
        />
        <Slider
          label="Scale"
          value={macros.scale}
          min={0}
          max={4}
          step={0.05}
          onChange={(v) => handleMacroChange({ scale: v })}
          live={shouldPush}
        />
      </div>

      {/* Section: Shift (translate the whole trajectory) */}
      <div className="space-y-1.5">
        <div className="text-gray-500 text-[9px] font-semibold uppercase tracking-wider">Shift</div>
        <Slider
          label="Shift X"
          value={macros.shiftX}
          min={-3}
          max={3}
          step={0.1}
          onChange={(v) => handleMacroChange({ shiftX: v })}
          live={shouldPush}
        />
        <Slider
          label="Shift Y"
          value={macros.shiftY}
          min={-3}
          max={3}
          step={0.1}
          onChange={(v) => handleMacroChange({ shiftY: v })}
          live={shouldPush}
        />
        <Slider
          label="Shift Z"
          value={macros.shiftZ}
          min={-3}
          max={3}
          step={0.1}
          onChange={(v) => handleMacroChange({ shiftZ: v })}
          live={shouldPush}
        />
      </div>

      {/* Section: Rotation (rotate the whole trajectory) */}
      <div className="space-y-1.5">
        <div className="text-gray-500 text-[9px] font-semibold uppercase tracking-wider">Rotation</div>
        <Slider
          label="Yaw (Y)"
          value={macros.yaw}
          min={-180}
          max={180}
          step={1}
          onChange={(v) => handleMacroChange({ yaw: v })}
          live={shouldPush}
          unit="°"
        />
        <Slider
          label="Pitch (X)"
          value={macros.pitch}
          min={-180}
          max={180}
          step={1}
          onChange={(v) => handleMacroChange({ pitch: v })}
          live={shouldPush}
          unit="°"
        />
        <Slider
          label="Roll (Z)"
          value={macros.roll}
          min={-180}
          max={180}
          step={1}
          onChange={(v) => handleMacroChange({ roll: v })}
          live={shouldPush}
          unit="°"
        />
      </div>

      <button
        onClick={reset}
        className="mt-auto py-1.5 text-[11px] text-gray-400 hover:text-white bg-gray-800/50 hover:bg-gray-700 rounded border border-gray-700/50 transition-colors"
      >
        Reset Macros
      </button>
    </div>
  );
};

const Slider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  live?: boolean;
  unit?: string;
}> = ({ label, value, min, max, step, onChange, live, unit }) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between">
      <span className="text-gray-400 text-[11px]">{label}</span>
      <span className={`text-[11px] font-mono ${live ? 'text-green-400' : 'text-white'}`}>
        {value.toFixed(unit === '°' ? 0 : 2)}{unit ?? ''}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
    />
  </div>
);

export default MacroControls;
