import { Node } from 'reactflow'
import { ENGINES_CONFIG, ParamDef } from './nodes/MotionNode'
import { PORT_COLORS, PortType } from './nodes/portTypes'

// ─── Color helpers ─────────────────────────────────────────────────────────────

const CAT_COLOR: Record<string, string> = {
  math:    '#4b7fbf',
  physics: '#c16a28',
  objects: '#6b6b6b',
  duration:'#d4a017',
  output:  '#22c55e',
}

// ─── Shared slider control ─────────────────────────────────────────────────────

function PropSlider({ p, value, accent, onChange }: {
  p: ParamDef; value: number; accent: string
  onChange: (v: number | string | boolean) => void
}) {
  const pct = ((value - (p.min ?? 0)) / ((p.max ?? 1) - (p.min ?? 0))) * 100
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 3 }}>
        <span style={{ color: '#999' }}>{p.label}</span>
        <span style={{ color: accent, fontFamily: 'monospace', fontSize: 9 }}>
          {p.type === 'int' ? value : value.toFixed(3)}
        </span>
      </div>
      <div style={{ position: 'relative', height: 4, background: '#2a2a2a', borderRadius: 2 }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, background: accent, borderRadius: 2, opacity: 0.65 }} />
        <input
          type="range"
          min={p.min ?? 0} max={p.max ?? 1}
          step={p.step ?? (p.type === 'int' ? 1 : 0.001)}
          value={value}
          onChange={(e) => onChange(p.type === 'int' ? parseInt(e.target.value) : parseFloat(e.target.value))}
          style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'ew-resize', height: '100%' }}
        />
      </div>
    </div>
  )
}

// ─── Port legend ───────────────────────────────────────────────────────────────

function PortLegend({ label, type, dir }: { label: string; type: PortType; dir: 'in' | 'out' }) {
  const c = PORT_COLORS[type]
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 8px',
      background: '#242424',
      borderRadius: 3, marginBottom: 3,
      fontSize: 10, color: '#aaa',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: c, flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontSize: 8, color: c, opacity: 0.7, textTransform: 'uppercase' }}>{dir}</span>
    </div>
  )
}

// ─── Section header ────────────────────────────────────────────────────────────

function SectionHead({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, color: '#555', letterSpacing: '0.1em',
      textTransform: 'uppercase', padding: '10px 0 4px',
    }}>{label}</div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

interface NodePropertiesProps {
  node: Node | null
  onChange: (id: string, patch: Record<string, unknown>) => void
}

