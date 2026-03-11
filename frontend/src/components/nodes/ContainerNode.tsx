import { Handle, Position, NodeProps } from 'reactflow'

export default function ContainerNode({ data, id }: NodeProps) {
  const type = data.containerType ?? 'sphere'
  const size = data.size ?? 1.0

  return (
    <div className="bg-gray-800 border-2 border-emerald-500 rounded-lg w-48 shadow-lg">
      <div className="bg-emerald-700 rounded-t-md px-3 py-1.5 flex items-center gap-2">
        <span className="text-sm">📦</span>
        <span className="text-xs font-bold uppercase tracking-wide">Container</span>
      </div>
      <div className="p-3 space-y-2">
        <div className="flex gap-2 items-center">
          <label className="text-xs text-gray-400">Type</label>
          <select
            value={type}
            onChange={(e) => data.onChange?.(id, { containerType: e.target.value })}
            className="flex-1 text-xs bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-gray-200"
          >
            <option value="sphere">Sphere</option>
            <option value="box">Box</option>
            <option value="cylinder">Cylinder</option>
          </select>
        </div>
        <div>
          <div className="flex justify-between">
            <label className="text-xs text-gray-400">Size</label>
            <span className="text-xs font-mono text-emerald-300">{size.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min={0.3}
            max={2.0}
            step={0.1}
            value={size}
            onChange={(e) => data.onChange?.(id, { size: parseFloat(e.target.value) })}
            className="w-full h-1 mt-1 accent-emerald-500"
          />
        </div>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-emerald-400 !border-2 !border-gray-800"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-emerald-400 !border-2 !border-gray-800"
      />
    </div>
  )
}
