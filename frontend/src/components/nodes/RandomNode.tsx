import { Handle, Position, NodeProps } from 'reactflow'

export default function RandomNode({ data, id }: NodeProps) {
  const intensity = data.intensity ?? 0.5
  const bounded = data.bounded ?? true

  return (
    <div className="bg-gray-800 border-2 border-orange-500 rounded-lg w-48 shadow-lg">
      <div className="bg-orange-700 rounded-t-md px-3 py-1.5 flex items-center gap-2">
        <span className="text-sm">🎲</span>
        <span className="text-xs font-bold uppercase tracking-wide">Random Walk</span>
      </div>
      <div className="p-3 space-y-2">
        <div>
          <div className="flex justify-between">
            <label className="text-xs text-gray-400">Intensity</label>
            <span className="text-xs font-mono text-orange-300">{intensity.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={0.1}
            max={1.0}
            step={0.1}
            value={intensity}
            onChange={(e) => data.onChange?.(id, { intensity: parseFloat(e.target.value) })}
            className="w-full h-1 mt-1 accent-orange-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={`bounded-${id}`}
            checked={bounded}
            onChange={(e) => data.onChange?.(id, { bounded: e.target.checked })}
            className="accent-orange-500"
          />
          <label htmlFor={`bounded-${id}`} className="text-xs text-gray-400">
            Stay in bounds
          </label>
        </div>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-orange-400 !border-2 !border-gray-800"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-orange-400 !border-2 !border-gray-800"
      />
    </div>
  )
}
