/**
 * HOLOFLOW OSC Bridge
 *
 * Bidirectional bridge between the frontend (WebSocket) and OSC targets (UDP).
 *
 * Architecture:
 *   frontend ──WS──► bridge ──UDP──► Holophonix / SPAT / IEM
 *   frontend ◄──WS── bridge ◄──UDP── Holophonix (feedback / triggers)
 *
 * WebSocket protocol (JSON messages):
 *
 *   Frontend → Bridge:
 *     { type: 'osc-out', address: string, args: number[] }
 *     { type: 'config',  oscHost: string, oscPort: number, oscInPort: number }
 *     { type: 'ping' }
 *
 *   Bridge → Frontend:
 *     { type: 'osc-in',  address: string, args: (number|string|boolean)[] }
 *     { type: 'status',  connected: boolean, oscHost: string, oscPort: number, oscInPort: number }
 *     { type: 'pong' }
 *     { type: 'error',   message: string }
 */

import dgram from 'node:dgram'
import { WebSocketServer, WebSocket } from 'ws'

// ── Default config (overridable at runtime via 'config' WS message) ──────────

let oscHost   = process.env.OSC_HOST    ?? '127.0.0.1'
let oscPort   = parseInt(process.env.OSC_PORT    ?? '9000')
let oscInPort = parseInt(process.env.OSC_IN_PORT ?? '9001')
const wsPort  = parseInt(process.env.WS_PORT     ?? '8765')

// ── UDP socket (OSC OUT + IN) ─────────────────────────────────────────────────

const udp = dgram.createSocket('udp4')

// ── WebSocket server ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: wsPort })
const clients = new Set<WebSocket>()

function broadcast(msg: object): void {
  const data = JSON.stringify(msg)
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data)
  }
}

// ── OSC encoding (minimal, no external lib dependency for encoding) ────────────

/**
 * Encode an OSC message to a Buffer.
 * Supports float32 args only (sufficient for position data).
 */
function encodeOSC(address: string, args: number[]): Buffer {
  function padToMultiple4(s: string): Buffer {
    const buf = Buffer.from(s + '\0', 'ascii')
    const pad = 4 - (buf.length % 4)
    if (pad === 4) return buf
    return Buffer.concat([buf, Buffer.alloc(pad)])
  }

  const addrBuf  = padToMultiple4(address)
  const typeBuf  = padToMultiple4(',' + 'f'.repeat(args.length))
  const argsBuf  = Buffer.allocUnsafe(args.length * 4)
  for (let i = 0; i < args.length; i++) {
    argsBuf.writeFloatBE(args[i], i * 4)
  }
  return Buffer.concat([addrBuf, typeBuf, argsBuf])
}

// ── OSC decoding ──────────────────────────────────────────────────────────────

type OscValue = number | string | boolean

function decodeOSC(buf: Buffer): { address: string; args: OscValue[] } | null {
  try {
    let offset = 0

    // Read null-terminated address string, padded to 4 bytes
    const addrEnd = buf.indexOf(0, offset)
    const address = buf.toString('ascii', offset, addrEnd)
    offset = Math.ceil((addrEnd + 1) / 4) * 4

    // Read type tag string
    if (buf[offset] !== 0x2c) return null  // must start with ','
    const typeEnd = buf.indexOf(0, offset)
    const types   = buf.toString('ascii', offset + 1, typeEnd)
    offset = Math.ceil((typeEnd + 1) / 4) * 4

    const args: OscValue[] = []
    for (const t of types) {
      if (t === 'f') {
        args.push(buf.readFloatBE(offset))
        offset += 4
      } else if (t === 'i') {
        args.push(buf.readInt32BE(offset))
        offset += 4
      } else if (t === 'd') {
        args.push(buf.readDoubleBE(offset))
        offset += 8
      } else if (t === 's') {
        const end = buf.indexOf(0, offset)
        args.push(buf.toString('ascii', offset, end))
        offset = Math.ceil((end + 1) / 4) * 4
      } else if (t === 'T') {
        args.push(true)
      } else if (t === 'F') {
        args.push(false)
      }
      // unknown types: skip
    }
    return { address, args }
  } catch {
    return null
  }
}

// ── UDP OSC IN listener ───────────────────────────────────────────────────────

function startUdpIn(): void {
  const receiver = dgram.createSocket('udp4')

  receiver.on('message', (buf) => {
    const msg = decodeOSC(buf)
    if (msg) {
      broadcast({ type: 'osc-in', address: msg.address, args: msg.args })
    }
  })

  receiver.on('error', (err) => {
    console.error(`[UDP IN] ${err.message}`)
    broadcast({ type: 'error', message: `UDP IN: ${err.message}` })
  })

  receiver.bind(oscInPort, () => {
    console.log(`[UDP IN]  listening on port ${oscInPort}`)
  })
}

// ── Send OSC OUT via UDP ──────────────────────────────────────────────────────

function sendOSC(address: string, args: number[]): void {
  const buf = encodeOSC(address, args)
  udp.send(buf, oscPort, oscHost, (err) => {
    if (err) console.error(`[UDP OUT] send error: ${err.message}`)
  })
}

// ── WebSocket message handler ─────────────────────────────────────────────────

function handleMessage(ws: WebSocket, raw: string): void {
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(raw)
  } catch {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }))
    return
  }

  switch (msg.type) {
    case 'osc-out': {
      const address = msg.address as string
      const args    = msg.args    as number[]
      if (typeof address !== 'string' || !Array.isArray(args)) break
      sendOSC(address, args)
      break
    }

    case 'config': {
      if (msg.oscHost)   oscHost   = msg.oscHost   as string
      if (msg.oscPort)   oscPort   = msg.oscPort   as number
      if (msg.oscInPort) oscInPort = msg.oscInPort as number
      console.log(`[CONFIG] host=${oscHost} outPort=${oscPort} inPort=${oscInPort}`)
      broadcastStatus()
      break
    }

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }))
      break

    default:
      ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }))
  }
}

function broadcastStatus(): void {
  broadcast({
    type: 'status',
    connected: true,
    oscHost,
    oscPort,
    oscInPort,
  })
}

// ── WebSocket server events ───────────────────────────────────────────────────

wss.on('connection', (ws) => {
  clients.add(ws)
  console.log(`[WS] client connected (total: ${clients.size})`)

  // Send current config immediately on connect
  ws.send(JSON.stringify({
    type: 'status',
    connected: true,
    oscHost,
    oscPort,
    oscInPort,
  }))

  ws.on('message', (data) => handleMessage(ws, data.toString()))

  ws.on('close', () => {
    clients.delete(ws)
    console.log(`[WS] client disconnected (total: ${clients.size})`)
  })

  ws.on('error', (err) => {
    console.error(`[WS] error: ${err.message}`)
    clients.delete(ws)
  })
})

wss.on('listening', () => {
  console.log(`\n┌─────────────────────────────────────────┐`)
  console.log(`│  HOLOFLOW OSC Bridge                    │`)
  console.log(`│                                         │`)
  console.log(`│  WebSocket  ws://localhost:${wsPort}       │`)
  console.log(`│  OSC OUT →  ${oscHost}:${String(oscPort).padEnd(18)}│`)
  console.log(`│  OSC IN  ←  UDP port ${String(oscInPort).padEnd(19)}│`)
  console.log(`└─────────────────────────────────────────┘\n`)
})

// ── Start ─────────────────────────────────────────────────────────────────────

startUdpIn()
