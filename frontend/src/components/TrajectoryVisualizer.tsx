import { useRef, useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, Sphere, Line } from '@react-three/drei'
import * as THREE from 'three'
import { useGraphStore } from '../store/graphStore'

// ─── Types ────────────────────────────────────────────────────────────────────

type XYZ = [number, number, number]

// ─── Sub-components ───────────────────────────────────────────────────────────

function AudioObject({ position, index }: { position: XYZ; index: number }) {
  const meshRef = useRef<THREE.Mesh>(null)
  useFrame(() => {
    if (meshRef.current) meshRef.current.rotation.y += 0.01
  })
  const color = new THREE.Color().setHSL((index * 0.17) % 1, 0.85, 0.6)
  return (
    <Sphere ref={meshRef} args={[0.05, 16, 16]} position={position}>
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
    </Sphere>
  )
}

function TrajectoryPath({ points, color }: { points: THREE.Vector3[]; color: string }) {
  if (points.length < 2) return null
  return <Line points={points} color={color} lineWidth={2} opacity={0.5} transparent />
}

// ─── Scene ────────────────────────────────────────────────────────────────────

function Scene() {
  const frames        = useGraphStore((s) => s.frames)
  const [trails, setTrails] = useState<Map<number, THREE.Vector3[]>>(new Map())

  useEffect(() => {
    if (frames.length === 0) return
    setTrails(prev => {
      const next = new Map(prev)
      for (const f of frames) {
        const { x, y, z } = f.position
        const trail = [...(next.get(f.trackId) ?? []), new THREE.Vector3(x, y, z)]
        if (trail.length > 120) trail.shift()
        next.set(f.trackId, trail)
      }
      return next
    })
  }, [frames])

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      <pointLight position={[-10, -10, -10]} intensity={0.5} />

      <Grid
        args={[4, 4]}
        cellSize={0.25}
        cellThickness={0.5}
        cellColor="#333333"
        sectionSize={1}
        sectionThickness={1}
        sectionColor="#555555"
        fadeDistance={20}
        fadeStrength={1}
        followCamera={false}
      />

      {frames.map((f) => (
        <AudioObject
          key={f.trackId}
          position={[f.position.x, f.position.y, f.position.z]}
          index={f.trackId}
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

function InfoOverlay() {
  const currentT      = useGraphStore((s) => s.currentT)
  const compileResult = useGraphStore((s) => s.compileResult)
  const isRunning     = useGraphStore((s) => s.isRunning)
  if (!compileResult?.success) return null
  return (
    <div style={{
      position: 'absolute', top: 10, left: 10,
      background: 'rgba(0,0,0,0.6)', borderRadius: 6,
      padding: '6px 10px', fontSize: 10, color: '#ccc',
      pointerEvents: 'none', fontFamily: 'monospace',
      lineHeight: 1.6,
    }}>
      <div style={{ fontWeight: 700, color: '#fff', marginBottom: 2 }}>
        {isRunning ? '● LIVE' : '○ paused'}
      </div>
      <div>{compileResult.objectCount} obj · {compileResult.duration}s</div>
      <div style={{ color: '#6af' }}>{currentT.toFixed(3)}s</div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function TrajectoryVisualizer() {
  const compileResult = useGraphStore((s) => s.compileResult)
  const hasTrajectory = compileResult?.success === true

  return (
    <div style={{ width: '100%', height: '100%', background: '#0a0a0a', position: 'relative' }}>
      {hasTrajectory ? (
        <>
          <Canvas camera={{ position: [2, 2, 2], fov: 60 }}>
            <Scene />
          </Canvas>
          <InfoOverlay />
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <div style={{ textAlign: 'center', color: '#555' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>◎</div>
            <div style={{ fontSize: 12, color: '#666' }}>Build a graph to start</div>
          </div>
        </div>
      )}
    </div>
  )
}
