import React from 'react';
import { safeInvoke as invoke } from '../utils/tauri';
import { useGraphStore } from '../store/useGraphStore';

interface AudioDevice {
  id: string;
  name: string;
}

export default function AudioPanel() {
  const audioState = useGraphStore((s) => s.audioState);
  const selectedAudioDeviceId = useGraphStore((s) => s.selectedAudioDeviceId);
  const setSelectedAudioDeviceId = useGraphStore((s) => s.setSelectedAudioDeviceId);
  // Le cycle de vie de la capture vit dans le store (audioListening +
  // start/stopAudioCapture), pas dans ce composant : le backend capture tant
  // que l'utilisateur ne stoppe pas explicitement — repli du panneau, volet
  // droit masqué ou mode Perform ne doivent pas tuer l'entrée audio.
  const isListening = useGraphStore((s) => s.audioListening);
  const startAudioCapture = useGraphStore((s) => s.startAudioCapture);
  const stopAudioCapture = useGraphStore((s) => s.stopAudioCapture);
  const [error, setError] = React.useState<string | null>(null);
  const [audioDevices, setAudioDevices] = React.useState<AudioDevice[]>([]);
  // Replié par défaut : la capture est un usage occasionnel, le panneau ne doit
  // pas occuper ~40% de la colonne droite en permanence.
  const [collapsed, setCollapsed] = React.useState(true);

  const startListening = React.useCallback(async () => {
    setError(null);
    try {
      await startAudioCapture();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg ?? 'Failed to start audio capture');
    }
  }, [startAudioCapture]);

  // Charger la liste des devices au montage
  React.useEffect(() => {
    invoke<AudioDevice[]>('list_audio_devices', {})
      .then((devices) => setAudioDevices(devices))
      .catch((e: unknown) => {
        console.error('[AudioPanel] list_audio_devices failed:', e);
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Audio device listing failed: ${msg}`);
      });
  }, []);

  const amp = audioState.amplitude;

  return (
    <div className="flex flex-col">
      {/* Header — toujours visible, résume l'état même replié */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800/40 transition-colors text-left"
        title={collapsed ? 'Show audio input controls' : 'Hide audio input controls'}
      >
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isListening ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
        <h3 className="text-gray-300 font-semibold text-xs flex-1">Audio Input</h3>
        {isListening && amp && (
          <div className="w-16 h-1.5 bg-gray-900 rounded-full overflow-hidden">
            <div className="h-full bg-cyan-500 transition-all duration-100" style={{ width: `${Math.min(100, amp.rms * 100)}%` }} />
          </div>
        )}
        {isListening && audioState.bpm && (
          <span className="text-cyan-400 text-xs font-mono">{audioState.bpm.bpm.toFixed(0)} BPM</span>
        )}
        <span className="text-gray-400 text-xs">{collapsed ? '▸' : '▾'}</span>
      </button>

      {collapsed ? null : (
      <div className="px-3 pb-3 flex flex-col gap-2">

      {error && (
        <div className="p-2 bg-red-950/40 border border-red-800/50 rounded text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Device selector */}
      <select
        value={selectedAudioDeviceId ?? ''}
        onChange={(e) => setSelectedAudioDeviceId(e.target.value || null)}
        disabled={isListening || audioDevices.length === 0}
        className="w-full text-xs bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-300 focus:outline-none focus:border-blue-500"
      >
        <option value="">{audioDevices.length === 0 ? 'No devices' : 'Default device'}</option>
        {audioDevices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>

      {/* Status */}
      <div className="p-2.5 bg-gray-800/50 rounded-lg border border-gray-700/50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-400 text-xs">Status</span>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${isListening ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
            <span className={`text-xs font-medium ${isListening ? 'text-green-400' : 'text-gray-500'}`}>
              {isListening ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </div>

      {/* Amplitude */}
      {isListening && amp && (
        <div className="space-y-2">
          <div className="text-gray-400 text-xs font-medium uppercase tracking-wide">Amplitude</div>
          <Bar label="RMS" value={amp.rms} color="bg-blue-500" />
          <Bar label="Bass" value={amp.bass} color="bg-red-500" />
          <Bar label="Mid" value={amp.mid} color="bg-green-500" />
          <Bar label="High" value={amp.high} color="bg-yellow-500" />
        </div>
      )}

      {/* BPM */}
      {isListening && audioState.bpm && (
        <div className="p-2.5 bg-gray-800/50 rounded-lg border border-gray-700/50">
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-xs">BPM</span>
            <span className="text-white text-lg font-mono font-bold">
              {audioState.bpm.bpm.toFixed(0)}
            </span>
          </div>
          <div className="mt-1 h-1 bg-gray-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-cyan-500 transition-all"
              style={{ width: `${audioState.bpm.confidence * 100}%` }}
            />
          </div>
          <div className="text-gray-400 text-xs mt-0.5">Confidence {(audioState.bpm.confidence * 100).toFixed(0)}%</div>
        </div>
      )}

      {/* Spectrum */}
      {isListening && audioState.spectrum && (
        <div className="space-y-1.5">
          <div className="text-gray-400 text-xs font-medium uppercase tracking-wide">Spectrum</div>
          <SpectrumView spectrum={audioState.spectrum.spectrum} />
        </div>
      )}

      <div className="mt-auto">
        <button
          onClick={isListening ? stopAudioCapture : startListening}
          disabled={audioDevices.length === 0}
          className={`w-full py-2 px-3 rounded-lg font-medium text-xs transition-all ${
            isListening
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : audioDevices.length === 0
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {isListening ? 'Stop' : 'Start'}
        </button>
      </div>
      </div>
      )}
    </div>
  );
}

const Bar: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div className="flex items-center gap-2">
    <span className="text-gray-500 text-xs w-10">{label}</span>
    <div className="flex-1 h-2 bg-gray-900 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-100 rounded-full`}
        style={{ width: `${Math.min(100, value * 100)}%` }}
      />
    </div>
    <span className="text-gray-400 text-xs font-mono w-8 text-right">{(value * 100).toFixed(0)}%</span>
  </div>
);

const SpectrumView: React.FC<{ spectrum: number[] }> = ({ spectrum }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const bars = 48;
    const step = Math.floor(spectrum.length / bars) || 1;
    const barWidth = w / bars;

    for (let i = 0; i < bars; i++) {
      const val = spectrum[i * step] ?? 0;
      const barH = val * h;
      const hue = 200 + (i / bars) * 80;
      ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;
      ctx.fillRect(i * barWidth, h - barH, barWidth - 1, barH);
    }
  }, [spectrum]);

  return (
    <canvas
      ref={canvasRef}
      width={220}
      height={60}
      className="w-full h-15 bg-gray-900 rounded border border-gray-700/50"
    />
  );
};
