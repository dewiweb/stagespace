import { useState } from 'react'
import { Radio, Wifi, WifiOff, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'
import { PROFILES } from '../engine/runtime/oscProfiles'

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  panel: {
    height: '100%', display: 'flex', flexDirection: 'column' as const,
    background: '#1a1a1a', color: '#ccc', fontSize: 11,
    fontFamily: 'system-ui, sans-serif', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '0 12px', height: 32, flexShrink: 0,
    borderBottom: '1px solid #2a2a2a', background: '#1d1d1d',
  },
  body: {
    flex: 1, overflowY: 'auto' as const, padding: '10px 12px',
    display: 'flex', flexDirection: 'column' as const, gap: 10,
  },
  section: {
    background: '#222', borderRadius: 5, overflow: 'hidden',
    border: '1px solid #2e2e2e',
  },
  sectionHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '5px 10px', cursor: 'pointer', userSelect: 'none' as const,
    background: '#252525', fontSize: 10, fontWeight: 600,
    color: '#888', textTransform: 'uppercase' as const, letterSpacing: '0.06em',
  },
  sectionBody: {
    padding: '8px 10px', display: 'flex', flexDirection: 'column' as const, gap: 6,
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 6,
  },
  label: {
    width: 72, flexShrink: 0, color: '#666', fontSize: 10,
  },
  input: {
    flex: 1, background: '#2a2a2a', border: '1px solid #3a3a3a',
    borderRadius: 3, color: '#ccc', fontSize: 11, padding: '3px 6px',
    outline: 'none', fontFamily: 'monospace',
  },
  select: {
    flex: 1, background: '#2a2a2a', border: '1px solid #3a3a3a',
    borderRadius: 3, color: '#ccc', fontSize: 11, padding: '3px 6px',
    outline: 'none',
  },
  badge: (ok: boolean) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 600,
    background: ok ? '#1a3a1a' : '#3a1a1a',
    color: ok ? '#4ade80' : '#f87171',
    border: `1px solid ${ok ? '#2a5a2a' : '#5a2a2a'}`,
  }),
  pill: (active: boolean) => ({
    padding: '2px 8px', borderRadius: 10, fontSize: 10, cursor: 'pointer',
    background: active ? '#4b7fbf22' : 'transparent',
    color: active ? '#4b7fbf' : '#555',
    border: `1px solid ${active ? '#4b7fbf55' : '#333'}`,
    userSelect: 'none' as const,
  }),
  monoBig: {
    fontFamily: 'monospace', fontSize: 13, color: '#7ab',
  },
  btn: {
    padding: '3px 10px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
    background: '#2e2e2e', border: '1px solid #3e3e3e', color: '#aaa',
  },
  divider: { height: 1, background: '#2e2e2e', margin: '2px 0' },
}

// ── OSC IN live feed ──────────────────────────────────────────────────────────

