/// Beat detection algorithm — detects BPM from an AnalyserNode's frequency data.
///
/// Algorithm: energy-based beat detection with adaptive threshold.
/// 1. Compute energy in low-frequency band (kick drum region: 20-150Hz)
/// 2. Track local energy average over a sliding window
/// 3. A beat is detected when instantaneous energy exceeds the average by a sensitivity factor
/// 4. Compute BPM from inter-beat intervals (median of last N intervals for robustness)
/// 5. Smooth BPM over time with exponential moving average

const DEFAULT_SAMPLE_RATE = 44100; // Default AudioContext sample rate

/// History size for local energy average (≈ 43 samples at 60fps = ~0.7s window)
const ENERGY_HISTORY_SIZE = 43;
/// Sensitivity: instantaneous energy must exceed average * (1 + SENSITIVITY)
const SENSITIVITY = 0.3;
/// Minimum time between two beats (ms) — avoids double-triggers. 250ms = max 240 BPM
const MIN_BEAT_INTERVAL_MS = 250;
/// Number of inter-beat intervals to keep for median calculation
const INTERVAL_HISTORY_SIZE = 8;
/// Exponential moving average factor for BPM smoothing (0-1, higher = faster adaptation)
const BPM_SMOOTHING = 0.3;

export interface BpmDetector {
  /// Energy history for adaptive threshold
  energyHistory: number[];
  energyHistoryIndex: number;
  /// Timestamps of detected beats (ms)
  lastBeatTime: number;
  /// Inter-beat intervals (ms)
  intervals: number[];
  /// Current smoothed BPM (null until enough beats detected)
  bpm: number | null;
  /// Confidence: 0-1, based on interval consistency
  confidence: number;
}

export function createBpmDetector(): BpmDetector {
  return {
    energyHistory: new Array(ENERGY_HISTORY_SIZE).fill(0),
    energyHistoryIndex: 0,
    lastBeatTime: 0,
    intervals: [],
    bpm: null,
    confidence: 0,
  };
}

/// Processes one frame of frequency data and updates the BPM detector.
/// Call this once per animation frame (e.g. 60fps).
///
/// @param freqData - Uint8Array from analyser.getByteFrequencyData()
/// @param fftSize - analyser.fftSize (e.g. 1024)
/// @param now - performance.now() timestamp
/// @param sampleRate - AudioContext sample rate (default: 44100)
/// @returns Updated detector state (mutated in place)
export function detectBeat(
  detector: BpmDetector,
  freqData: Uint8Array,
  fftSize: number,
  now: number,
  sampleRate: number = DEFAULT_SAMPLE_RATE,
): BpmDetector {
  // ── 1. Compute energy in low-frequency band (20-150 Hz) ──
  // Each bin = (sampleRate / 2) / (fftSize / 2) = sampleRate / fftSize Hz
  const binHz = sampleRate / fftSize;
  const lowBin = Math.floor(20 / binHz);
  const highBin = Math.ceil(150 / binHz);
  let energy = 0;
  for (let i = lowBin; i <= highBin && i < freqData.length; i++) {
    const v = freqData[i] / 255; // normalize 0-1
    energy += v * v;
  }
  energy /= (highBin - lowBin + 1);

  // ── 2. Update energy history and compute average ──
  detector.energyHistory[detector.energyHistoryIndex] = energy;
  detector.energyHistoryIndex = (detector.energyHistoryIndex + 1) % ENERGY_HISTORY_SIZE;
  let avgEnergy = 0;
  for (let i = 0; i < ENERGY_HISTORY_SIZE; i++) {
    avgEnergy += detector.energyHistory[i];
  }
  avgEnergy /= ENERGY_HISTORY_SIZE;

  // ── 3. Beat detection: energy exceeds adaptive threshold ──
  const threshold = avgEnergy * (1 + SENSITIVITY);
  const isBeat = energy > threshold && energy > 0.01; // ignore near-silence

  if (isBeat) {
    const timeSinceLastBeat = now - detector.lastBeatTime;

    // Avoid double-triggers (refractory period)
    if (timeSinceLastBeat > MIN_BEAT_INTERVAL_MS) {
      if (detector.lastBeatTime > 0) {
        // Record inter-beat interval
        detector.intervals.push(timeSinceLastBeat);
        if (detector.intervals.length > INTERVAL_HISTORY_SIZE) {
          detector.intervals.shift();
        }

        // ── 4. Compute BPM from median of intervals ──
        if (detector.intervals.length >= 2) {
          const sorted = [...detector.intervals].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          const instantBpm = 60000 / median;

          // Sanity check: 40-240 BPM range
          if (instantBpm >= 40 && instantBpm <= 240) {
            if (detector.bpm === null) {
              detector.bpm = instantBpm;
            } else {
              // Exponential moving average for smoothing
              detector.bpm = detector.bpm * (1 - BPM_SMOOTHING) + instantBpm * BPM_SMOOTHING;
            }

            // ── 5. Confidence: based on interval consistency (coefficient of variation) ──
            const mean = detector.intervals.reduce((a, b) => a + b, 0) / detector.intervals.length;
            const variance = detector.intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / detector.intervals.length;
            const cv = Math.sqrt(variance) / mean; // coefficient of variation
            detector.confidence = Math.max(0, Math.min(1, 1 - cv));
          }
        }
      }
      detector.lastBeatTime = now;
    }
  }

  // Decay confidence if no beat detected for a while (signal lost)
  if (detector.lastBeatTime > 0 && now - detector.lastBeatTime > 3000) {
    detector.confidence *= 0.95;
    if (detector.confidence < 0.05) {
      detector.bpm = null;
      detector.intervals = [];
      detector.lastBeatTime = 0;
    }
  }

  return detector;
}
