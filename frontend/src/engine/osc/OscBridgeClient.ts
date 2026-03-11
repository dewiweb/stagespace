/**
 * OscBridgeClient
 *
 * WebSocket client that connects the frontend to the osc-bridge server.
 *
 * OSC OUT: call send(address, args) → forwards to bridge → UDP
 * OSC IN:  register onMessage handler → receives incoming OSC messages
 *
 * Auto-reconnects on disconnect with exponential backoff.
 */

import type { OscMessage } from './types'

export type BridgeStatus = {
  connected: boolean
  oscHost: string
  oscPort: number
  oscInPort: number
}

export type BridgeStatusHandler  = (status: BridgeStatus) => void
export type BridgeMessageHandler = (msg: OscMessage) => void

const WS_DEFAULT_URL = 'ws://localhost:8765'
const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS  = 8000

export class OscBridgeClient {
  private url:        string
  private ws:         WebSocket | null = null
  private connected:  boolean = false
  private destroyed:  boolean = false

  private reconnectDelay = RECONNECT_BASE_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  private onStatusHandlers:  BridgeStatusHandler[]  = []
  private onMessageHandlers: BridgeMessageHandler[] = []

  constructor(url = WS_DEFAULT_URL) {
    this.url = url
    this._connect()
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Send one OSC message (address + float args) to the bridge → UDP */
  send(address: string, args: number[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ type: 'osc-out', address, args }))
  }

  /** Update remote config (OSC target host/port, input port) */
  configure(config: { oscHost?: string; oscPort?: number; oscInPort?: number }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ type: 'config', ...config }))
  }

  /** Register a handler for OSC IN messages received from the bridge */
  onMessage(handler: BridgeMessageHandler): () => void {
    this.onMessageHandlers.push(handler)
    return () => {
      this.onMessageHandlers = this.onMessageHandlers.filter(h => h !== handler)
    }
  }

  /** Register a handler for bridge status changes (connected, config) */
  onStatus(handler: BridgeStatusHandler): () => void {
    this.onStatusHandlers.push(handler)
    return () => {
      this.onStatusHandlers = this.onStatusHandlers.filter(h => h !== handler)
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  destroy(): void {
    this.destroyed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private _connect(): void {
    if (this.destroyed) return

    try {
      this.ws = new WebSocket(this.url)
    } catch (err) {
      this._scheduleReconnect()
      return
    }

    this.ws.addEventListener('open', () => {
      this.connected = true
      this.reconnectDelay = RECONNECT_BASE_MS
      this.ws!.send(JSON.stringify({ type: 'ping' }))
    })

    this.ws.addEventListener('message', (event) => {
      this._handleMessage(event.data as string)
    })

    this.ws.addEventListener('close', () => {
      this.connected = false
      this._notifyStatus({ connected: false, oscHost: '', oscPort: 0, oscInPort: 0 })
      this._scheduleReconnect()
    })

    this.ws.addEventListener('error', () => {
      // 'close' will fire after 'error' — reconnect handled there
    })
  }

  private _handleMessage(raw: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    switch (msg.type) {
      case 'osc-in': {
        const oscMsg: OscMessage = {
          address:    msg.address    as string,
          args:       msg.args       as (number | string | boolean)[],
          receivedAt: performance.now(),
        }
        for (const h of this.onMessageHandlers) h(oscMsg)
        break
      }

      case 'status':
        this._notifyStatus({
          connected:  true,
          oscHost:    msg.oscHost   as string,
          oscPort:    msg.oscPort   as number,
          oscInPort:  msg.oscInPort as number,
        })
        break

      case 'pong':
        break

      case 'error':
        console.warn('[OscBridgeClient] bridge error:', msg.message)
        break
    }
  }

  private _notifyStatus(status: BridgeStatus): void {
    for (const h of this.onStatusHandlers) h(status)
  }

  private _scheduleReconnect(): void {
    if (this.destroyed) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
      this._connect()
    }, this.reconnectDelay)
  }
}