function OscInFeed() {
  const msgs = useGraphStore((s) => s.recentOscIn)
  if (msgs.length === 0) {
    return <div style={{ color: '#444', fontSize: 10 }}>No messages received yet</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 130, overflowY: 'auto' }}>
      {msgs.map((m, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, fontFamily: 'monospace', fontSize: 9, lineHeight: 1.4 }}>
          <span style={{ color: '#4b7fbf', flexShrink: 0, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {m.address}
          </span>
          <span style={{ color: '#666', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {m.args.map(a => String(a)).join(' ')}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Collapsible section ───────────────────────────────────────────────────────

function Section({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={S.section}>
      <div style={S.sectionHead} onClick={() => setOpen(v => !v)}>
        <span>{title}</span>
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </div>
      {open && <div style={S.sectionBody}>{children}</div>}
    </div>
  )
}

// ── Editable field row ────────────────────────────────────────────────────────

function FieldRow({ label, value, onChange, type = 'text', monospace = false }: {
  label: string; value: string | number; onChange: (v: string) => void
  type?: string; monospace?: boolean
}) {
  return (
    <div style={S.row}>
      <span style={S.label}>{label}</span>
      <input
        style={{ ...S.input, ...(monospace ? { fontFamily: 'monospace' } : {}) }}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OscPanel() {
  const oscConfig      = useGraphStore(s => s.oscConfig)
  const setOSCConfig   = useGraphStore(s => s.setOSCConfig)
  const bridgeConnected = useGraphStore(s => s.bridgeConnected)
  const isRunning      = useGraphStore(s => s.isRunning)
  const frames         = useGraphStore(s => s.frames)

  // Local draft state so input fields don't fire on every keystroke
  const [draft, setDraft] = useState({ ...oscConfig })

  const commit = () => setOSCConfig(draft)

  const profileNames = Object.keys(PROFILES)

  return (
    <div style={S.panel}>

      {/* ── Header ── */}
      <div style={S.header}>
        <Radio size={11} style={{ color: '#4b7fbf' }} />
        <span style={{ fontWeight: 700, fontSize: 11, color: '#ccc', letterSpacing: '0.05em' }}>OSC</span>

        <div style={{ flex: 1 }} />

        {/* Bridge connection status */}
        <div style={S.badge(bridgeConnected)}>
          {bridgeConnected
            ? <><Wifi size={9} /> Bridge OK</>
            : <><WifiOff size={9} /> No Bridge</>}
        </div>

        {/* Runtime status */}
        {isRunning && (
          <div style={{ ...S.badge(true), background: '#1a2a3a', color: '#60a5fa', border: '1px solid #2a4a6a' }}>
            ▶ {frames.length} src
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div style={S.body}>

        {/* ── OSC OUT ── */}
        <Section title="OSC OUT — Target">
          <FieldRow
            label="Host"
            value={draft.host}
            onChange={v => setDraft(d => ({ ...d, host: v }))}
            monospace
          />
          <FieldRow
            label="Port"
            value={draft.port}
            onChange={v => setDraft(d => ({ ...d, port: +v }))}
            type="number"
          />

          {/* Coordinate system toggle */}
          <div style={S.row}>
            <span style={S.label}>Coord</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['xyz', 'aed'] as const).map(cs => (
                <div
                  key={cs}
                  style={S.pill(draft.coordSystem === cs)}
                  onClick={() => setDraft(d => ({ ...d, coordSystem: cs }))}
                >
                  {cs.toUpperCase()}
                </div>
              ))}
            </div>
          </div>

          {/* Profile selector */}
          <div style={S.row}>
            <span style={S.label}>Profile</span>
            <select
              style={S.select}
              value={draft.profile}
              onChange={e => setDraft(d => ({ ...d, profile: e.target.value }))}
            >
              {profileNames.map(p => (
                <option key={p} value={p}>{PROFILES[p].name}</option>
              ))}
            </select>
          </div>

          {/* Address preview */}
          <div style={{ ...S.row, marginTop: 2 }}>
            <span style={S.label}>Preview</span>
            <span style={{ ...S.monoBig, fontSize: 10 }}>
              {draft.coordSystem === 'xyz'
                ? PROFILES[draft.profile]?.xyzAddress(1) ?? '—'
                : PROFILES[draft.profile]?.aedAddress(1) ?? '—'}
            </span>
          </div>

          <div style={S.divider} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button
              style={S.btn}
              onClick={() => setDraft({ ...oscConfig })}
              title="Discard changes"
            >
              <RotateCcw size={9} style={{ display: 'inline', marginRight: 4 }} />
              Reset
            </button>
            <button
              style={{ ...S.btn, background: '#1e3a5f', color: '#60a5fa', border: '1px solid #2a5a8a' }}
              onClick={commit}
            >
              Apply
            </button>
          </div>
        </Section>

        {/* ── OSC IN ── */}
        <Section title="OSC IN — Listen">
          <FieldRow
            label="UDP Port"
            value={draft.oscInPort}
            onChange={v => setDraft(d => ({ ...d, oscInPort: +v }))}
            type="number"
          />
          <div style={{ color: '#555', fontSize: 10, lineHeight: 1.5 }}>
            Le bridge écoute sur ce port UDP.<br />
            Les messages reçus sont routés vers les macros<br />
            et les cues via l'OscRouter.
          </div>
          <div style={S.divider} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              style={{ ...S.btn, background: '#1e3a5f', color: '#60a5fa', border: '1px solid #2a5a8a' }}
              onClick={commit}
            >
              Apply
            </button>
          </div>
        </Section>

        {/* ── Live feed ── */}
        <Section title="Live" defaultOpen={true}>
          {frames.length === 0 ? (
            <div style={{ color: '#444', fontSize: 10 }}>No frames — runtime stopped</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 140, overflowY: 'auto' }}>
              {frames.slice(0, 12).map(f => (
                <div key={f.trackId} style={{ display: 'flex', gap: 8, fontFamily: 'monospace', fontSize: 10 }}>
                  <span style={{ color: '#555', width: 36 }}>trk {f.trackId}</span>
                  <span style={{ color: '#7ab' }}>
                    {f.position.x.toFixed(3)}
                  </span>
                  <span style={{ color: '#a7b' }}>
                    {f.position.y.toFixed(3)}
                  </span>
                  <span style={{ color: '#ab7' }}>
                    {f.position.z.toFixed(3)}
                  </span>
                </div>
              ))}
              {frames.length > 12 && (
                <div style={{ color: '#444', fontSize: 10 }}>+{frames.length - 12} more…</div>
              )}
            </div>
          )}
        </Section>

        {/* ── OSC IN feed ── */}
        <Section title="OSC IN feed" defaultOpen={false}>
          <OscInFeed />
        </Section>

        {/* ── Bridge info ── */}
        <Section title="Bridge" defaultOpen={false}>
          <div style={{ color: '#555', fontSize: 10, lineHeight: 1.8 }}>
            <div><span style={{ color: '#666' }}>WebSocket  </span><span style={{ fontFamily: 'monospace', color: '#7ab' }}>ws://localhost:8765</span></div>
            <div><span style={{ color: '#666' }}>OSC OUT →  </span><span style={{ fontFamily: 'monospace', color: '#7ab' }}>{oscConfig.host}:{oscConfig.port}</span></div>
            <div><span style={{ color: '#666' }}>OSC IN  ←  </span><span style={{ fontFamily: 'monospace', color: '#7ab' }}>UDP :{oscConfig.oscInPort}</span></div>
          </div>
          <div style={S.divider} />
          <div style={{ color: '#444', fontSize: 10 }}>
            Démarrer : <span style={{ fontFamily: 'monospace', color: '#555' }}>./start.sh</span><br />
            ou <span style={{ fontFamily: 'monospace', color: '#555' }}>OSC_HOST=x.x.x.x ./start.sh</span>
          </div>
        </Section>

      </div>
    </div>
  )
}
