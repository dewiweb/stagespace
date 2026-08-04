import { useEffect, useState, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid, Sphere } from '@react-three/drei'

const API = 'http://localhost:8080'

type XYZ = [number, number, number]

function AudioObject({ position, color, size }: { position: XYZ; color: string; size: number }) {
  return (
    <Sphere args={[size, 16, 16]} position={position}>
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
    </Sphere>
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
        let x, y, z
        if (pos) {
          x = pos[0]
          y = pos[1]
          z = pos[2]
        } else {
          // Positions en cercle par défaut
          const angle = (index / objects.length) * Math.PI * 2
          const radius = 2
          x = Math.cos(angle) * radius
          y = 0
          z = Math.sin(angle) * radius
        }
        return (
          <AudioObject
            key={obj.osc_id}
            position={[x, y, z]}
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

    // Polling pour les positions via REST
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/sessions`)
        const data = await res.json()
        if (data.sessions && data.sessions.length > 0) {
          const session = data.sessions[0]
          const res2 = await fetch(`${API}/api/sessions/${session.id}/frame`)
          const posData = await res2.json()
          if (posData.objects) {
            const posMap = new Map<number, XYZ>()
            for (const [oscId, pos]: any of Object.entries(posData.objects)) {
              posMap.set(parseInt(oscId), [pos.x, pos.y, pos.z])
            }
            setPositions(posMap)
          }
        }
      } catch (err) {
        // Silent fail si pas de session active
      }
    }, 50)  // 20 FPS

    return () => clearInterval(interval)
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
