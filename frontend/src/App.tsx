import { useState, useCallback, useRef } from 'react'
import LivePanel from './components/LivePanel'
import LiveSimple from './components/LiveSimple'
import { Play, Pause, RotateCcw, Settings, GitBranch, FileInput, Radio, Mic, Save, FolderOpen } from 'lucide-react'
import HolImport from './components/HolImport'
import TrajectoryVisualizer from './components/TrajectoryVisualizer'
import MacroControls from './components/MacroControls'
import OscPanel from './components/OscPanel'
import AudioPanel from './components/AudioPanel'
import CuePanel from './components/CuePanel'
import NodeEditor, { NodeEditorStatus } from './components/NodeEditor'
import { useGraphStore } from './store/graphStore'

const HDR = 30   // header height px

function App() {
  const [viewportH,  setViewportH]  = useState(35)   // % of workspace height
  const [showMacro,  setShowMacro]  = useState(false)
  const [showOsc,    setShowOsc]    = useState(false)
  const [showAudio,  setShowAudio]  = useState(false)
  const [showCue,    setShowCue]    = useState(false)
  const [showHol,    setShowHol]    = useState(false)
  const [mode,        setMode]        = useState<'editor' | 'live'>('live')
  const [simpleMode, setSimpleMode]  = useState(true)
  const [compStatus, setCompStatus] = useState<NodeEditorStatus>({
    status: 'idle', info: '', error: '', issues: [],
  })

  const isRunning        = useGraphStore((s) => s.isRunning)
  const toggleRuntime    = useGraphStore((s) => s.toggleRuntime)
  const stopRuntime      = useGraphStore((s) => s.stopRuntime)
  const compileResult    = useGraphStore((s) => s.compileResult)
  const bridgeConnected  = useGraphStore((s) => s.bridgeConnected)
  const audioRunning     = useGraphStore((s) => s.audioRunning)
  const cueCount         = useGraphStore((s) => s.cueList.length)
  const saveGraph        = useGraphStore((s) => s.saveGraph)
  const loadGraph        = useGraphStore((s) => s.loadGraph)

  const loadFileRef = useRef<HTMLInputElement>(null)

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
          <span style={{ fontSize: 12, fontWeight: 700, color: '#ddd', letterSpacing: '0.06em' }}>HOLOFLOW</span>
        </div>

        <Sep />

        {/* Area labels */}
        <div style={{ display: 'flex', gap: 2, fontSize: 10 }}>
          <AreaTab label="Éditeur" active={mode === 'editor'} onClick={() => setMode('editor')} />
          <AreaTab label="Live" active={mode === 'live'} onClick={() => setMode('live')} accent />
          <AreaTab label="Simple" active={simpleMode} onClick={() => setSimpleMode(!simpleMode)} />
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
          <HBtn onClick={() => { stopRuntime() }} title="Stop" icon={<RotateCcw size={11} />} active={false} />
          <HBtn onClick={toggleRuntime} title={isRunning ? 'Pause' : 'Play'}
            icon={isRunning ? <Pause size={11} /> : <Play size={11} />}
            active={isRunning} accent />
        </div>

        <Sep />

        <HBtn onClick={() => setShowMacro(v => !v)} title="Macro Controls"
          icon={<Settings size={11} />} active={showMacro} />

        <HBtn onClick={() => setShowOsc(v => !v)} title="OSC Settings"
          icon={
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Radio size={11} />
              {/* bridge status dot */}
              <span style={{
                position: 'absolute', top: -2, right: -2,
                width: 5, height: 5, borderRadius: '50%',
                background: bridgeConnected ? '#4ade80' : '#f87171',
              }} />
            </span>
          }
          active={showOsc} />

        <HBtn onClick={() => setShowHol(true)} title="Import .hol project"
          icon={<FileInput size={11} />} active={false} />

        <HBtn onClick={saveGraph} title="Save graph"
          icon={<Save size={11} />} active={false} />

        <HBtn onClick={() => loadFileRef.current?.click()} title="Load graph"
          icon={<FolderOpen size={11} />} active={false} />
        <input
          ref={loadFileRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            await loadGraph(f)
            e.target.value = ''
          }}
        />

        <HBtn onClick={() => setShowCue(v => !v)} title="Cue List"
          icon={
            <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 10 }}>◈</span>
              {cueCount > 0 && (
                <span style={{ fontSize: 7, color: '#aaa', fontFamily: 'monospace' }}>{cueCount}</span>
              )}
            </span>
          }
          active={showCue} />

        <HBtn onClick={() => setShowAudio(v => !v)} title="Audio IN"
          icon={
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Mic size={11} />
              {audioRunning && (
                <span style={{
                  position: 'absolute', top: -2, right: -2,
                  width: 5, height: 5, borderRadius: '50%',
                  background: '#22c55e',
                  boxShadow: '0 0 4px #22c55e',
                }} />
              )}
            </span>
          }
          active={showAudio} />

        <div style={{ flex: 1 }} />

        {/* Live compile status */}
        <div style={{ fontSize: 9, fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
          {compStatus.status === 'compiling' && (
            <span style={{ color: '#aaa' }}>● compiling…</span>
          )}
          {compStatus.status === 'ok' && compileResult?.success && (
            <span style={{ color: '#5a9' }}>
              ● {compStatus.info}
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>

        {/* Live Mode */}
        {mode === 'live' && (
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
            {simpleMode ? <LiveSimple /> : <LivePanel />}
          </div>
        )}

        {/* Editor Mode */}
        {mode === 'editor' && (<>

        {/* Main area (3D + Node Editor stacked) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>

          {/* 3D Visualizer (top) */}
          <div style={{ height: `${viewportH}%`, minHeight: 80, flexShrink: 0, position: 'relative', borderBottom: '2px solid #2a2a2a' }}>
            <TrajectoryVisualizer />
          </div>

          {/* Node Editor (bottom, fills remaining space) */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <NodeEditor onStatus={handleStatus} />
          </div>
        </div>

        {/* OSC Panel (right sidebar) */}
        {showOsc && (
          <div style={{
            width: 260, flexShrink: 0,
            borderLeft: '1px solid #2a2a2a',
          }}>
            <OscPanel />
          </div>
        )}

        {/* Audio Panel (right sidebar) */}
        {showAudio && (
          <AudioPanel onClose={() => setShowAudio(false)} />
        )}

        {/* Cue Panel (right sidebar) */}
        {showCue && (
          <CuePanel onClose={() => setShowCue(false)} />
        )}
        </>)}
      </div>

      {/* ── Macro Controls bottom panel ── */}
      {showMacro && (
        <div style={{ height: 152, flexShrink: 0, borderTop: '1px solid #2a2a2a', background: '#1a1a1a' }}>
          <MacroControls />
        </div>
      )}
      {/* .hol import modal */}
      {showHol && <HolImport onClose={() => setShowHol(false)} />}
    </div>
  )
}

// ── Tiny helpers ─────────────────────────────────────────────────────────────

function Sep() {
  return <div style={{ width: 1, height: 14, background: '#333', flexShrink: 0 }} />
}

function AreaTab({ label, active, onClick, accent }: {
  label: string; active: boolean; onClick?: () => void; accent?: boolean
}) {
  return (
    <div onClick={onClick} style={{
      padding: '2px 9px', borderRadius: 3, fontSize: 10,
      background: active ? (accent ? '#1e3a5f' : '#2e2e2e') : 'transparent',
      color: active ? (accent ? '#60a5fa' : '#ccc') : '#555',
      cursor: onClick ? 'pointer' : 'default',
      border: active && accent ? '1px solid #2a5a8a' : '1px solid transparent',
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
