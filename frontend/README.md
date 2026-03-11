# OSCAI Frontend

Modern React + TypeScript frontend for OSCAI spatial audio trajectory generator.

## Features

- 🎨 **Modern UI** with TailwindCSS and dark theme
- 🎵 **3D Visualization** using Three.js and React Three Fiber
- ⚡ **Real-time Generation** with WebSocket progress feedback
- 🎛️ **Macro Controls** for live trajectory manipulation
- 💡 **Smart Suggestions** based on learning system
- 📊 **History Tracking** with quality metrics
- 🔄 **CPU-Optimized UX** with async generation feedback

## Tech Stack

- **React 18** with TypeScript
- **Vite** for fast development
- **Three.js** + @react-three/fiber for 3D rendering
- **Zustand** for state management
- **Axios** for API calls
- **TailwindCSS** for styling
- **Lucide React** for icons

## Installation

```bash
cd frontend
npm install
```

## Development

```bash
# Start dev server (requires backend running on :8080)
npm run dev
```

Frontend will be available at http://localhost:3000

## Build

```bash
npm run build
```

## Project Structure

```
src/
├── components/
│   ├── PromptInput.tsx          # Prompt textarea + examples
│   ├── TrajectoryVisualizer.tsx # 3D Three.js canvas
│   ├── MacroControls.tsx        # TSpeed, Scale, Shift sliders
│   └── GenerationProgress.tsx   # WebSocket progress bar
├── store/
│   └── trajectoryStore.ts       # Zustand global state
├── api/
│   └── client.ts                # API + WebSocket client
├── App.tsx                      # Main layout
├── main.tsx                     # Entry point
└── index.css                    # Tailwind styles
```

## Usage

### 1. Start Backend

```bash
cd ..
./start_api.sh
```

### 2. Start Frontend

```bash
npm run dev
```

### 3. Generate Trajectory

1. Enter natural language prompt (e.g., "spiral rising over 12 seconds")
2. Click "Generate Trajectory"
3. Wait 20-40s (CPU mode) with progress feedback
4. View 3D visualization with playback controls
5. Adjust with macro controls (TSpeed, Scale, Shift)

## Components

### PromptInput

- Textarea for natural language input
- Example prompts for quick start
- Recent trajectory history
- Auto-fix indicators
- Smart suggestions from learning system

### TrajectoryVisualizer

- 3D canvas with orbit controls
- Real-time object rendering
- Trajectory trails
- Grid reference
- Responsive to macro controls

### MacroControls

- **TSpeed**: Playback speed (0.1x - 3.0x)
- **Scale X/Y/Z**: Spatial expansion/contraction
- **Shift X/Y/Z**: Spatial translation
- Reset button to defaults

### GenerationProgress

- WebSocket-based real-time updates
- Progress bar (0-100%)
- Status messages
- Tips during CPU generation
- Error handling

## State Management

Global state managed with Zustand:

```typescript
{
  currentTrajectory: TrajectoryData | null
  trajectoryHistory: TrajectoryData[]
  isGenerating: boolean
  generationProgress: { status, progress, message }
  isPlaying: boolean
  currentTime: number
  macroControls: { tSpeed, scaleX, scaleY, scaleZ, shiftX, shiftY, shiftZ }
  suggestions: string[]
}
```

## API Integration

### REST Endpoints

- `POST /api/generate` - Generate trajectory (with cache)
- `GET /api/trajectories` - List cached trajectories
- `DELETE /api/trajectories/:id` - Delete trajectory
- `GET /api/renderers` - List OSC renderers

### WebSocket

- `ws://localhost:8080/ws/generate` - Real-time generation progress

## CPU-Optimized UX

### Features for 20-30s Latency

1. **Progress Feedback**
   - Real-time status updates
   - Estimated time remaining
   - Tips during generation

2. **Caching**
   - Instant replay of previous prompts
   - History with quality metrics
   - Auto-fix indicators

3. **Batch Workflow**
   - Example prompts for quick variations
   - History for comparison
   - Macro controls for fine-tuning

4. **Educational Content**
   - Tips during wait time
   - Suggestions for better prompts
   - Quality scores

## Customization

### Theme

Edit `tailwind.config.js`:

```javascript
theme: {
  extend: {
    colors: {
      primary: {
        500: '#0ea5e9', // Change primary color
      },
    },
  },
}
```

### 3D Rendering

Edit `TrajectoryVisualizer.tsx`:

```typescript
// Camera position
camera={{ position: [3, 3, 3], fov: 60 }}

// Grid size
<Grid args={[20, 20]} cellSize={0.5} />

// Object size
<Sphere args={[0.05, 16, 16]} />
```

## Troubleshooting

### Backend Connection Issues

Check proxy configuration in `vite.config.ts`:

```typescript
proxy: {
  '/api': 'http://localhost:8080',
  '/ws': 'ws://localhost:8080',
}
```

### 3D Performance

- Reduce trail length in `TrajectoryVisualizer.tsx`
- Lower FPS in playback loop
- Decrease sphere polygon count

### WebSocket Disconnects

- Check backend is running
- Verify CORS settings
- Check browser console for errors

## Future Enhancements

- [ ] MIDI controller integration
- [ ] OSC output configuration UI
- [ ] Trajectory export/import
- [ ] Preset library
- [ ] Collaborative editing
- [ ] Mobile responsive design
- [ ] Keyboard shortcuts
- [ ] Undo/redo functionality

## License

Part of OSCAI project - Local LLM Spatial Audio Generator
