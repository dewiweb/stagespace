import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useTrajectoryStore } from '../store/trajectoryStore'

export default function GenerationProgress() {
  const { generationProgress } = useTrajectoryStore()
  const { status, progress, message } = generationProgress

  const getStatusIcon = () => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />
      default:
        return <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
    }
  }

  const getStatusColor = () => {
    switch (status) {
      case 'completed':
        return 'bg-green-500'
      case 'error':
        return 'bg-red-500'
      default:
        return 'bg-primary-500'
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {getStatusIcon()}
        <div className="flex-1">
          <div className="text-sm font-medium">{message}</div>
          <div className="text-xs text-gray-500 mt-1">
            {status === 'processing' && 'This may take 20-40s on CPU...'}
            {status === 'validating' && 'Almost done...'}
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${getStatusColor()}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Tips during generation */}
      {status === 'processing' && (
        <div className="p-3 bg-gray-800/50 rounded text-xs text-gray-400 space-y-1">
          <div className="font-medium text-gray-300">💡 While you wait:</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>CPU generation is slower but 100% private</li>
            <li>Results are cached for instant replay</li>
            <li>Try generating multiple variations at once</li>
          </ul>
        </div>
      )}
    </div>
  )
}
