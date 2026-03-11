import { Handle, Position, NodeProps } from 'reactflow'

export default function SpiralNode({ data, id }: NodeProps) {
  const startRadius = data.startRadius ?? 0.3
  const endRadius = data.endRadius ?? 1.0
  const axis = data.axis ?? 'z'

  return (
    <div className="bg-gray-800 border-2 border-violet-500 rounded-lg w-48 shadow-lg">
      <div className="bg-violet-700 rounded-t-md px-3 py-1.5 flex items-center gap-2">
        <span className="text-sm">🌀</span>
        <span className="text-xs font-bold uppercase tracking-wide">Spiral</span>
      </div>
      <div className="p-3 space-y-2">
        <div>
          <div className="flex justify-between">
            <label className="text-xs text-gray-400">Start radius</label>
            <span className="text-xs font-mono text-violet-300">{startRadius.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={0.0}
            max={1.4}
            step={0.1}
            value={startRadius}
            onChange={(e) => data.onChange?.(id, { startRadius: parseFloat(e.target.value) })}
            className="w-full h-1 mt-1 accent-violet-500"
          />
        </div>
        <div>
          <div className="flex justify-between">
            <label className="text-xs text-gray-400">End radius</label>
            <span className="text-xs font-mono text-violet-300">{endRadius.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={0.1}
            max={1.5}
            step={0.1}
            value={endRadius}
            onChange={(e) => data.onChange?.(id, { endRadius: parseFloat(e.target.value) })}
            className="w-full h-1 mt-1 accent-violet-500"
          />
        </div>
        <div className="flex gap-2 items-center">
          <label className="text-xs text-gray-400">Axis</label>
          <select
            value={axis}
            onChange={(e) => data.onChange?.(id, { axis: e.target.value })}
            className="flex-1 text-xs bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-gray-200"
          >
            <option value="z">Z (vertical)</option>
            <option value="x">X</option>
            <option value="y">Y</option>
          </select>
        </div>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-violet-400 !border-2 !border-gray-800"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-violet-400 !border-2 !border-gray-800"
      />
    </div>
  )
}
