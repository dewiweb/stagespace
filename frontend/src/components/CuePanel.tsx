// ── CuePanel — Cue list UI (record / go / delete) ─────────────────────────────

import { useState } from 'react'
import { useGraphStore } from '../store/graphStore'
import type { Cue } from '../engine/osc/CueSystem'

interface CuePanelProps {
  onClose?: () => void
}

export default function CuePanel({ onClose }: CuePanelProps) {
  const cueList   = useGraphStore((s) => s.cueList)
  const recordCue = useGraphStore((s) => s.recordCue)
  const goCue     = useGraphStore((s) => s.goCue)
  const deleteCue = useGraphStore((s) => s.deleteCue)

  const [editId,   setEditId]   = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [lastGo,   setLastGo]   = useState<string | null>(null)

  const handleRecord = () => {
    recordCue()
  }

  const handleGo = (id: string) => {
    goCue(id)
    setLastGo(id)
    setTimeout(() => setLastGo(null), 300)
  }

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
        <span style={{ fontSize: 11 }}>◈</span>
        <span style={{ fontWeight: 700, color: '#ccc', flex: 1, letterSpacing: '0.05em' }}>CUES</span>
        <span style={{ color: '#444' }}>{cueList.length}</span>
        {onClose && (
          <div
            onClick={onClose}
            style={{ cursor: 'pointer', color: '#555', padding: '0 2px', userSelect: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#aaa')}
            onMouseLeave={e => (e.currentTarget.style.color = '#555')}
          >×</div>
        )}
      </div>

      {/* Record button */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #1e1e1e' }}>
        <button
          onClick={handleRecord}
          style={{
            width: '100%', padding: '5px 0', borderRadius: 4, border: 'none',
            background: '#1e3a2a', color: '#86efac',
            fontFamily: 'monospace', fontSize: 10, cursor: 'pointer',
            fontWeight: 700, letterSpacing: '0.05em',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#2a4a36')}
          onMouseLeave={e => (e.currentTarget.style.background = '#1e3a2a')}
        >
          ● REC SNAPSHOT
        </button>
      </div>

      {/* Cue list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {cueList.length === 0 && (
          <div style={{ padding: '16px 12px', color: '#333', textAlign: 'center', lineHeight: 1.7 }}>
            No cues yet.<br />
            <span style={{ color: '#2a2a2a' }}>Press REC to snapshot.</span>
          </div>
        )}
        {cueList.map((cue, idx) => (
          <CueRow
            key={cue.id}
            cue={cue}
            index={idx + 1}
            isActive={lastGo === cue.id}
            isEditing={editId === cue.id}
            editName={editName}
            onGo={() => handleGo(cue.id)}
            onDelete={() => deleteCue(cue.id)}
            onStartEdit={() => { setEditId(cue.id); setEditName(cue.name) }}
            onEditChange={setEditName}
            onEditCommit={() => {
              // name editing is local-only for now (CueSystem.update not wired to store yet)
              setEditId(null)
            }}
            onEditCancel={() => setEditId(null)}
          />
        ))}
      </div>

      {/* OSC hint */}
      <div style={{
        padding: '6px 10px', borderTop: '1px solid #1e1e1e',
        color: '#333', lineHeight: 1.5, fontSize: 9,
      }}>
        OSC: <span style={{ color: '#444' }}>/holoflow/cue/go [index]</span>
      </div>
    </div>
  )
}

// ── Cue row ────────────────────────────────────────────────────────────────────

interface CueRowProps {
  cue: Cue
  index: number
  isActive: boolean
  isEditing: boolean
  editName: string
  onGo: () => void
  onDelete: () => void
  onStartEdit: () => void
  onEditChange: (v: string) => void
  onEditCommit: () => void
  onEditCancel: () => void
}

function CueRow({
  cue, index, isActive, isEditing, editName,
  onGo, onDelete, onStartEdit, onEditChange, onEditCommit, onEditCancel,
}: CueRowProps) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 8px',
        background: isActive ? '#1a1a2e' : 'transparent',
        borderBottom: '1px solid #1a1a1a',
        transition: 'background 0.1s',
      }}
    >
      {/* Color dot + index */}
      <div style={{
        width: 18, height: 18, borderRadius: 3, flexShrink: 0,
        background: cue.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 8, fontWeight: 700, color: '#000a',
      }}>
        {index}
      </div>

      {/* Name (editable on dblclick) */}
      {isEditing ? (
        <input
          autoFocus
          value={editName}
          onChange={e => onEditChange(e.target.value)}
          onBlur={onEditCommit}
          onKeyDown={e => {
            if (e.key === 'Enter') onEditCommit()
            if (e.key === 'Escape') onEditCancel()
          }}
          style={{
            flex: 1, background: '#2a2a2a', border: '1px solid #3a3a3a',
            borderRadius: 3, color: '#ccc', fontSize: 10, padding: '1px 4px',
            fontFamily: 'monospace',
          }}
        />
      ) : (
        <span
          onDoubleClick={onStartEdit}
          style={{ flex: 1, color: '#aaa', cursor: 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title="Double-click to rename"
        >
          {cue.name}
        </span>
      )}

      {/* GO button */}
      <button
        onClick={onGo}
        style={{
          padding: '2px 6px', borderRadius: 3, border: 'none',
          background: isActive ? cue.color : '#252525',
          color: isActive ? '#000' : '#666',
          fontFamily: 'monospace', fontSize: 9, cursor: 'pointer',
          fontWeight: 700, flexShrink: 0,
          transition: 'background 0.1s, color 0.1s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = cue.color; e.currentTarget.style.color = '#000' }}
        onMouseLeave={e => {
          e.currentTarget.style.background = isActive ? cue.color : '#252525'
          e.currentTarget.style.color = isActive ? '#000' : '#666'
        }}
      >
        GO
      </button>

      {/* Delete */}
      <div
        onClick={onDelete}
        style={{ cursor: 'pointer', color: '#333', flexShrink: 0, padding: '0 2px', userSelect: 'none' }}
        onMouseEnter={e => (e.currentTarget.style.color = '#c55')}
        onMouseLeave={e => (e.currentTarget.style.color = '#333')}
      >×</div>
    </div>
  )
}
