// ── AudioPanel — Audio IN monitoring (mic → BPM + amplitude) ─────────────────

import { useRef, useEffect } from 'react'
import { useGraphStore } from '../store/graphStore'

// ── VU-metre canvas ───────────────────────────────────────────────────────────

function VuMetre({ amplitude, peak, beat }: { amplitude: number; peak: number; beat: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const W = cv.width, H = cv.height

    ctx.clearRect(0, 0, W, H)

    // Background
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, W, H)

    // Gradient bar
    const grad = ctx.createLinearGradient(0, H, 0, 0)
    grad.addColorStop(0,   '#22c55e')
    grad.addColorStop(0.6, '#eab308')
    grad.addColorStop(1,   '#ef4444')
    ctx.fillStyle = grad
    ctx.fillRect(0, H * (1 - amplitude), W, H * amplitude)

    // Peak marker
    if (peak > 0) {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, H * (1 - peak) - 1, W, 2)
    }

    // Beat flash overlay
    if (beat) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)'
      ctx.fillRect(0, 0, W, H)
    }
  }, [amplitude, peak, beat])

  return (
    <canvas
      ref={canvasRef}
      width={18}
      height={80}
      style={{ borderRadius: 3, border: '1px solid #2a2a2a' }}
    />
  )
}

// ── Spectrum mini canvas ──────────────────────────────────────────────────────

function SpectrumBar({ spectrum }: { spectrum: Float32Array }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const W = cv.width, H = cv.height

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, W, H)

    // Use first 256 bins (up to ~5.5 kHz at 44.1k)
    const bins = Math.min(spectrum.length, 256)
    const barW = W / bins
    const minDb = -90, maxDb = -20
    const grad = ctx.createLinearGradient(0, H, 0, 0)
    grad.addColorStop(0, '#4b7fbf')
    grad.addColorStop(1, '#8b5cf6')
    ctx.fillStyle = grad

    for (let i = 0; i < bins; i++) {
      const db  = spectrum[i]
      const norm = Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)))
      const h = norm * H
      ctx.fillRect(i * barW, H - h, barW - 0.5, h)
    }
  }, [spectrum])

  return (
    <canvas
      ref={canvasRef}
      width={160}
      height={36}
      style={{ borderRadius: 3, border: '1px solid #2a2a2a', display: 'block' }}
    />
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface AudioPanelProps {
  onClose?: () => void
}

export default function AudioPanel({ onClose }: AudioPanelProps) {
  const audioFrame   = useGraphStore((s) => s.audioFrame)
  const audioRunning = useGraphStore((s) => s.audioRunning)
  const startAudio   = useGraphStore((s) => s.startAudio)
  const stopAudio    = useGraphStore((s) => s.stopAudio)

  const handleToggle = async () => {
    if (audioRunning) stopAudio()
    else await startAudio()
  }

  const { amplitude, peak, bpm, beat, spectrum } = audioFrame

  return (
    <div style={{
      width: 220,
      background: '#141414',
      borderLeft: '1px solid #222',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'monospace',
      fontSize: 10,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 10px', borderBottom: '1px solid #222',
        background: '#111',
      }}>
        <span style={{ fontSize: 11 }}>🎙</span>
        <span style={{ fontWeight: 700, color: '#ccc', flex: 1, letterSpacing: '0.05em' }}>AUDIO IN</span>
        <div
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: audioRunning ? '#22c55e' : '#333',
            boxShadow: audioRunning ? '0 0 4px #22c55e' : 'none',
            flexShrink: 0,
          }}
        />
        {onClose && (
          <div
            onClick={onClose}
            style={{ cursor: 'pointer', color: '#555', padding: '0 2px', userSelect: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#aaa')}
            onMouseLeave={e => (e.currentTarget.style.color = '#555')}
          >×</div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '10px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Start/Stop */}
        <button
          onClick={handleToggle}
          style={{
            width: '100%', padding: '5px 0', borderRadius: 4, border: 'none',
            background: audioRunning ? '#7f1d1d' : '#14532d',
            color: audioRunning ? '#fca5a5' : '#86efac',
            fontFamily: 'monospace', fontSize: 10, cursor: 'pointer',
            fontWeight: 700, letterSpacing: '0.05em',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          {audioRunning ? '■  STOP' : '●  START'}
        </button>

        {/* VU + BPM row */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <VuMetre amplitude={amplitude} peak={peak} beat={beat} />

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* Amplitude value */}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>RMS</span>
              <span style={{ color: '#22c55e' }}>{(amplitude * 100).toFixed(0)}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Peak</span>
              <span style={{ color: '#eab308' }}>{(peak * 100).toFixed(0)}%</span>
            </div>

            {/* BPM */}
            <div style={{
              marginTop: 4, padding: '4px 8px',
              background: beat ? '#1a0a2e' : '#1a1a1a',
              borderRadius: 4, border: `1px solid ${beat ? '#8b5cf6' : '#2a2a2a'}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              transition: 'border-color 0.08s',
            }}>
              <span style={{ color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>BPM</span>
              <span style={{ color: bpm > 0 ? '#8b5cf6' : '#333', fontSize: 13, fontWeight: 700 }}>
                {bpm > 0 ? bpm : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Spectrum */}
        <div>
          <div style={{ color: '#444', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
            Spectrum
          </div>
          <SpectrumBar spectrum={spectrum} />
        </div>

        {/* Signal nodes hint */}
        <div style={{
          marginTop: 2, padding: '6px 8px',
          background: '#1a1a1a', borderRadius: 4, border: '1px solid #222',
          color: '#444', lineHeight: 1.5,
        }}>
          Connect <span style={{ color: '#666' }}>audioAmplitude</span> or{' '}
          <span style={{ color: '#666' }}>bpm</span> nodes to a Falloff port
        </div>
      </div>
    </div>
  )
}
