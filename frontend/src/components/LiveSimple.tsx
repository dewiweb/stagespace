/**
 * LiveSimple — Interface minimaliste pour performance live
 * 
 * Design principles:
 * - Un seul écran, pas de mode Editor/Live
 * - Sélection moteur en 1 clic (grille de boutons)
 * - Play/Stop global + sliders macro
 * - Presets rapides (clic)
 * - Feedback visuel immédiat
 */

import { useState, useEffect, useCallback } from 'react'
import { Play, Square, Sliders, Zap, Save, FolderOpen, Music } from 'lucide-react'

const API = 'http://localhost:8080'

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(res.statusText)
  return res.json()
}

const ENGINES = [
  { id: 'circular', label: 'Circle', color: '#4b7fbf' },
  { id: 'spiral', label: 'Spiral', color: '#7b4fbf' },
  { id: 'lissajous', label: 'Lissajous', color: '#bf4b7f' },
  { id: 'figure8', label: 'Figure-8', color: '#bf7b4b' },
  { id: 'linear', label: 'Linear', color: '#7bbf4b' },
  { id: 'oscillation', label: 'Oscillate', color: '#4bbf7b' },
  { id: 'perlin_noise', label: 'Noise', color: '#bf4b4b' },
  { id: 'formation', label: 'Formation', color: '#4b4bbf' },
  { id: 'converge', label: 'Converge', color: '#4bbfbf' },
  { id: 'pendulum', label: 'Pendulum', color: '#bf7bbf' },
  { id: 'bouncing', label: 'Bounce', color: '#7fbf4b' },
  { id: 'swarm', label: 'Swarm', color: '#bf4b7b' },
]

const PROFILES = ['holophonix', 'adm_osc', 'generic_cartesian', 'iem']

export default function LiveSimple() {
  const [playing, setPlaying] = useState(false)
  const [currentEngine, setCurrentEngine] = useState('circular')
  const [currentProfile, setCurrentProfile] = useState('holophonix')
  const [speed, setSpeed] = useState(1.0)
  const [turbulence, setTurbulence] = useState(0.0)
  const [scale, setScale] = useState(1.0)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const handlePlay = useCallback(async () => {
    if (playing) {
      await api('POST', '/api/stop')
      setPlaying(false)
      setSessionId(null)
    } else {
      const res = await api('POST', '/api/play', {
        engine: currentEngine,
        profile: currentProfile,
        host: '127.0.0.1',
        port: 7788,
        fps: 60,
        params: { n_objects: 1 },
      })
      setSessionId(res.session_id)
      setPlaying(true)
    }
  }, [playing, currentEngine, currentProfile])

  const handleEngineChange = useCallback(async (engine: string) => {
    if (playing) {
      await api('POST', '/api/stop')
      setPlaying(false)
    }
    setCurrentEngine(engine)
  }, [playing])

  const handleMacro = useCallback(async (macro: string, value: number) => {
    if (!sessionId) return
    await api('POST', `/api/macros/${sessionId}`, { [macro]: value })
  }, [sessionId])

  return (
    <div style={{
      height: '100vh',
      background: '#0a0a0a',
      color: '#ccc',
      fontFamily: 'system-ui, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      padding: 20,
      gap: 20,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 20px',
        height: 60,
        background: '#111',
        borderRadius: 8,
        border: '1px solid #222',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Zap size={24} style={{ color: '#4b7fbf' }} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>HOLOFLOW</div>
            <div style={{ fontSize: 11, color: '#666' }}>Live Performance</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handlePlay}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12 24',
              background: playing ? '#ef4444' : '#22c55e',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {playing ? <Square size={18} /> : <Play size={18} />}
            {playing ? 'STOP' : 'PLAY'}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', gap: 20, minHeight: 0 }}>
        {/* Engine Selection */}
        <div style={{
          flex: 1,
          background: '#111',
          borderRadius: 8,
          border: '1px solid #222',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#888', marginBottom: 12, textTransform: 'uppercase' }}>
            Engine
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
            gap: 8,
            flex: 1,
          }}>
            {ENGINES.map((eng) => (
              <button
                key={eng.id}
                onClick={() => handleEngineChange(eng.id)}
                style={{
                  padding: 16,
                  background: currentEngine === eng.id ? eng.color : '#1a1a1a',
                  color: currentEngine === eng.id ? '#fff' : '#888',
                  border: currentEngine === eng.id ? 'none' : '1px solid #333',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {eng.label}
              </button>
            ))}
          </div>
        </div>

        {/* Macro Controls */}
        <div style={{
          width: 280,
          background: '#111',
          borderRadius: 8,
          border: '1px solid #222',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase' }}>
            Macro
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sliders size={16} style={{ color: '#666' }} />
            <span style={{ fontSize: 11, color: '#666' }}>Speed</span>
          </div>
          <input
            type="range"
            min={0.1}
            max={3.0}
            step={0.1}
            value={speed}
            onChange={(e) => { setSpeed(parseFloat(e.target.value)); handleMacro('speed', parseFloat(e.target.value)) }}
            style={{ width: '100%', accentColor: '#4b7fbf' }}
          />
          <div style={{ fontSize: 11, color: '#4b7fbf', textAlign: 'right', fontFamily: 'monospace' }}>
            {speed.toFixed(1)}x
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={16} style={{ color: '#666' }} />
            <span style={{ fontSize: 11, color: '#666' }}>Turbulence</span>
          </div>
          <input
            type="range"
            min={0.0}
            max={1.0}
            step={0.05}
            value={turbulence}
            onChange={(e) => { setTurbulence(parseFloat(e.target.value)); handleMacro('turbulence', parseFloat(e.target.value)) }}
            style={{ width: '100%', accentColor: '#bf4b4b' }}
          />
          <div style={{ fontSize: 11, color: '#bf4b4b', textAlign: 'right', fontFamily: 'monospace' }}>
            {(turbulence * 100).toFixed(0)}%
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Music size={16} style={{ color: '#666' }} />
            <span style={{ fontSize: 11, color: '#666' }}>Scale</span>
          </div>
          <input
            type="range"
            min={0.1}
            max={2.0}
            step={0.1}
            value={scale}
            onChange={(e) => { setScale(parseFloat(e.target.value)); handleMacro('scale', parseFloat(e.target.value)) }}
            style={{ width: '100%', accentColor: '#4bbf7b' }}
          />
          <div style={{ fontSize: 11, color: '#4bbf7b', textAlign: 'right', fontFamily: 'monospace' }}>
            {scale.toFixed(1)}x
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div style={{
        height: 40,
        background: '#111',
        borderRadius: 8,
        border: '1px solid #222',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16',
        gap: 16,
        fontSize: 11,
        color: '#666',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: playing ? '#22c55e' : '#ef4444',
            boxShadow: playing ? '0 0 8px #22c55e' : 'none',
          }} />
          <span>{playing ? 'PLAYING' : 'STOPPED'}</span>
        </div>
        <div style={{ flex: 1 }} />
        <div>Engine: <span style={{ color: '#4b7fbf' }}>{currentEngine}</span></div>
        <div>Profile: <span style={{ color: '#4b7fbf' }}>{currentProfile}</span></div>
        {sessionId && <div>Session: <span style={{ fontFamily: 'monospace', color: '#4b7fbf' }}>{sessionId.slice(0, 8)}</span></div>}
      </div>
    </div>
  )
}