import { useRef, useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, Sphere, Line } from '@react-three/drei'
import * as THREE from 'three'
import { useTrajectoryStore } from '../store/trajectoryStore'

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
  const { currentTrajectory, isPlaying, currentTime, setCurrentTime, macroControls } = useTrajectoryStore()
  const [positions, setPositions] = useState<Map<number, XYZ>>(new Map())
  const [trails, setTrails]       = useState<Map<number, THREE.Vector3[]>>(new Map())

  // Playback timer
  useEffect(() => {
    if (!currentTrajectory || !isPlaying) return
    const fps = currentTrajectory.fps ?? 60
    const id = setInterval(() => {
      setCurrentTime((prev: number) => {
        const next = prev + 1 / fps
        return next >= currentTrajectory.duration ? 0 : next
      })
    }, 1000 / fps)
    return () => clearInterval(id)
  }, [currentTrajectory, isPlaying, setCurrentTime])

  // Position lookup — nouveau format: frames[objIdx][frameIdx][x,y,z]
  useEffect(() => {
    if (!currentTrajectory?.frames) return

    const fps      = currentTrajectory.fps ?? 60
    const frameIdx = Math.min(
      Math.floor(currentTime * fps),
      (currentTrajectory.frames[0]?.length ?? 1) - 1
    )

    const newPos   = new Map<number, XYZ>()
    const newTrails = new Map<number, THREE.Vector3[]>()

    currentTrajectory.objects.forEach((objId: number, i: number) => {
      const raw = currentTrajectory.frames[i]?.[frameIdx]
      if (!raw) return

      const x = raw[0] * macroControls.scaleX + macroControls.shiftX
      const y = raw[1] * macroControls.scaleY + macroControls.shiftY
      const z = raw[2] * macroControls.scaleZ + macroControls.shiftZ

      newPos.set(objId, [x, y, z])

      const prev = trails.get(objId) ?? []
      const trail = [...prev, new THREE.Vector3(x, y, z)]
      if (trail.length > 120) trail.shift()
      newTrails.set(objId, trail)
    })

    setPositions(newPos)
    setTrails(newTrails)
  }, [currentTrajectory, currentTime, macroControls, trails])

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

      {Array.from(positions.entries()).map(([objId, pos]) => (
        <AudioObject key={objId} position={pos} index={objId} />
      ))}

      {Array.from(trails.entries()).map(([objId, pts]) => {
        const col = new THREE.Color().setHSL((objId * 0.17) % 1, 0.85, 0.6)
        return <TrajectoryPath key={`t-${objId}`} points={pts} color={`#${col.getHexString()}`} />
      })}

      <OrbitControls makeDefault />
    </>
  )
}

// ─── Info overlay ─────────────────────────────────────────────────────────────

function InfoOverlay() {
  const { currentTrajectory, currentTime } = useTrajectoryStore()
  if (!currentTrajectory) return null
  const meta = currentTrajectory._metadata
  return (
    <div className="absolute top-3 left-3 bg-black/60 rounded-lg px-3 py-2 text-xs text-gray-300 space-y-0.5 pointer-events-none">
      <div className="font-semibold text-white">{meta?.engine ?? '—'}</div>
      <div>{meta?.n_objects ?? 0} objects · {currentTrajectory.duration}s · {meta?.n_frames ?? 0} frames</div>
      <div className="text-gray-400">{currentTrajectory.description}</div>
      <div className="text-primary-400 font-mono">{currentTime.toFixed(2)}s</div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function TrajectoryVisualizer() {
  const { currentTrajectory } = useTrajectoryStore()

  return (
    <div className="w-full h-full bg-gray-950 relative">
      {currentTrajectory?.frames ? (
        <>
          <Canvas camera={{ position: [2, 2, 2], fov: 60 }}>
            <Scene />
          </Canvas>
          <InfoOverlay />
        </>
      ) : (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-gray-600">
            <div className="text-5xl mb-3">🔊</div>
            <div className="text-base font-medium text-gray-400">No trajectory loaded</div>
            <div className="text-sm mt-1 text-gray-600">
              Build a graph and click Generate
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
