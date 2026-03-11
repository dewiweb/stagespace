import { useRef, useState } from 'react'
import { FolderOpen, CheckCircle, AlertCircle, X } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'

export default function HolImport({ onClose }: { onClose?: () => void }) {
  const importHol   = useGraphStore((s) => s.importHol)
  const holProject  = useGraphStore((s) => s.holProject)
  const inputRef    = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleFile(file: File) {
    if (!file.name.endsWith('.hol')) {
      setStatus('error')
      setErrorMsg('File must be a .hol archive')
      return
    }
    setStatus('loading')
    setErrorMsg('')
    const r = await importHol(file)
    if (r.success) {
      setStatus('ok')
    } else {
      setStatus('error')
      setErrorMsg(r.error ?? 'Unknown error')
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const trackDot = (color: [number, number, number, number]): React.CSSProperties => ({
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
    background: `rgba(${Math.round(color[0]*255)},${Math.round(color[1]*255)},${Math.round(color[2]*255)},1)`,
  })

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div style={{ background: '#1d1d1d', border: '1px solid #333', borderRadius: 8, width: 360, padding: '16px 20px', fontFamily: 'system-ui,sans-serif' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#ddd', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Import .hol</span>
          {onClose && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: 0 }}>
              <X size={14} />
            </button>
          )}
        </div>

        {/* Drop zone */}
        {status !== 'ok' && (
          <div
            style={{ border: '1px dashed #444', borderRadius: 6, padding: '20px 12px', textAlign: 'center', cursor: 'pointer', fontSize: 11, color: '#666' }}
            onClick={() => inputRef.current?.click()}
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#888')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#444')}
          >
            <FolderOpen size={20} style={{ color: '#555', marginBottom: 6 }} />
            <div>Drop a <code style={{ color: '#aaa' }}>.hol</code> file or click to browse</div>
            <input ref={inputRef} type="file" accept=".hol" style={{ display: 'none' }} onChange={onInputChange} />
          </div>
        )}

        {status === 'loading' && (
          <div style={{ fontSize: 10, color: '#aaa', marginTop: 8 }}>Parsing…</div>
        )}
        {status === 'error' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#e55', marginTop: 8 }}>
            <AlertCircle size={12} />{errorMsg}
          </div>
        )}

        {/* Success summary */}
        {status === 'ok' && holProject && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#5a9', marginBottom: 10 }}>
              <CheckCircle size={12} />
              <span><strong style={{ color: '#ddd' }}>{holProject.presetName}</strong> · v{holProject.version}</span>
            </div>
            <div style={{ maxHeight: 180, overflowY: 'auto', borderTop: '1px solid #2a2a2a', paddingTop: 8 }}>
              {holProject.tracks.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 10, color: '#ccc', opacity: t.visible ? 1 : 0.4 }}>
                  <span style={{ fontFamily: 'monospace', color: '#555', width: 22 }}>{t.id}</span>
                  <span style={trackDot(t.color)} />
                  <span>{t.name}</span>
                  {!t.visible && <span style={{ color: '#555', marginLeft: 'auto' }}>hidden</span>}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 9, color: '#555' }}>
              Object count updated to {holProject.tracks.filter(tr => tr.visible).length || holProject.tracks.length}
            </div>
            <button
              onClick={onClose}
              style={{ marginTop: 10, width: '100%', padding: '6px 0', background: '#22c55e22', border: '1px solid #22c55e44', borderRadius: 4, color: '#22c55e', fontSize: 11, cursor: 'pointer' }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
