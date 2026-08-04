/**
 * DrawPad
 *
 * 2D top-down canvas for drawing freehand or waypoint trajectories.
 * Sends drawn path to POST /api/sessions/{id}/draw on release.
 *
 * Modes:
 *   freehand  — drag/touch draws continuous path
 *   waypoint  — each tap places a point, connected by lines
 *
 * Props:
 *   sessionId  — active session to send trajectory to
 *   color      — group accent color
 *   label      — group name
 *   onDone     — callback when trajectory sent successfully
 */

import { useRef, useState, useCallback, useEffect } from 'react'
import { Pencil, MapPin, RotateCcw, Send, Check, Settings2 } from 'lucide-react'

const API = 'http://localhost:8080'

type Point2D = { x: number; y: number }   // canvas pixels
type Vec3    = { x: number; y: number; z: number }  // normalised -1..1

// canvas pixel → normalised [-1, 1]
function toNorm(p: Point2D, w: number, h: number): Vec3 {
  return {
    x:  (p.x / w) * 2 - 1,
    y: -((p.y / h) * 2 - 1),   // flip Y: top = +1
    z: 0,
  }
}

function catmullRom(pts: Point2D[]): Point2D[] {
  if (pts.length < 2) return pts
  const result: Point2D[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    for (let t = 0; t <= 1; t += 0.05) {
      const t2 = t * t, t3 = t2 * t
      result.push({
        x: 0.5 * ((2*p1.x) + (-p0.x+p2.x)*t + (2*p0.x-5*p1.x+4*p2.x-p3.x)*t2 + (-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
        y: 0.5 * ((2*p1.y) + (-p0.y+p2.y)*t + (2*p0.y-5*p1.y+4*p2.y-p3.y)*t2 + (-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
      })
    }
  }
  return result
}

type Mode = 'freehand' | 'waypoint'

export default function DrawPad({ sessionId, color = '#60a5fa', label = '', onDone }: {
  sessionId: string | null
  color?: string
  label?: string
  onDone?: () => void
}) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const [mode, setMode]       = useState<Mode>('freehand')
  const [points, setPoints]   = useState<Point2D[]>([])
  const [drawing, setDrawing] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState('')
  const [duration, setDuration] = useState<number | ''>(4)
  const [interp, setInterp]     = useState<'linear' | 'smooth' | 'step'>('linear')
  const [showSettings, setShowSettings] = useState(false)
  const rawRef = useRef<Point2D[]>([])   // raw points during freehand drag

  // ── draw canvas ──────────────────────────────────────────────────────────────

  const redraw = useCallback((pts: Point2D[]) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx  = canvas.getContext('2d')!
    const { width: w, height: h } = canvas
    ctx.clearRect(0, 0, w, h)

    // Grid
    ctx.strokeStyle = '#1e1e1e'
    ctx.lineWidth   = 1
    const step = w / 8
    for (let x = 0; x <= w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
    for (let y = 0; y <= h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }

    // Axes
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke()

    if (pts.length < 2) return

    const smoothed = mode === 'waypoint' ? catmullRom(pts) : pts

    // Trail
    ctx.strokeStyle = color + '60'
    ctx.lineWidth   = 2
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(smoothed[0].x, smoothed[0].y)
    smoothed.forEach(p => ctx.lineTo(p.x, p.y))
    ctx.stroke()
    ctx.setLineDash([])

    // Path
    ctx.strokeStyle = color
    ctx.lineWidth   = 2.5
    ctx.lineJoin    = 'round'
    ctx.lineCap     = 'round'
    ctx.beginPath()
    ctx.moveTo(smoothed[0].x, smoothed[0].y)
    smoothed.forEach(p => ctx.lineTo(p.x, p.y))
    // Close loop preview
    ctx.lineTo(smoothed[0].x, smoothed[0].y)
    ctx.stroke()

    // Waypoint dots
    if (mode === 'waypoint') {
      pts.forEach((p, i) => {
        ctx.fillStyle = i === 0 ? color : color + 'aa'
        ctx.beginPath()
        ctx.arc(p.x, p.y, i === 0 ? 7 : 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#111'
        ctx.font = '10px monospace'
        ctx.fillText(`${i + 1}`, p.x - 3, p.y + 4)
      })
    } else {
      // Start dot
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 6, 0, Math.PI * 2); ctx.fill()
    }
  }, [color, mode])

  useEffect(() => { redraw(points) }, [points, redraw])

  // ── pointer events ───────────────────────────────────────────────────────────

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>): Point2D => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    setSent(false); setError('')
    if (mode === 'waypoint') {
      setPoints(prev => [...prev, getPos(e)])
    } else {
      rawRef.current = [getPos(e)]
      setDrawing(true)
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    if (mode === 'freehand') {
      if (!drawing) return
      const p = getPos(e)
      rawRef.current.push(p)
      if (rawRef.current.length % 3 === 0) redraw(rawRef.current)
    } else {
      // waypoint: show live rubber-band line from last point to cursor
      if (points.length === 0) return
      const p = getPos(e)
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')!
      redraw(points)
      const last = points[points.length - 1]
      ctx.strokeStyle = '#ffffff30'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke()
      ctx.setLineDash([])
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'freehand') return
    if (!drawing) return
    e.preventDefault()
    setDrawing(false)
    const raw = rawRef.current
    const step = Math.max(1, Math.floor(raw.length / 60))
    const sampled = raw.filter((_, i) => i % step === 0)
    setPoints(sampled)
  }

  // ── send to backend ──────────────────────────────────────────────────────────

  const sendTrajectory = async () => {
    if (!sessionId || points.length < 2) return
    const canvas = canvasRef.current!
    const { width: w, height: h } = canvas
    const normalised = points.map(p => toNorm(p, w, h))
    try {
      const res = await fetch(`${API}/api/sessions/${sessionId}/draw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points:   normalised,
          duration: duration === '' ? null : duration,
          interp,
          fade_frames: 8,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).detail)
      setSent(true)
      onDone?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const clear = () => { setPoints([]); setSent(false); setError(''); rawRef.current = [] }

  // ── render ───────────────────────────────────────────────────────────────────

  const canSend = !!sessionId && points.length >= 2

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 font-mono flex-1">{label || 'draw trajectory'}</span>
        {/* Mode toggle */}
        <button
          onClick={() => { setMode(m => m === 'freehand' ? 'waypoint' : 'freehand'); clear() }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-300 transition-colors"
          title="Switch mode"
        >
          {mode === 'freehand' ? <><Pencil size={11} /> free</> : <><MapPin size={11} /> pts</>}
        </button>
        <button onClick={clear} className="p-1.5 text-gray-600 hover:text-gray-400 transition-colors" title="Clear">
          <RotateCcw size={13} />
        </button>
        <button onClick={() => setShowSettings(s => !s)}
          className={`p-1.5 transition-colors ${showSettings ? 'text-blue-400' : 'text-gray-600 hover:text-gray-400'}`}
          title="Settings"
        >
          <Settings2 size={13} />
        </button>
        <button onClick={sendTrajectory} disabled={!canSend}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-30 ${
            sent ? 'bg-green-800 text-green-300' : 'bg-blue-700 hover:bg-blue-600 text-white'
          }`}
        >
          {sent ? <><Check size={12} /> Applied</> : <><Send size={12} /> Apply</>}
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="flex items-center gap-3 px-3 py-2 bg-gray-900 rounded-lg border border-gray-800">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">duration</span>
            <input type="number" min={0.5} max={60} step={0.5} value={duration}
              onChange={e => setDuration(e.target.value === '' ? '' : parseFloat(e.target.value))}
              className="w-14 bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-300 font-mono focus:outline-none focus:border-blue-500"
            />
            <span className="text-xs text-gray-600">s</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">interp</span>
            <select value={interp} onChange={e => setInterp(e.target.value as typeof interp)}
              className="bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
            >
              <option value="linear">linear</option>
              <option value="smooth">smooth</option>
              <option value="step">step</option>
            </select>
          </div>
        </div>
      )}

      {/* Canvas */}
      <div className="relative rounded-xl overflow-hidden border border-gray-800"
        style={{ background: '#0a0a0a' }}
      >
        <canvas
          ref={canvasRef}
          width={400} height={280}
          className="w-full touch-none cursor-crosshair"
          style={{ display: 'block' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
        {!sessionId && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <span className="text-gray-600 text-xs italic">no active session</span>
          </div>
        )}
        {points.length === 0 && sessionId && (
          <div className="absolute bottom-2 left-0 right-0 text-center pointer-events-none">
            <span className="text-gray-700 text-xs">
              {mode === 'freehand' ? 'drag to draw' : 'tap to place points'}
            </span>
          </div>
        )}
        {points.length >= 2 && (
          <div className="absolute top-2 right-2 pointer-events-none font-mono text-xs"
            style={{ color: color, background: 'rgba(0,0,0,0.6)', padding: '2px 6px', borderRadius: 4 }}
          >
            {points.length} pts
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
