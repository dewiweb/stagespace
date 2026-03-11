import axios from 'axios'
import { TrajectoryData } from '../store/trajectoryStore'

const api = axios.create({
  baseURL: '/api',
  timeout: 150000, // 150s for CPU generation
})

export interface GenerateRequest {
  prompt: string
  use_cache?: boolean
}

export interface GenerateResponse {
  id: string
  prompt: string
  trajectory: TrajectoryData
  quality_score: number
  latency: number
  timestamp: string
}

export const trajectoryApi = {
  generate: async (request: GenerateRequest): Promise<GenerateResponse> => {
    const response = await api.post<GenerateResponse>('/generate', request)
    return response.data
  },

  listTrajectories: async () => {
    const response = await api.get('/trajectories')
    return response.data
  },

  deleteTrajectory: async (id: string) => {
    const response = await api.delete(`/trajectories/${id}`)
    return response.data
  },

  listRenderers: async () => {
    const response = await api.get('/renderers')
    return response.data
  },
}

export class WebSocketClient {
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5

  connect(
    onProgress: (data: any) => void,
    onError: (error: any) => void
  ) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/generate`

    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      console.log('WebSocket connected')
      this.reconnectAttempts = 0
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onProgress(data)
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    }

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      onError(error)
    }

    this.ws.onclose = () => {
      console.log('WebSocket disconnected')
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++
        setTimeout(() => this.connect(onProgress, onError), 2000)
      }
    }
  }

  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    } else {
      console.error('WebSocket not connected')
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}
