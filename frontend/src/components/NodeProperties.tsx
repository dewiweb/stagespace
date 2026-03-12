import { Node } from 'reactflow'
import { getNodeDescriptor, ParamDef } from './nodes/nodeRegistry'
import { PORT_COLORS, PortType } from './nodes/portTypes'
import { useGraphStore } from '../store/graphStore'

// ─── Sub-components ────────────────────────────────────────────────────────────

function SectionHead({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, color: '#555', letterSpacing: '0.1em',
      textTransform: 'uppercase', padding: '10px 0 4px',
    }}>{label}</div>
  )
}

function PortLegend({ label, type, dir }: { label: string; type: PortType; dir: 'in' | 'out' }) {
  const c = PORT_COLORS[type]
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 8px', background: '#242424',
      borderRadius: 3, marginBottom: 3, fontSize: 10, color: '#aaa',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: c, flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontSize: 8, color: c, opacity: 0.7, textTransform: 'uppercase' }}>{dir}</span>
    </div>
  )
}

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
        <div style={{
          position: 'absolute', left: 0, top: 0, height: '100%',
          width: `${Math.max(0, Math.min(100, pct))}%`,
          background: accent, borderRadius: 2, opacity: 0.65,
        }} />
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

// ─── ObjectsTrackSelector ──────────────────────────────────────────────────────

