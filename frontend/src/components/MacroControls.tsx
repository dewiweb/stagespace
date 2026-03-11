import { RotateCcw } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'

export default function MacroControls() {
  const macros       = useGraphStore((s) => s.macros)
  const setMacros    = useGraphStore((s) => s.setMacros)
  const resetMacros  = () => setMacros({ speed: 1, scaleX: 1, scaleY: 1, scaleZ: 1, shiftX: 0, shiftY: 0, shiftZ: 0 })
  const macroControls = { tSpeed: macros.speed, scaleX: macros.scaleX, scaleY: macros.scaleY, scaleZ: macros.scaleZ, shiftX: macros.shiftX, shiftY: macros.shiftY, shiftZ: macros.shiftZ }
  const updateMacroControl = (key: keyof typeof macroControls, value: number) => {
    const keyMap: Record<string, string> = { tSpeed: 'speed', scaleX: 'scaleX', scaleY: 'scaleY', scaleZ: 'scaleZ', shiftX: 'shiftX', shiftY: 'shiftY', shiftZ: 'shiftZ' }
    setMacros({ [keyMap[key]]: value })
  }

  const controls = [
    {
      label: 'Time Speed',
      key: 'tSpeed' as const,
      min: 0.1,
      max: 3.0,
      step: 0.1,
      unit: 'x',
      description: 'Playback speed multiplier',
    },
    {
      label: 'Scale X',
      key: 'scaleX' as const,
      min: 0.1,
      max: 3.0,
      step: 0.1,
      unit: '',
      description: 'Horizontal expansion/contraction',
    },
    {
      label: 'Scale Y',
      key: 'scaleY' as const,
      min: 0.1,
      max: 3.0,
      step: 0.1,
      unit: '',
      description: 'Depth expansion/contraction',
    },
    {
      label: 'Scale Z',
      key: 'scaleZ' as const,
      min: 0.1,
      max: 3.0,
      step: 0.1,
      unit: '',
      description: 'Vertical expansion/contraction',
    },
    {
      label: 'Shift X',
      key: 'shiftX' as const,
      min: -2.0,
      max: 2.0,
      step: 0.1,
      unit: '',
      description: 'Horizontal offset',
    },
    {
      label: 'Shift Y',
      key: 'shiftY' as const,
      min: -2.0,
      max: 2.0,
      step: 0.1,
      unit: '',
      description: 'Depth offset',
    },
    {
      label: 'Shift Z',
      key: 'shiftZ' as const,
      min: -2.0,
      max: 2.0,
      step: 0.1,
      unit: '',
      description: 'Vertical offset',
    },
  ]

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold">Macro Controls</h3>
          <p className="text-sm text-gray-400">Real-time trajectory manipulation</p>
        </div>
        <button
          onClick={resetMacros}
          className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          Reset
        </button>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {controls.map((control) => (
          <div key={control.key} className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-300">
                {control.label}
              </label>
              <span className="text-sm text-primary-500 font-mono">
                {macroControls[control.key].toFixed(1)}
                {control.unit}
              </span>
            </div>
            <input
              type="range"
              min={control.min}
              max={control.max}
              step={control.step}
              value={macroControls[control.key]}
              onChange={(e) => updateMacroControl(control.key, parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
            />
            <p className="text-xs text-gray-500">{control.description}</p>
          </div>
        ))}
      </div>

      <style>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #0ea5e9;
          cursor: pointer;
        }
        .slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #0ea5e9;
          cursor: pointer;
          border: none;
        }
      `}</style>
    </div>
  )
}
