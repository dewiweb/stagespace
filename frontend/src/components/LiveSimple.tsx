/**
 * LiveSimple — Interface minimaliste pour performance live
 * 
 * Design principles:
 * - Un seul écran, pas de mode Editor/Live
 * - Sélection moteur en 1 clic (grille de boutons)
 * - Play/Stop global + sliders macro
 * - Visualisation 3D des objets
 * - Gestion de patch (objets + groupes)
 * - Feedback visuel immédiat
 */

import { useState, useEffect, useCallback } from 'react'
import { Play, Square, Sliders, Zap, Save, FolderOpen, Music, Users, Layers } from 'lucide-react'
import LiveVisualizer from './LiveVisualizer'

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
  
  // Patch state
  const [objects, setObjects] = useState<any[]>([])
  const [groups, setGroups] = useState<any[]>({})
  const [selectedObjects, setSelectedObjects] = useState<number[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [showPatchPanel, setShowPatchPanel] = useState(false)
  const [showCreateObject, setShowCreateObject] = useState(false)
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [newObjectName, setNewObjectName] = useState('')
  const [newObjectColor, setNewObjectColor] = useState('#ffffff')
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupEngine, setNewGroupEngine] = useState('circular')

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

  // Load patch from backend
  const loadPatch = useCallback(async () => {
    try {
      const patch = await api('GET', '/api/patch')
      setObjects(patch.objects || [])
      setGroups(patch.groups || {})
    } catch (e) {
      console.error('Failed to load patch:', e)
    }
  }, [])

  // Load patch on mount
  useEffect(() => {
    loadPatch()
  }, [loadPatch])

  // Play selected group
  const handlePlayGroup = useCallback(async (groupName: string) => {
    if (playing) {
      await api('POST', '/api/stop')
      setPlaying(false)
      setSessionId(null)
    }
    try {
      const res = await api('POST', `/api/patch/groups/${groupName}/play`, {
        host: '127.0.0.1',
        port: 7788,
        fps: 60,
      })
      console.log('Play group response:', res)
      if (res.session_id) {
        setSessionId(res.session_id)
        setPlaying(true)
        setSelectedGroup(groupName)
      } else {
        console.error('No session_id in response')
      }
    } catch (e) {
      console.error('Failed to play group:', e)
    }
  }, [playing])

  // Create object
  const handleCreateObject = useCallback(async () => {
    if (!newObjectName.trim()) return
    try {
      const oscId = objects.length > 0 ? Math.max(...objects.map((o: any) => o.osc_id)) + 1 : 1
      await api('PUT', `/api/patch/objects/${oscId}`, {
        name: newObjectName.trim(),
        color: newObjectColor,
        notes: '',
      })
      setNewObjectName('')
      setNewObjectColor('#ffffff')
      setShowCreateObject(false)
      await loadPatch()
    } catch (e) {
      console.error('Failed to create object:', e)
    }
  }, [newObjectName, newObjectColor, objects, loadPatch])

  // Create group
  const handleCreateGroup = useCallback(async () => {
    if (!newGroupName.trim() || selectedObjects.length === 0) return
    try {
      await api('PUT', `/api/patch/groups/${newGroupName.trim()}`, {
        object_ids: selectedObjects,
        engine: newGroupEngine,
        params: {},
        profile: currentProfile,
        color: '#4b7fbf',
        anchor: { x: 0, y: 0, z: 0 },
      })
      setNewGroupName('')
      setNewGroupEngine('circular')
      setSelectedObjects([])
      setShowCreateGroup(false)
      await loadPatch()
    } catch (e) {
      console.error('Failed to create group:', e)
    }
  }, [newGroupName, selectedObjects, newGroupEngine, currentProfile, loadPatch])

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
            onClick={() => setShowPatchPanel(v => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12 16',
              background: showPatchPanel ? '#4b7fbf' : '#1a1a1a',
              color: showPatchPanel ? '#fff' : '#888',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            title="Patch (objets + groupes)"
          >
            <Users size={18} />
            <span>Patch</span>
          </button>

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
        {/* Left Panel - Engine Selection + 3D */}
        <div style={{
          flex: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          minHeight: 0,
        }}>
          {/* 3D Visualizer */}
          <div style={{
            flex: 1,
            background: '#111',
            borderRadius: 8,
            border: '1px solid #222',
            overflow: 'hidden',
            position: 'relative',
          }}>
            <LiveVisualizer />
          </div>

          {/* Engine Selection */}
          <div style={{
            height: 200,
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
                    padding: 12,
                    background: currentEngine === eng.id ? eng.color : '#1a1a1a',
                    color: currentEngine === eng.id ? '#fff' : '#888',
                    border: currentEngine === eng.id ? 'none' : '1px solid #333',
                    borderRadius: 6,
                    fontSize: 11,
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
        </div>

        {/* Right Panel - Macro + Patch */}
        <div style={{
          width: 320,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          minHeight: 0,
        }}>
          {/* Macro Controls */}
          <div style={{
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

          {/* Patch Panel (collapsible) */}
          {showPatchPanel && (
            <div style={{
              flex: 1,
              background: '#111',
              borderRadius: 8,
              border: '1px solid #222',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              overflow: 'auto',
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                Groups
                <button
                  onClick={() => setShowCreateGroup(true)}
                  style={{
                    padding: '4 8',
                    background: '#1a1a1a',
                    color: '#4b7fbf',
                    border: '1px solid #333',
                    borderRadius: 4,
                    fontSize: 10,
                    cursor: 'pointer',
                  }}
                >
                  + New
                </button>
              </div>
              {Object.keys(groups).length === 0 ? (
                <div style={{ fontSize: 11, color: '#666', fontStyle: 'italic' }}>
                  No groups defined. Select objects and create a group.
                </div>
              ) : (
                Object.entries(groups).map(([name, group]: [string, any]) => (
                  <button
                    key={name}
                    onClick={() => handlePlayGroup(name)}
                    style={{
                      padding: 12,
                      background: selectedGroup === name ? '#4b7fbf' : '#1a1a1a',
                      color: selectedGroup === name ? '#fff' : '#888',
                      border: selectedGroup === name ? 'none' : '1px solid #333',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{name}</div>
                    <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
                      {group.object_ids?.length || 0} objects • {group.engine}
                    </div>
                  </button>
                ))
              )}

              <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                Objects
                <button
                  onClick={() => setShowCreateObject(true)}
                  style={{
                    padding: '4 8',
                    background: '#1a1a1a',
                    color: '#4b7fbf',
                    border: '1px solid #333',
                    borderRadius: 4,
                    fontSize: 10,
                    cursor: 'pointer',
                  }}
                >
                  + New
                </button>
              </div>
              {objects.length === 0 ? (
                <div style={{ fontSize: 11, color: '#666', fontStyle: 'italic' }}>
                  No objects defined. Create objects manually or import from OSC.
                </div>
              ) : (
                objects.map((obj: any) => (
                  <div
                    key={obj.osc_id}
                    onClick={() => {
                      if (selectedObjects.includes(obj.osc_id)) {
                        setSelectedObjects(selectedObjects.filter(id => id !== obj.osc_id))
                      } else {
                        setSelectedObjects([...selectedObjects, obj.osc_id])
                      }
                    }}
                    style={{
                      padding: 8,
                      background: selectedObjects.includes(obj.osc_id) ? '#1a1a1a' : 'transparent',
                      border: selectedObjects.includes(obj.osc_id) ? '1px solid #4b7fbf' : '1px solid #333',
                      borderRadius: 4,
                      fontSize: 11,
                      color: '#888',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>{obj.name || `Object ${obj.osc_id}`}</div>
                    <div style={{ fontSize: 10, color: '#666' }}>ID: {obj.osc_id}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create Object Modal */}
      {showCreateObject && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          backdropFilter: 'blur(4px)',
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{
            background: '#111',
            border: '1px solid #333',
            borderRadius: 8,
            padding: 24,
            width: 320,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Create Object</div>
            <div>
              <label style={{ fontSize: 12, color: '#888', marginBottom: 4, display: 'block' }}>Name</label>
              <input
                type="text"
                value={newObjectName}
                onChange={(e) => setNewObjectName(e.target.value)}
                style={{
                  width: '100%',
                  padding: 8,
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: 4,
                  color: '#ccc',
                  fontSize: 13,
                }}
                placeholder="Object name"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#888', marginBottom: 4, display: 'block' }}>Color</label>
              <input
                type="color"
                value={newObjectColor}
                onChange={(e) => setNewObjectColor(e.target.value)}
                style={{
                  width: '100%',
                  height: 40,
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={() => setShowCreateObject(false)}
                style={{
                  flex: 1,
                  padding: 10,
                  background: '#1a1a1a',
                  color: '#888',
                  border: '1px solid #333',
                  borderRadius: 4,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateObject}
                style={{
                  flex: 1,
                  padding: 10,
                  background: '#4b7fbf',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Group Modal */}
      {showCreateGroup && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          backdropFilter: 'blur(4px)',
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{
            background: '#111',
            border: '1px solid #333',
            borderRadius: 8,
            padding: 24,
            width: 320,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Create Group</div>
            <div>
              <label style={{ fontSize: 12, color: '#888', marginBottom: 4, display: 'block' }}>Name</label>
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                style={{
                  width: '100%',
                  padding: 8,
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: 4,
                  color: '#ccc',
                  fontSize: 13,
                }}
                placeholder="Group name"
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#888', marginBottom: 4, display: 'block' }}>Engine</label>
              <select
                value={newGroupEngine}
                onChange={(e) => setNewGroupEngine(e.target.value)}
                style={{
                  width: '100%',
                  padding: 8,
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: 4,
                  color: '#ccc',
                  fontSize: 13,
                }}
              >
                {ENGINES.map(eng => (
                  <option key={eng.id} value={eng.id}>{eng.label}</option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: 11, color: '#666' }}>
              Selected objects: {selectedObjects.length}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={() => setShowCreateGroup(false)}
                style={{
                  flex: 1,
                  padding: 10,
                  background: '#1a1a1a',
                  color: '#888',
                  border: '1px solid #333',
                  borderRadius: 4,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateGroup}
                disabled={selectedObjects.length === 0}
                style={{
                  flex: 1,
                  padding: 10,
                  background: selectedObjects.length > 0 ? '#4b7fbf' : '#333',
                  color: selectedObjects.length > 0 ? '#fff' : '#666',
                  border: 'none',
                  borderRadius: 4,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: selectedObjects.length > 0 ? 'pointer' : 'not-allowed',
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

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