function ObjectsTrackSelector({
  count, trackIds, onChange,
}: {
  count: number
  trackIds: number[] | undefined
  onChange: (ids: number[]) => void
}) {
  const holProject = useGraphStore((s) => s.holProject)

  if (!holProject || holProject.tracks.length === 0) {
    // No .hol loaded — show plain info
    const ids = trackIds ?? Array.from({ length: count }, (_, i) => i + 1)
    return (
      <div style={{ fontSize: 9, color: '#444', marginTop: 4, fontFamily: 'monospace' }}>
        OSC IDs: {ids.join(', ')}
        <div style={{ color: '#333', marginTop: 2 }}>Import a .hol to assign real track IDs</div>
      </div>
    )
  }

  const selected = new Set<number>(trackIds ?? holProject.tracks.map(t => t.id))

  const toggle = (id: number) => {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    onChange(Array.from(next).sort((a, b) => a - b))
  }

  const selectAll  = () => onChange(holProject.tracks.map(t => t.id))
  const selectNone = () => onChange([])

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{
        fontSize: 9, fontWeight: 700, color: '#555', letterSpacing: '0.1em',
        textTransform: 'uppercase', marginBottom: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span>Tracks ({selected.size}/{holProject.tracks.length})</span>
        <span style={{ display: 'flex', gap: 6 }}>
          <span
            onClick={selectAll}
            style={{ cursor: 'pointer', color: '#555', fontSize: 8 }}
            onMouseEnter={e => (e.currentTarget.style.color = '#aaa')}
            onMouseLeave={e => (e.currentTarget.style.color = '#555')}
          >all</span>
          <span
            onClick={selectNone}
            style={{ cursor: 'pointer', color: '#555', fontSize: 8 }}
            onMouseEnter={e => (e.currentTarget.style.color = '#aaa')}
            onMouseLeave={e => (e.currentTarget.style.color = '#555')}
          >none</span>
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 160, overflowY: 'auto' }}>
        {holProject.tracks.map(t => {
          const on = selected.has(t.id)
          const [r, g, b] = t.color
          const hex = `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`
          return (
            <div
              key={t.id}
              onClick={() => toggle(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '3px 6px', borderRadius: 3, cursor: 'pointer',
                background: on ? '#1e1e2e' : 'transparent',
                opacity: on ? 1 : 0.4,
                transition: 'background 0.1s, opacity 0.1s',
              }}
            >
              <div style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: hex,
                boxShadow: on ? `0 0 4px ${hex}` : 'none',
              }} />
              <span style={{ fontSize: 9, color: '#aaa', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.name}
              </span>
              <span style={{ fontSize: 8, color: '#444', fontFamily: 'monospace', flexShrink: 0 }}>
                {t.id}
              </span>
              {(t.azim !== undefined || t.dist !== undefined) && (
                <span style={{ fontSize: 7, color: '#333', fontFamily: 'monospace', flexShrink: 0, marginLeft: 2 }}>
                  {t.azim !== undefined ? `${t.azim.toFixed(0)}°` : ''}
                  {t.dist !== undefined ? ` ${t.dist.toFixed(1)}m` : ''}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── TrackMapSelector ──────────────────────────────────────────────────────────

function TrackMapSelector({
  value, onChange, accent,
}: {
  value: string
  onChange: (v: string) => void
  accent: string
}) {
  const holProject = useGraphStore((s) => s.holProject)

  const toggle = (id: number) => {
    const current = value.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    const set = new Set(current)
    set.has(id) ? set.delete(id) : set.add(id)
    onChange(Array.from(set).sort((a, b) => a - b).join(', '))
  }

  const selected = new Set(
    value.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
  )

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
        Track Remap
      </div>
      <div style={{ fontSize: 9, color: '#555', marginBottom: 4 }}>
        Track IDs to drive (comma-separated, in objectIndex order)
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. 3, 7, 2, 5"
        style={{
          width: '100%', boxSizing: 'border-box',
          background: '#1a1a1a', border: `1px solid ${value ? accent + '66' : '#2a2a2a'}`,
          borderRadius: 4, color: '#ccc', fontSize: 10,
          padding: '4px 8px', fontFamily: 'monospace', outline: 'none',
        }}
      />
      {holProject && holProject.tracks.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 9, color: '#444', marginBottom: 4 }}>
            Pick from .hol tracks (order = objectIndex 0, 1, 2…):
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 140, overflowY: 'auto' }}>
            {holProject.tracks.map(t => {
              const on = selected.has(t.id)
              const [r, g, b] = t.color
              const hex = `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`
              return (
                <div
                  key={t.id}
                  onClick={() => toggle(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '3px 6px', borderRadius: 3, cursor: 'pointer',
                    background: on ? '#1e1e2e' : 'transparent',
                    opacity: on ? 1 : 0.4,
                    transition: 'background 0.1s, opacity 0.1s',
                  }}
                >
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: hex, boxShadow: on ? `0 0 4px ${hex}` : 'none',
                  }} />
                  <span style={{ fontSize: 9, color: '#aaa', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.name}
                  </span>
                  <span style={{ fontSize: 8, color: accent, fontFamily: 'monospace', flexShrink: 0 }}>
                    {t.id}
                  </span>
                  {on && (
                    <span style={{ fontSize: 7, color: '#555', fontFamily: 'monospace', flexShrink: 0 }}>
                      #{Array.from(selected).indexOf(t.id)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
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
        color: '#444', fontSize: 11, fontFamily: 'system-ui,sans-serif', userSelect: 'none',
      }}>
        <span style={{ fontSize: 22, opacity: 0.3 }}>◻</span>
        <span>Select a node</span>
      </div>
    )
  }

  const type = node.type ?? ''
  const data = node.data as Record<string, unknown>
  const desc = getNodeDescriptor(type)

  const set = (key: string, val: unknown) => onChange(node.id, { [key]: val })
  const get = <T,>(key: string, def: T): T =>
    data[key] !== undefined ? (data[key] as T) : def

  if (!desc) {
    return (
      <div style={{ padding: 12, fontSize: 10, color: '#555', fontFamily: 'system-ui,sans-serif' }}>
        <div style={{ color: '#888', marginBottom: 4 }}>Unknown: {type}</div>
        <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#444' }}>{node.id}</div>
      </div>
    )
  }

  const accent = desc.color

  return (
    <div style={{ padding: '0 12px 12px', fontFamily: 'system-ui,sans-serif', overflowY: 'auto', height: '100%' }}>

      {/* ── Header ── */}
      <div style={{
        padding: '10px 0 6px', borderBottom: '1px solid #2a2a2a', marginBottom: 8,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>{desc.icon}</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#ddd' }}>{desc.label}</div>
          <div style={{ fontSize: 9, color: accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>
            {desc.badge ?? desc.category}
          </div>
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 8, color: '#444', fontFamily: 'monospace' }}>{node.id}</span>
      </div>

      {/* ── Ports ── */}
      {(desc.schema.inputs.length > 0 || desc.schema.outputs.length > 0) && (
        <>
          <SectionHead label="Ports" />
          {desc.schema.inputs.map(p => (
            <PortLegend key={p.id} label={p.label} type={p.type} dir="in" />
          ))}
          {desc.schema.outputs.map(p => (
            <PortLegend key={p.id} label={p.label} type={p.type} dir="out" />
          ))}
        </>
      )}

      {/* ── Parameters ── */}
      {desc.params.length > 0 && (
        <>
          <SectionHead label="Parameters" />
          {desc.params.filter(p => !(type === 'trackMap' && p.key === 'trackIds')).map((p) => {
            if (p.type === 'select') {
              return (
                <div key={p.key} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: '#999', marginBottom: 3 }}>{p.label}</div>
                  <select
                    value={get(p.key, p.default as string)}
                    onChange={(e) => set(p.key, e.target.value)}
                    style={{
                      width: '100%', background: '#2a2a2a', border: '1px solid #3a3a3a',
                      borderRadius: 3, color: '#ccc', fontSize: 10, padding: '3px 6px', cursor: 'pointer',
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

              {/* Falloff signal target — only for nodes with in-signal port */}
          {desc.schema.inputs.some(p => p.id === 'in-signal') && (
            <div style={{ marginBottom: 8, paddingTop: 6, borderTop: '1px solid #2a2a2a' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
                Falloff Target
              </div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: '#999', marginBottom: 3 }}>Modulate parameter</div>
                <select
                  value={get('signalTarget', '') as string}
                  onChange={(e) => set('signalTarget', e.target.value)}
                  style={{
                    width: '100%', background: '#2a2a2a', border: '1px solid #3a3a3a',
                    borderRadius: 3, color: '#ccc', fontSize: 10, padding: '3px 6px', cursor: 'pointer',
                  }}
                >
                  <option value="">— none —</option>
                  {desc.params.filter(p => p.type === 'float' || p.type === 'int').map(p => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </div>
              {get('signalTarget', '') !== '' && (
                <>
                  <PropSlider
                    p={{ key: 'signalMin', label: 'Range min', type: 'float', min: -20, max: 20, step: 0.01, default: 0 }}
                    value={get('signalMin', 0) as number}
                    accent="#8b5cf6"
                    onChange={(v) => set('signalMin', v)}
                  />
                  <PropSlider
                    p={{ key: 'signalMax', label: 'Range max', type: 'float', min: -20, max: 20, step: 0.01, default: 1 }}
                    value={get('signalMax', 1) as number}
                    accent="#8b5cf6"
                    onChange={(v) => set('signalMax', v)}
                  />
                </>
              )}
            </div>
          )}

          {/* Duration presets */}
          {type === 'duration' && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
              {[5, 8, 10, 15, 30, 60].map((v) => {
                const cur = get('seconds', 10) as number
                return (
                  <button key={v} onClick={() => set('seconds', v)} style={{
                    padding: '2px 8px', fontSize: 9, borderRadius: 3, border: 'none', cursor: 'pointer',
                    background: cur === v ? accent : '#252525',
                    color: cur === v ? '#fff' : '#666',
                    fontFamily: 'monospace', transition: 'background 0.1s',
                  }}>{v}s</button>
                )
              })}
            </div>
          )}

          {/* Objects — track assignment from .hol */}
          {type === 'objects' && (
            <ObjectsTrackSelector
              count={get('count', 4) as number}
              trackIds={get('trackIds', undefined) as number[] | undefined}
              onChange={(ids) => {
                set('trackIds', ids)
                set('count', ids.length)
              }}
            />
          )}

          {/* TrackMap — track remap via text input or .hol picker */}
          {type === 'trackMap' && (
            <TrackMapSelector
              value={get('trackIds', '') as string}
              onChange={(v) => set('trackIds', v)}
              accent={accent}
            />
          )}
        </>
      )}
    </div>
  )
}
