import React from 'react';
import { safeInvoke as invoke } from '../utils/tauri';
import { useGraphStore, type AudioState } from '../store/useGraphStore';

export default function AudioPanel() {
  const audioState = useGraphStore((s) => s.audioState);
  const setAudioState = useGraphStore((s) => s.setAudioState);
  const [isListening, setIsListening] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const lastPushRef = React.useRef(0);

  const stopListening = React.useCallback(async () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      await audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setIsListening(false);
    setAudioState({ bpm: null, amplitude: null, spectrum: null });
  }, [setAudioState]);

  const startListening = React.useCallback(async () => {
    setError(null);
    try {
      // Vérifier que getUserMedia est disponible
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(
          'Microphone not available. On Linux, run:\n' +
          'gsettings set org.webkit.webkit2gtk allow-microphone true\n' +
          'or launch with: WEBKIT_USE_SINGLE_WEB_PROCESS=1'
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      setIsListening(true);

      const freqData = new Uint8Array(analyser.frequencyBinCount);
      const timeData = new Uint8Array(analyser.fftSize);

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(freqData);
        analyserRef.current.getByteTimeDomainData(timeData);

        // Compute RMS from time domain
        let sum = 0;
        for (let i = 0; i < timeData.length; i++) {
          const v = (timeData[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / timeData.length);

        // Compute bass/mid/high from frequency bins
        const bins = freqData.length;
        const bassEnd = Math.floor(bins * 0.1);
        const midEnd = Math.floor(bins * 0.4);
        let bassSum = 0, midSum = 0, highSum = 0;
        for (let i = 0; i < bassEnd; i++) bassSum += freqData[i];
        for (let i = bassEnd; i < midEnd; i++) midSum += freqData[i];
        for (let i = midEnd; i < bins; i++) highSum += freqData[i];

        const bass = bassSum / (bassEnd * 255);
        const mid = midSum / ((midEnd - bassEnd) * 255);
        const high = highSum / ((bins - midEnd) * 255);

        const newAudioState: AudioState = {
          bpm: audioState.bpm,
          amplitude: { rms, bass, mid, high },
          spectrum: { spectrum: Array.from(freqData).map((v) => v / 255), fft_size: analyser.fftSize },
        };

        setAudioState(newAudioState);

        // Push to Rust at most ~10/s
        const now = performance.now();
        if (now - lastPushRef.current > 100) {
          lastPushRef.current = now;
          invoke('update_audio_state', { audioData: newAudioState }).catch(console.error);
        }

        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to access microphone');
      setIsListening(false);
    }
  }, [audioState.bpm, setAudioState]);

  React.useEffect(() => {
    return () => { void stopListening(); };
  }, [stopListening]);

  const amp = audioState.amplitude;

  return (
    <div className="p-3 h-full flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
          <span className="text-white text-xs">MIC</span>
        </div>
        <h3 className="text-white font-semibold text-sm">Audio Input</h3>
      </div>

      {error && (
        <div className="p-2 bg-red-950/40 border border-red-800/50 rounded text-red-400 text-[11px]">
          {error}
        </div>
      )}

      {/* Status */}
      <div className="p-2.5 bg-gray-800/50 rounded-lg border border-gray-700/50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-400 text-[11px]">Status</span>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${isListening ? 'bg-green-500 animate-pulse' : 'bg-gray-600'}`} />
            <span className={`text-[11px] font-medium ${isListening ? 'text-green-400' : 'text-gray-500'}`}>
              {isListening ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </div>

      {/* Amplitude */}
      {isListening && amp && (
        <div className="space-y-2">
          <div className="text-gray-400 text-[11px] font-medium uppercase tracking-wide">Amplitude</div>
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
            <span className="text-gray-400 text-[11px]">BPM</span>
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
          <div className="text-gray-600 text-[10px] mt-0.5">Confidence {(audioState.bpm.confidence * 100).toFixed(0)}%</div>
        </div>
      )}

      {/* Spectrum */}
      {isListening && audioState.spectrum && (
        <div className="space-y-1.5">
          <div className="text-gray-400 text-[11px] font-medium uppercase tracking-wide">Spectrum</div>
          <SpectrumView spectrum={audioState.spectrum.spectrum} />
        </div>
      )}

      <div className="mt-auto">
        <button
          onClick={isListening ? stopListening : startListening}
          className={`w-full py-2 px-3 rounded-lg font-medium text-xs transition-all ${
            isListening
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {isListening ? 'Stop' : 'Start'}
        </button>
      </div>
    </div>
  );
}

const Bar: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div className="flex items-center gap-2">
    <span className="text-gray-500 text-[11px] w-10">{label}</span>
    <div className="flex-1 h-2 bg-gray-900 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-100 rounded-full`}
        style={{ width: `${Math.min(100, value * 100)}%` }}
      />
    </div>
    <span className="text-gray-400 text-[10px] font-mono w-8 text-right">{(value * 100).toFixed(0)}%</span>
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
