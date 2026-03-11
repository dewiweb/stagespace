import { create } from 'zustand'

export interface TrajectoryData {
  duration: number
  fps: number
  objects: number[]
  frames: number[][][]           // [obj_idx][frame_idx][x, y, z]
  description?: string
  _metadata?: {
    method: string
    engine: string
    n_objects: number
    n_frames: number
  }
}

interface GenerationProgress {
  status: 'idle' | 'started' | 'processing' | 'validating' | 'completed' | 'error'
  progress: number
  message: string
}

interface MacroControls {
  tSpeed: number
  scaleX: number
  scaleY: number
  scaleZ: number
  shiftX: number
  shiftY: number
  shiftZ: number
}

interface TrajectoryStore {
  // Trajectory data
  currentTrajectory: TrajectoryData | null
  trajectoryHistory: TrajectoryData[]
  
  // Generation state
  isGenerating: boolean
  generationProgress: GenerationProgress
  
  // Playback state
  isPlaying: boolean
  currentTime: number
  
  // Macro controls
  macroControls: MacroControls
  
  // Suggestions
  suggestions: string[]
  
  // Actions
  setTrajectory: (trajectory: TrajectoryData) => void
  setGenerating: (isGenerating: boolean) => void
  setProgress: (progress: GenerationProgress) => void
  togglePlayback: () => void
  setCurrentTime: (time: number | ((prev: number) => number)) => void
  updateMacroControl: (key: keyof MacroControls, value: number) => void
  resetMacroControls: () => void
  setSuggestions: (suggestions: string[]) => void
  reset: () => void
}

const defaultMacroControls: MacroControls = {
  tSpeed: 1.0,
  scaleX: 1.0,
  scaleY: 1.0,
  scaleZ: 1.0,
  shiftX: 0.0,
  shiftY: 0.0,
  shiftZ: 0.0,
}

export const useTrajectoryStore = create<TrajectoryStore>((set) => ({
  currentTrajectory: null,
  trajectoryHistory: [],
  isGenerating: false,
  generationProgress: {
    status: 'idle',
    progress: 0,
    message: '',
  },
  isPlaying: false,
  currentTime: 0,
  macroControls: defaultMacroControls,
  suggestions: [],

  setTrajectory: (trajectory) =>
    set((state) => ({
      currentTrajectory: trajectory,
      trajectoryHistory: [trajectory, ...state.trajectoryHistory.slice(0, 9)],
      isGenerating: false,
      generationProgress: {
        status: 'completed',
        progress: 100,
        message: 'Trajectory generated successfully!',
      },
    })),

  setGenerating: (isGenerating) =>
    set({ isGenerating }),

  setProgress: (progress) =>
    set({ generationProgress: progress }),

  togglePlayback: () =>
    set((state) => ({ isPlaying: !state.isPlaying })),

  setCurrentTime: (time) =>
    set((state) => ({ 
      currentTime: typeof time === 'function' ? time(state.currentTime) : time 
    })),

  updateMacroControl: (key, value) =>
    set((state) => ({
      macroControls: {
        ...state.macroControls,
        [key]: value,
      },
    })),

  resetMacroControls: () =>
    set({ macroControls: defaultMacroControls }),

  setSuggestions: (suggestions) =>
    set({ suggestions }),

  reset: () =>
    set({
      isPlaying: false,
      currentTime: 0,
    }),
}))
