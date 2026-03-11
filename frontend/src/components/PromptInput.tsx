import { useState } from 'react'
import { Zap, Loader2, Clock } from 'lucide-react'
import { useTrajectoryStore } from '../store/trajectoryStore'

// ─── Quick presets ────────────────────────────────────────────────────────────

const PRESETS = [
  { label: '⭕ Circular × 4',    engine: 'circular',    n: 4,  dur: 10 },
  { label: '🌀 Spiral × 8',      engine: 'spiral',      n: 8,  dur: 12 },
  { label: '∞ Lissajous × 6',    engine: 'lissajous',   n: 6,  dur: 10 },
  { label: '🎲 Perlin × 4',      engine: 'perlin_noise',n: 4,  dur: 10 },
  { label: '📐 Formation ×16',   engine: 'formation',   n: 16, dur: 8  },
  { label: '🔵 Bouncing × 8',    engine: 'bouncing',    n: 8,  dur: 10 },
  { label: '🐦 Swarm ×12',       engine: 'swarm',       n: 12, dur: 12 },
  { label: '🔗 Follow × 6',      engine: 'follow',      n: 6,  dur: 10 },
  { label: '⚖️ Pendulum × 3',    engine: 'pendulum',    n: 3,  dur: 8  },
  { label: '💫 Converge ×8',     engine: 'converge',    n: 8,  dur: 8  },
]

const ENGINE_GROUPS = {
  'Math': ['circular', 'spiral', 'lissajous', 'figure8', 'linear', 'oscillation', 'perlin_noise', 'formation', 'converge', 'pendulum'],
  'Physics': ['bouncing', 'avoidance', 'spring', 'follow', 'swarm'],
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function QuickGenerate() {
  const [engine, setEngine]     = useState('circular')
  const [nObjects, setNObjects] = useState(4)
  const [duration, setDuration] = useState(10)
  const [error, setError]       = useState<string | null>(null)

  const { isGenerating, setGenerating, setTrajectory, trajectoryHistory } = useTrajectoryStore()

  const generate = async (eng = engine, n = nObjects, dur = duration) => {
    setGenerating(true)
    setError(null)
    try {
      const url = `/api/generate-direct?engine=${eng}&n_objects=${n}&duration=${dur}&fps=60`
      const res = await fetch(url, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail ?? `HTTP ${res.status}`)
      }
      const data = await res.json()
      setTrajectory(data.trajectory)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="p-5 space-y-5">

      {/* Quick presets */}
      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Quick Presets</div>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => generate(p.engine, p.n, p.dur)}
              disabled={isGenerating}
              className="px-2 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded text-xs text-left transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom generate */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Custom</div>

        <div>
          <label className="text-xs text-gray-400">Engine</label>
          <select
            value={engine}
            onChange={(e) => setEngine(e.target.value)}
            className="w-full mt-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
            disabled={isGenerating}
          >
            {Object.entries(ENGINE_GROUPS).map(([group, engines]) => (
              <optgroup key={group} label={group}>
                {engines.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex justify-between">
              <label className="text-xs text-gray-400">Objects</label>
              <span className="text-xs font-mono text-primary-400">{nObjects}</span>
            </div>
            <input
              type="range" min={1} max={32} value={nObjects}
              onChange={(e) => setNObjects(+e.target.value)}
              className="w-full h-1 mt-1 accent-primary-500"
              disabled={isGenerating}
            />
          </div>
          <div>
            <div className="flex justify-between">
              <label className="text-xs text-gray-400">Duration</label>
              <span className="text-xs font-mono text-primary-400">{duration}s</span>
            </div>
            <input
              type="range" min={2} max={60} value={duration}
              onChange={(e) => setDuration(+e.target.value)}
              className="w-full h-1 mt-1 accent-primary-500"
              disabled={isGenerating}
            />
          </div>
        </div>

        <button
          onClick={() => generate()}
          disabled={isGenerating}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm font-medium transition-colors"
        >
          {isGenerating
            ? <><Loader2 className="w-4 h-4 animate-spin" />Generating…</>
            : <><Zap className="w-4 h-4" />Generate</>}
        </button>

        {error && (
          <div className="text-xs text-red-400 bg-red-900/20 rounded px-3 py-2">{error}</div>
        )}
      </div>

      {/* History */}
      {trajectoryHistory.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">History</div>
          <div className="space-y-1.5">
            {trajectoryHistory.slice(0, 5).map((traj, i) => (
              <div key={i} className="px-3 py-2 bg-gray-800 rounded text-xs space-y-0.5">
                <div className="text-gray-300 font-medium">{traj._metadata?.engine ?? '—'}</div>
                <div className="flex items-center gap-3 text-gray-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {traj.duration}s
                  </span>
                  <span>{traj.objects.length} obj</span>
                  <span>{traj._metadata?.n_frames ?? 0} frames</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
