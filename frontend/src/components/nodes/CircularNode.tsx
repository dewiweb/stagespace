import { Handle, Position, NodeProps } from 'reactflow'

export default function CircularNode({ data, id }: NodeProps) {
  const radius = data.radius ?? 0.7
  const speed = data.speed ?? 1.0
  const plane = data.plane ?? 'xy'
  const phaseOffset = data.phaseOffset ?? true

  return (
    <div className="bg-gray-800 border-2 border-cyan-500 rounded-lg w-48 shadow-lg">
      <div className="bg-cyan-700 rounded-t-md px-3 py-1.5 flex items-center gap-2">
        <span className="text-sm">⭕</span>
        <span className="text-xs font-bold uppercase tracking-wide">Circular</span>
      </div>
      <div className="p-3 space-y-2">
        <div>
          <div className="flex justify-between">
            <label className="text-xs text-gray-400">Radius</label>
            <span className="text-xs font-mono text-cyan-300">{radius.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={0.1}
            max={1.5}
            step={0.1}
            value={radius}
            onChange={(e) => data.onChange?.(id, { radius: parseFloat(e.target.value) })}
            className="w-full h-1 mt-1 accent-cyan-500"
          />
        </div>
        <div>
          <div className="flex justify-between">
            <label className="text-xs text-gray-400">Speed</label>
            <span className="text-xs font-mono text-cyan-300">{speed.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min={0.1}
            max={4.0}
            step={0.1}
            value={speed}
            onChange={(e) => data.onChange?.(id, { speed: parseFloat(e.target.value) })}
            className="w-full h-1 mt-1 accent-cyan-500"
          />
        </div>
        <div className="flex gap-2 items-center">
          <label className="text-xs text-gray-400">Plane</label>
          <select
            value={plane}
            onChange={(e) => data.onChange?.(id, { plane: e.target.value })}
            className="flex-1 text-xs bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-gray-200"
          >
            <option value="xy">XY (horiz)</option>
            <option value="xz">XZ (ground)</option>
            <option value="yz">YZ (front)</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id={`phase-${id}`}
            checked={phaseOffset}
            onChange={(e) => data.onChange?.(id, { phaseOffset: e.target.checked })}
            className="accent-cyan-500"
          />
          <label htmlFor={`phase-${id}`} className="text-xs text-gray-400">Phase offset</label>
        </div>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-cyan-400 !border-2 !border-gray-800"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-cyan-400 !border-2 !border-gray-800"
      />
    </div>
  )
}
