import { Handle, Position, NodeProps } from 'reactflow'

export default function GenerateNode({ data }: NodeProps) {
  const isGenerating = data.isGenerating ?? false
  const lastPrompt = data.lastPrompt ?? ''

  return (
    <div className="bg-gray-800 border-2 border-rose-500 rounded-lg w-44 shadow-lg">
      <div className="bg-rose-700 rounded-t-md px-3 py-1.5 flex items-center gap-2">
        <span className="text-sm">🚀</span>
        <span className="text-xs font-bold uppercase tracking-wide">Generate</span>
      </div>
      <div className="p-3 space-y-2">
        <button
          onClick={data.onGenerate}
          disabled={isGenerating}
          className="w-full py-2 bg-rose-600 hover:bg-rose-500 disabled:bg-gray-700 disabled:text-gray-500 rounded font-medium text-sm transition-colors"
        >
          {isGenerating ? (
            <span className="flex items-center justify-center gap-1">
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Generating...
            </span>
          ) : '⚡ Generate'}
        </button>
        {lastPrompt && (
          <div className="text-xs text-gray-500 truncate" title={lastPrompt}>
            {lastPrompt}
          </div>
        )}
      </div>
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-rose-400 !border-2 !border-gray-800"
      />
    </div>
  )
}