export default function NodeProperties({ node, onChange }: NodePropertiesProps) {
  if (!node) {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 8,
        color: '#444', fontSize: 11, fontFamily: 'system-ui,sans-serif',
        userSelect: 'none',
      }}>
        <span style={{ fontSize: 22, opacity: 0.3 }}>◻</span>
        <span>Select a node</span>
      </div>
    )
  }

  const type = node.type ?? ''
  const data = node.data as Record<string, unknown>

  const set = (key: string, val: unknown) => onChange(node.id, { [key]: val })
  const get = <T,>(key: string, def: T): T =>
    data[key] !== undefined ? (data[key] as T) : def

  // ── Motion node ──────────────────────────────────────────────────────────────
  if (ENGINES_CONFIG[type]) {
    const cfg    = ENGINES_CONFIG[type]
    const accent = cfg.category === 'math' ? CAT_COLOR.math : CAT_COLOR.physics

    return (
      <div style={{ padding: '0 12px 12px', fontFamily: 'system-ui,sans-serif', overflowY: 'auto', height: '100%' }}>
        {/* Node title */}
        <div style={{
          padding: '10px 0 6px',
          borderBottom: '1px solid #2a2a2a', marginBottom: 8,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 14 }}>{cfg.icon}</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#ddd' }}>{cfg.label}</div>
            <div style={{ fontSize: 9, color: accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>{cfg.category}</div>
          </div>
        </div>

        {/* Ports */}
        <SectionHead label="Ports" />
        <PortLegend label="Objects"    type="objects"    dir="in" />
        <PortLegend label="Duration"   type="duration"   dir="in" />
        <PortLegend label="Trajectory" type="trajectory" dir="out" />

        {/* Parameters */}
        <SectionHead label="Parameters" />
        {cfg.params.map((p) => {
          if (p.type === 'select') {
            return (
              <div key={p.key} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: '#999', marginBottom: 3 }}>{p.label}</div>
                <select
                  value={get(p.key, p.default as string)}
                  onChange={(e) => set(p.key, e.target.value)}
                  style={{
                    width: '100%', background: '#2a2a2a', border: '1px solid #3a3a3a',
                    borderRadius: 3, color: '#ccc', fontSize: 10, padding: '3px 6px',
                    cursor: 'pointer',
                  }}
                >
                  {p.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )
          }

          if (p.type === 'bool') {
            const on = get(p.key, p.default as boolean)
            return (
              <div key={p.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 10, color: '#999' }}>{p.label}</span>
                <div
                  onClick={() => set(p.key, !on)}
                  style={{
                    width: 30, height: 15, borderRadius: 8, cursor: 'pointer',
                    background: on ? accent : '#333',
                    position: 'relative', transition: 'background 0.15s', flexShrink: 0,
                  }}
                >
                  <div style={{
                    position: 'absolute', top: 2, left: on ? 17 : 2,
                    width: 11, height: 11, borderRadius: '50%',
                    background: '#fff', transition: 'left 0.15s',
                  }} />
                </div>
              </div>
            )
          }

          return (
            <PropSlider
              key={p.key} p={p}
              value={get(p.key, p.default as number)}
              accent={accent}
              onChange={(v) => set(p.key, v)}
            />
          )
        })}

        {/* Node ID */}
        <SectionHead label="Node" />
        <div style={{ fontSize: 9, color: '#444', fontFamily: 'monospace' }}>{node.id}</div>
      </div>
    )
  }

  // ── Objects node ──────────────────────────────────────────────────────────────
  if (type === 'objects') {
    const count = get('count', 4)
    return (
      <div style={{ padding: '0 12px 12px', fontFamily: 'system-ui,sans-serif' }}>
        <div style={{ padding: '10px 0 6px', borderBottom: '1px solid #2a2a2a', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>◉</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#ddd' }}>Objects</div>
            <div style={{ fontSize: 9, color: CAT_COLOR.objects, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>source</div>
          </div>
        </div>
        <SectionHead label="Ports" />
        <PortLegend label="Objects" type="objects" dir="out" />
        <SectionHead label="Parameters" />
        <PropSlider
          p={{ key: 'count', label: 'Count', type: 'int', min: 1, max: 64, step: 1, default: 4 }}
          value={count as number}
          accent={CAT_COLOR.objects}
          onChange={(v) => set('count', v)}
        />
        <div style={{ fontSize: 9, color: '#444', marginTop: 4 }}>IDs: 1 – {count}</div>
      </div>
    )
  }

  // ── Duration node ──────────────────────────────────────────────────────────────
  if (type === 'duration') {
    const seconds = get('seconds', 10)
    const presets = [5, 8, 10, 15, 30, 60]
    return (
      <div style={{ padding: '0 12px 12px', fontFamily: 'system-ui,sans-serif' }}>
        <div style={{ padding: '10px 0 6px', borderBottom: '1px solid #2a2a2a', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>⏱</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#ddd' }}>Duration</div>
            <div style={{ fontSize: 9, color: CAT_COLOR.duration, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>source</div>
          </div>
        </div>
        <SectionHead label="Ports" />
        <PortLegend label="Duration" type="duration" dir="out" />
        <SectionHead label="Parameters" />
        <PropSlider
          p={{ key: 'seconds', label: 'Seconds', type: 'int', min: 1, max: 120, step: 1, default: 10 }}
          value={seconds as number}
          accent={CAT_COLOR.duration}
          onChange={(v) => set('seconds', v)}
        />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
          {presets.map((v) => (
            <button
              key={v}
              onClick={() => set('seconds', v)}
              style={{
                padding: '2px 8px', fontSize: 9, borderRadius: 3, border: 'none', cursor: 'pointer',
                background: (seconds as number) === v ? CAT_COLOR.duration : '#252525',
                color: (seconds as number) === v ? '#fff' : '#666',
                fontFamily: 'monospace', transition: 'background 0.1s',
              }}
            >{v}s</button>
          ))}
        </div>
      </div>
    )
  }

  // ── Output node ───────────────────────────────────────────────────────────────
  if (type === 'output') {
    return (
      <div style={{ padding: '0 12px 12px', fontFamily: 'system-ui,sans-serif' }}>
        <div style={{ padding: '10px 0 6px', borderBottom: '1px solid #2a2a2a', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>⊳</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#ddd' }}>Output</div>
            <div style={{ fontSize: 9, color: CAT_COLOR.output, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>sink · compilation target</div>
          </div>
        </div>
        <SectionHead label="Ports" />
        <PortLegend label="Trajectory" type="trajectory" dir="in" />
        <SectionHead label="Info" />
        <div style={{ fontSize: 10, color: '#555', lineHeight: 1.5 }}>
          This node is the graph endpoint.<br />
          Connect a motion engine's Trajectory output to trigger live compilation.
        </div>
      </div>
    )
  }

  // ── Mix node ──────────────────────────────────────────────────────────────────
  if (type === 'mix') {
    const blend = get('blend', 0.5) as number
    return (
      <div style={{ padding: '0 12px 12px', fontFamily: 'system-ui,sans-serif' }}>
        <div style={{ padding: '10px 0 6px', borderBottom: '1px solid #2a2a2a', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>⇌</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#ddd' }}>Mix</div>
            <div style={{ fontSize: 9, color: '#e879f9', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>blend · same objects</div>
          </div>
        </div>
        <SectionHead label="Ports" />
        <PortLegend label="A" type="trajectory" dir="in" />
        <PortLegend label="B" type="trajectory" dir="in" />
        <PortLegend label="Mixed" type="trajectory" dir="out" />
        <SectionHead label="Parameters" />
        <PropSlider
          p={{ key: 'blend', label: 'Blend A→B', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5 }}
          value={blend}
          accent="#e879f9"
          onChange={(v) => set('blend', v)}
        />
        <div style={{ fontSize: 9, color: '#555', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: blend < 0.5 ? '#e879f9' : '#444' }}>← A</span>
          <span style={{ color: '#555' }}>{Math.round(blend * 100)}% B</span>
          <span style={{ color: blend > 0.5 ? '#e879f9' : '#444' }}>B →</span>
        </div>
        <SectionHead label="How it works" />
        <div style={{ fontSize: 10, color: '#555', lineHeight: 1.6 }}>
          Interpolates positions frame-by-frame:<br />
          <code style={{ color: '#888', fontSize: 9 }}>pos = (1-t)·A + t·B</code><br /><br />
          Both inputs must share the same object count.<br />
          Output has the same n_objects — no duplication.
        </div>
      </div>
    )
  }

  // ── Group node ────────────────────────────────────────────────────────────────
  if (type === 'group') {
    return (
      <div style={{ padding: '0 12px 12px', fontFamily: 'system-ui,sans-serif' }}>
        <div style={{ padding: '10px 0 6px', borderBottom: '1px solid #2a2a2a', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>⊕</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#ddd' }}>Group</div>
            <div style={{ fontSize: 9, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>combine · simultaneous</div>
          </div>
        </div>
        <SectionHead label="Ports" />
        <PortLegend label="Trajectory A" type="trajectory" dir="in" />
        <PortLegend label="Trajectory B" type="trajectory" dir="in" />
        <PortLegend label="Combined"     type="trajectory" dir="out" />
        <SectionHead label="How it works" />
        <div style={{ fontSize: 10, color: '#555', lineHeight: 1.6 }}>
          Merges objects from A and B into a single trajectory running&nbsp;<em style={{ color: '#888' }}>simultaneously</em>.<br /><br />
          Objects 0…n<sub>A</sub>-1 follow motion A.<br />
          Objects n<sub>A</sub>…n<sub>A</sub>+n<sub>B</sub>-1 follow motion B.<br /><br />
          <strong style={{ color: '#888' }}>n_objects = n_A + n_B</strong> — total doubles.<br />
          Use <em style={{ color: '#e879f9' }}>Mix</em> instead to blend positions on the same objects.
        </div>
      </div>
    )
  }

  // ── Sequence node ─────────────────────────────────────────────────────────────
  if (type === 'sequence') {
    return (
      <div style={{ padding: '0 12px 12px', fontFamily: 'system-ui,sans-serif' }}>
        <div style={{ padding: '10px 0 6px', borderBottom: '1px solid #2a2a2a', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>▶▶</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#ddd' }}>Sequence</div>
            <div style={{ fontSize: 9, color: '#0ea5e9', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>chain · temporal</div>
          </div>
        </div>
        <SectionHead label="Ports" />
        <PortLegend label="First"    type="trajectory" dir="in" />
        <PortLegend label="Then"     type="trajectory" dir="in" />
        <PortLegend label="Sequence" type="trajectory" dir="out" />
        <SectionHead label="How it works" />
        <div style={{ fontSize: 10, color: '#555', lineHeight: 1.6 }}>
          Runs motion&nbsp;<em style={{ color: '#888' }}>First</em> for its full duration, then switches to&nbsp;<em style={{ color: '#888' }}>Then</em>.<br /><br />
          Both inputs must have the same object count.<br /><br />
          Total duration = First.duration + Then.duration.
        </div>
      </div>
    )
  }

  // ── Unknown ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 12, fontSize: 10, color: '#555', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ marginBottom: 4, color: '#888' }}>Node: {type}</div>
      <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#444' }}>{node.id}</div>
    </div>
  )
}
