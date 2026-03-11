import { useRef, useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, Sphere, Line, Text } from '@react-three/drei'
import * as THREE from 'three'
import { useGraphStore } from '../store/graphStore'
import type { HolTrack } from '../engine/hol/HolParser'

// ─── Types ────────────────────────────────────────────────────────────────────

type XYZ = [number, number, number]

/**
 * Audio spatial → Three.js coordinate mapping
 * Audio: X=right, Y=depth(forward), Z=up
 * Three.js: X=right, Y=up, Z=toward camera
 * Result: (x, z, -y)
 */
function toThree(x: number, y: number, z: number): XYZ {
  return [x, z, -y]
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AudioObject({ position, index, size }: { position: XYZ; index: number; size: number }) {
  const meshRef = useRef<THREE.Mesh>(null)
  useFrame(() => {
    if (meshRef.current) meshRef.current.rotation.y += 0.01
  })
  const color = new THREE.Color().setHSL((index * 0.17) % 1, 0.85, 0.6)
  return (
    <Sphere ref={meshRef} args={[size, 16, 16]} position={position}>
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
    </Sphere>
  )
}

function computeSceneScale(holProject: { tracks: { dist?: number }[] } | null, frames: { position: { x: number; y: number; z: number } }[]): number {
  if (holProject && holProject.tracks.length > 0) {
    const maxDist = Math.max(...holProject.tracks.map(t => t.dist ?? 1), 1)
    return Math.ceil(maxDist / 5) * 5
  }
  if (frames.length > 0) {
    const maxPos = Math.max(...frames.flatMap(f => [Math.abs(f.position.x), Math.abs(f.position.y), Math.abs(f.position.z)]), 1)
    return Math.ceil(maxPos / 2) * 2
  }
  return 5
}

function TrajectoryPath({ points, color }: { points: THREE.Vector3[]; color: string }) {
  if (points.length < 2) return null
  return <Line points={points} color={color} lineWidth={2} opacity={0.5} transparent />
}

// ─── Scene ────────────────────────────────────────────────────────────────────

// ─── AED → XYZ (Holophonix convention) ───────────────────────────────────────
// azim=0 → front (Y+), azim=90 → right (X+), elev=0 → horizontal

function aedToXyz(azimDeg: number, elevDeg: number, dist: number): [number, number, number] {
  const a = (azimDeg * Math.PI) / 180
  const e = (elevDeg * Math.PI) / 180
  const x = dist * Math.cos(e) * Math.sin(a)
  const y = dist * Math.cos(e) * Math.cos(a)
  const z = dist * Math.sin(e)
  return [x, y, z]
}

// ─── Hol track marker (at real position from .hol) ────────────────────────────

function HolMarker({ track, sceneScale }: { track: HolTrack; sceneScale: number }) {
  const [r, g, b] = track.color
  const hex = `#${Math.round(r*255).toString(16).padStart(2,'0')}${Math.round(g*255).toString(16).padStart(2,'0')}${Math.round(b*255).toString(16).padStart(2,'0')}`

  // Convert AED to XYZ, then remap to Three.js coords
  const [ax, ay, az] = (track.azim !== undefined && track.dist !== undefined)
    ? aedToXyz(track.azim, track.elev ?? 0, track.dist)
    : [0, 0, 0]
  const pos = toThree(ax, ay, az)

  return (
    <group position={pos}>
      <Sphere args={[Math.max(0.03, sceneScale * 0.006), 10, 10]}>
        <meshStandardMaterial color={hex} emissive={hex} emissiveIntensity={0.8} transparent opacity={0.6} />
      </Sphere>
      <Text
        position={[sceneScale * 0.012, sceneScale * 0.012, 0]}
        fontSize={sceneScale * 0.012}
        color={hex}
        anchorX="left"
        anchorY="middle"
      >
        {track.name || `trk ${track.id}`}
      </Text>
    </group>
  )
}

function Scene({ sceneScale }: { sceneScale: number }) {
  const frames        = useGraphStore((s) => s.frames)
  const holProject    = useGraphStore((s) => s.holProject)
  const [trails, setTrails] = useState<Map<number, THREE.Vector3[]>>(new Map())

  useEffect(() => {
    if (frames.length === 0) { setTrails(new Map()); return }
    setTrails(prev => {
      const next = new Map(prev)
      for (const f of frames) {
        const { x, y, z } = f.position
        const [tx, ty, tz] = toThree(x, y, z)
        const trail = [...(next.get(f.trackId) ?? []), new THREE.Vector3(tx, ty, tz)]
        if (trail.length > 120) trail.shift()
        next.set(f.trackId, trail)
      }
      return next
    })
  }, [frames])

  const gridSize  = sceneScale * 2
  const cellSize  = sceneScale <= 5 ? 0.5 : sceneScale <= 15 ? 1 : 2
  const axisLen   = sceneScale
  const labelOff  = sceneScale + 0.5

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[sceneScale, sceneScale, sceneScale]} intensity={1} />
      <pointLight position={[-sceneScale, -sceneScale, -sceneScale]} intensity={0.5} />

      <Grid
        args={[gridSize, gridSize]}
        cellSize={cellSize}
        cellThickness={0.5}
        cellColor="#2a2a2a"
        sectionSize={cellSize * 5}
        sectionThickness={1}
        sectionColor="#444444"
        fadeDistance={sceneScale * 4}
        fadeStrength={1}
        followCamera={false}
      />

      {/* Axis lines */}
      <Line points={[[0,0,0],[axisLen,0,0]]} color="#e55" lineWidth={1.5} />
      <Line points={[[0,0,0],[0,0,-axisLen]]} color="#5e5" lineWidth={1.5} />
      <Line points={[[0,0,0],[0,axisLen,0]]} color="#55e" lineWidth={1.5} />
      <Text position={[labelOff, 0, 0]}   fontSize={axisLen*0.07} color="#e55" anchorX="left">X</Text>
      <Text position={[0, 0, -labelOff]}  fontSize={axisLen*0.07} color="#5e5" anchorX="center">Y</Text>
      <Text position={[0, labelOff, 0]}   fontSize={axisLen*0.07} color="#55e" anchorX="center">Z</Text>

      {/* .hol track markers — always visible as ghost when project loaded */}
      {holProject && holProject.tracks
        .filter(t => t.visible)
        .map(t => <HolMarker key={t.id} track={t} sceneScale={sceneScale} />)
      }

      {/* Live animated objects */}
      {frames.map((f) => (
        <AudioObject
          key={f.trackId}
          position={toThree(f.position.x, f.position.y, f.position.z)}
          index={f.trackId}
          size={Math.max(0.04, sceneScale * 0.007)}
        />
      ))}

      {Array.from(trails.entries()).map(([trackId, pts]) => {
        const col = new THREE.Color().setHSL((trackId * 0.17) % 1, 0.85, 0.6)
        return <TrajectoryPath key={`t-${trackId}`} points={pts} color={`#${col.getHexString()}`} />
      })}

      <OrbitControls makeDefault />
    </>
  )
}

