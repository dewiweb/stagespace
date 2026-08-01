import { useRef, useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, Sphere } from '@react-three/drei'
import * as THREE from 'three'

const API = 'http://localhost:8080'

type XYZ = [number, number, number]

function AudioObject({ position, color, size, name }: { position: XYZ; color: string; size: number; name: string }) {
  const meshRef = useRef<THREE.Mesh>(null)
  useFrame(() => {
    if (meshRef.current) meshRef.current.rotation.y += 0.01
  })
  return (
    <group position={position}>
      <Sphere ref={meshRef} args={[size, 16, 16]}>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </Sphere>
      {/* Label */}
      <mesh position={[0, size + 0.1, 0]}>
        <planeGeometry args={[0.5, 0.15]} />
        <meshBasicMaterial color="#fff" transparent opacity={0.8} />
      </mesh>
    </group>
  )
}

function Scene({ objects }: { objects: any[] }) {
  return (
    <>
      <Grid args={[10, 10]} cellSize={1} cellThickness={0.5} cellColor="#333" sectionSize={5} sectionThickness={1} sectionColor="#444" />
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      {objects.map((obj, index) => {
        // Positions en cercle pour l'instant
        const angle = (index / objects.length) * Math.PI * 2
        const radius = 2
        const x = Math.cos(angle) * radius
        const z = Math.sin(angle) * radius
        return (
          <AudioObject
            key={obj.osc_id}
            position={[x, 0, z]}
            color={obj.color}
            size={0.15}
            name={obj.name}
          />
        )
      })}
    </>
  )
}

export default function LiveVisualizer() {
  const [objects, setObjects] = useState<any[]>([])
  const [positions, setPositions] = useState<Map<number, XYZ>>(new Map())

  useEffect(() => {
    // Charger les objets depuis le backend
    const loadPatch = async () => {
      try {
        const res = await fetch(`${API}/api/patch`)
        const data = await res.json()
        setObjects(data.objects || [])
      } catch (err) {
        console.error('Failed to load patch:', err)
      }
    }

    loadPatch()

    // Polling pour les positions (simplifié)
    const interval = setInterval(async () => {
      // Pour l'instant, positions statiques
      // TODO: ajouter endpoint WebSocket pour positions temps réel
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Canvas camera={{ position: [0, 5, 5], fov: 50 }}>
        <OrbitControls />
        <Scene objects={objects} />
      </Canvas>
    </div>
  )
}
