import { useState, useCallback } from 'react'
import { Play, Pause, RotateCcw, Settings, GitBranch } from 'lucide-react'
import TrajectoryVisualizer from './components/TrajectoryVisualizer'
import MacroControls from './components/MacroControls'
import NodeEditor, { NodeEditorStatus } from './components/NodeEditor'
import { useTrajectoryStore } from './store/trajectoryStore'

const HDR = 30   // header height px

function App() {
  const [viewportH,  setViewportH]  = useState(35)   // % of workspace height
  const [showMacro,  setShowMacro]  = useState(false)
  const [compStatus, setCompStatus] = useState<NodeEditorStatus>({
    status: 'idle', info: '', error: '',
  })

  const { isPlaying, togglePlayback, reset, currentTrajectory } = useTrajectoryStore()

  const handleStatus = useCallback((s: NodeEditorStatus) => setCompStatus(s), [])

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#161616', color: '#ccc', fontFamily: 'system-ui,sans-serif',
      overflow: 'hidden',
    }}>

      {/* ── Top header (Blender-style) ── */}
      <div style={{
        height: HDR, minHeight: HDR, flexShrink: 0,
        background: '#1d1d1d', borderBottom: '1px solid #2a2a2a',
        display: 'flex', alignItems: 'center', padding: '0 12px', gap: 12,
        userSelect: 'none', zIndex: 20,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <GitBranch size={13} style={{ color: '#4b7fbf' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#ddd', letterSpacing: '0.06em' }}>OSCAI</span>
        </div>

        <Sep />

        {/* Area labels */}
        <div style={{ display: 'flex', gap: 2, fontSize: 10 }}>
          <AreaTab label="3D Viewport" active={false} />
          <AreaTab label="Node Editor" active={true} />
        </div>

        <Sep />

        {/* Viewport height slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#666' }}>
          <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Viewport</span>
          <input
            type="range" min={15} max={65} value={viewportH}
            onChange={(e) => setViewportH(+e.target.value)}
            style={{ width: 56, accentColor: '#4b7fbf', cursor: 'ns-resize' }}
            title="Viewport height"
          />
          <span style={{ fontFamily: 'monospace', width: 26 }}>{viewportH}%</span>
        </div>

        <Sep />

        {/* Playback */}
        <div style={{ display: 'flex', gap: 3 }}>
          <HBtn onClick={reset}           title="Reset"  icon={<RotateCcw size={11} />} active={false} />
          <HBtn onClick={togglePlayback}  title={isPlaying ? 'Pause' : 'Play'}
            icon={isPlaying ? <Pause size={11} /> : <Play size={11} />}
            active={isPlaying} accent />
        </div>

        <Sep />

        <HBtn onClick={() => setShowMacro(v => !v)} title="Macro Controls"
          icon={<Settings size={11} />} active={showMacro} />

        <div style={{ flex: 1 }} />

        {/* Live compile status */}
        <div style={{ fontSize: 9, fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
          {compStatus.status === 'compiling' && (
            <span style={{ color: '#aaa' }}>● compiling…</span>
          )}
          {compStatus.status === 'ok' && currentTrajectory && (
            <span style={{ color: '#5a9' }}>
              ● {currentTrajectory._metadata?.engine ?? ''}
              &nbsp;· {currentTrajectory.objects.length} obj
              &nbsp;· {currentTrajectory.duration}s
            </span>
          )}
          {compStatus.status === 'error' && (
            <span style={{ color: '#e55', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ✕ {compStatus.error}
            </span>
          )}
        </div>
      </div>

      {/* ── Workspace ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* 3D Visualizer (top) */}
        <div style={{ height: `${viewportH}%`, minHeight: 80, flexShrink: 0, position: 'relative', borderBottom: '2px solid #2a2a2a' }}>
          <TrajectoryVisualizer />
        </div>

        {/* Node Editor (bottom, fills remaining space) */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <NodeEditor onStatus={handleStatus} />
        </div>
      </div>

      {/* ── Macro Controls bottom panel ── */}
      {showMacro && (
        <div style={{ height: 152, flexShrink: 0, borderTop: '1px solid #2a2a2a', background: '#1a1a1a' }}>
          <MacroControls />
        </div>
      )}
    </div>
  )
}

// ── Tiny helpers ─────────────────────────────────────────────────────────────

function Sep() {
  return <div style={{ width: 1, height: 14, background: '#333', flexShrink: 0 }} />
}

function AreaTab({ label, active }: { label: string; active: boolean }) {
  return (
    <div style={{
      padding: '2px 9px', borderRadius: 3, fontSize: 10,
      background: active ? '#2e2e2e' : 'transparent',
      color: active ? '#ccc' : '#555',
      cursor: 'default',
    }}>{label}</div>
  )
}

function HBtn({ onClick, title, icon, active, accent }: {
  onClick: () => void; title: string; icon: React.ReactNode; active: boolean; accent?: boolean
}) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 22, height: 20, borderRadius: 3, border: 'none', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: active ? (accent ? '#4b7fbf' : '#383838') : 'transparent',
      color: active ? '#fff' : '#888',
      transition: 'background 0.1s',
    }}
      onMouseEnter={(e) => { e.currentTarget.style.background = active ? (accent ? '#5a8fd0' : '#404040') : '#2e2e2e'; e.currentTarget.style.color = '#ccc' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = active ? (accent ? '#4b7fbf' : '#383838') : 'transparent'; e.currentTarget.style.color = active ? '#fff' : '#888' }}
    >{icon}</button>
  )
}

export default App