// ─── Info overlay ─────────────────────────────────────────────────────────────

function InfoOverlay({ sceneScale }: { sceneScale: number }) {
  const currentT      = useGraphStore((s) => s.currentT)
  const compileResult = useGraphStore((s) => s.compileResult)
  const isRunning     = useGraphStore((s) => s.isRunning)
  const holProject    = useGraphStore((s) => s.holProject)
  return (
    <div style={{
      position: 'absolute', top: 10, left: 10,
      background: 'rgba(0,0,0,0.6)', borderRadius: 6,
      padding: '6px 10px', fontSize: 10, color: '#ccc',
      pointerEvents: 'none', fontFamily: 'monospace',
      lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 1,
    }}>
      {compileResult?.success ? (
        <>
          <div style={{ fontWeight: 700, color: isRunning ? '#4ade80' : '#888', marginBottom: 1 }}>
            {isRunning ? '● LIVE' : '○ paused'}
          </div>
          <div>{compileResult.objectCount} obj · {compileResult.duration}s</div>
          <div style={{ color: '#6af' }}>{currentT.toFixed(3)}s</div>
        </>
      ) : (
        <div style={{ color: '#555' }}>no graph</div>
      )}
      {holProject && (
        <div style={{ marginTop: 3, paddingTop: 3, borderTop: '1px solid #333', color: '#555' }}>
          <span style={{ color: '#888' }}>{holProject.presetName}</span>
          {' · '}{holProject.tracks.filter(t => t.visible).length} trk
        </div>
      )}
      <div style={{ marginTop: 3, paddingTop: 3, borderTop: '1px solid #222', color: '#333', fontSize: 8 }}>
        scale {sceneScale}m
      </div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function TrajectoryVisualizer() {
  const compileResult = useGraphStore((s) => s.compileResult)
  const holProject    = useGraphStore((s) => s.holProject)
  const frames        = useGraphStore((s) => s.frames)
  // Show 3D canvas if graph compiled OR if a .hol project is loaded
  const show3D = compileResult?.success === true || holProject !== null

  const sceneScale = computeSceneScale(holProject, frames)
  const camDist    = sceneScale * 1.6

  return (
    <div style={{ width: '100%', height: '100%', background: '#0a0a0a', position: 'relative' }}>
      {show3D ? (
        <>
          <Canvas camera={{ position: [camDist * 0.6, camDist * 0.6, camDist * 0.6], fov: 60 }}>
            <Scene sceneScale={sceneScale} />
          </Canvas>
          <InfoOverlay sceneScale={sceneScale} />
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <div style={{ textAlign: 'center', color: '#555' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>◎</div>
            <div style={{ fontSize: 12, color: '#666' }}>Build a graph to start</div>
            <div style={{ fontSize: 10, color: '#444', marginTop: 4 }}>or import a .hol project</div>
          </div>
        </div>
      )}
    </div>
  )
}
