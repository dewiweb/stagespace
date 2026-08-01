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

function Scene({ objects, positions }: { objects: any[]; positions: Map<number, XYZ> }) {
  return (
    <>
      <Grid args={[10, 10]} cellSize={1} cellThickness={0.5} cellColor="#333" sectionSize={5} sectionThickness={1} sectionColor="#444" />
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      {objects.map((obj, index) => {
        // Utiliser les positions du WebSocket si disponibles, sinon cercle statique
        const pos = positions.get(obj.osc_id)
        let x, z
        if (pos) {
          x = pos[0]
          z = pos[2]
        } else {
          // Positions en cercle par défaut
          const angle = (index / objects.length) * Math.PI * 2
          const radius = 2
          x = Math.cos(angle) * radius
          z = Math.sin(angle) * radius
        }
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
  const wsRef = useRef<WebSocket | null>(null)

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

    // Connecter au WebSocket pour les positions temps réel
    const ws = new WebSocket('ws://localhost:8080/ws/positions')
    wsRef.current = ws

    ws.onopen = () => {
      console.log('WebSocket connected')
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('WebSocket message:', data)
        if (data.positions) {
          const posMap = new Map<number, XYZ>()
          for (const [sessionId, sessionData]: any of Object.entries(data.positions)) {
            const sessionObjects = sessionData.objects
            if (sessionObjects) {
              for (const [oscId, pos]: any of Object.entries(sessionObjects)) {
                posMap.set(parseInt(oscId), [pos.x, pos.y, pos.z])
              }
            }
          }
          setPositions(posMap)
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e)
      }
    }

    ws.onerror = (err) => {
      console.error('WebSocket error:', err)
    }

    ws.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason)
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Canvas camera={{ position: [0, 5, 5], fov: 50 }}>
        <OrbitControls />
        <Scene objects={objects} positions={positions} />
      </Canvas>
    </div>
  )
}
