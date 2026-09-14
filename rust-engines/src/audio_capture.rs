//! Capture audio input via cpal (microphone/line-in), compute FFT,
//! amplitude bands (RMS/bass/mid/high), and BPM in Rust.
//!
//! Remplace l'ancienne capture Web Audio API (`getUserMedia`) qui ne
//! fonctionnait pas dans l'AppImage à cause des plugins GStreamer.

use crate::audio::{AmplitudeData, AudioState, BPMData, SpectrumData};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use realfft::RealFftPlanner;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Identifiant d'un périphérique audio
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
}

/// Erreur de capture audio
#[derive(Debug, thiserror::Error)]
pub enum AudioCaptureError {
    #[error("No audio input device found")]
    NoDevice,
    #[error("Device not found: {0}")]
    DeviceNotFound(String),
    #[error("Failed to build audio stream: {0}")]
    BuildStreamError(String),
    #[error("Failed to start audio stream: {0}")]
    PlayStreamError(String),
    #[error("Unsupported sample format: {0:?}")]
    UnsupportedSampleFormat(cpal::SampleFormat),
}

impl From<cpal::BuildStreamError> for AudioCaptureError {
    fn from(e: cpal::BuildStreamError) -> Self {
        AudioCaptureError::BuildStreamError(e.to_string())
    }
}

impl From<cpal::PlayStreamError> for AudioCaptureError {
    fn from(e: cpal::PlayStreamError) -> Self {
        AudioCaptureError::PlayStreamError(e.to_string())
    }
}

/// Détecteur de BPM par énergie basse fréquence — port de bpmDetector.ts
#[derive(Debug, Clone)]
pub struct BpmDetector {
    energy_history: Vec<f64>,
    energy_index: usize,
    last_beat_time: f64,
    intervals: VecDeque<f64>,
    bpm: Option<f64>,
    confidence: f64,
}

const ENERGY_HISTORY_SIZE: usize = 43;
const SENSITIVITY: f64 = 0.3;
const MIN_BEAT_INTERVAL_MS: f64 = 250.0;
const INTERVAL_HISTORY_SIZE: usize = 8;
const BPM_SMOOTHING: f64 = 0.3;

impl BpmDetector {
    pub fn new() -> Self {
        BpmDetector {
            energy_history: vec![0.0; ENERGY_HISTORY_SIZE],
            energy_index: 0,
            last_beat_time: 0.0,
            intervals: VecDeque::with_capacity(INTERVAL_HISTORY_SIZE),
            bpm: None,
            confidence: 0.0,
        }
    }

    /// Traite une trame de données fréquentielles (valeurs normalisées 0-1)
    /// `now` en secondes (horloge absolue depuis le début du stream), `bin_hz` largeur d'une case fréquentielle
    pub fn process(&mut self, spectrum: &[f64], bin_hz: f64, now: f64) {
        let low_bin = (20.0 / bin_hz).floor() as usize;
        let high_bin = (150.0 / bin_hz).ceil() as usize;
        let high_bin = high_bin.min(spectrum.len());
        if low_bin >= high_bin {
            return;
        }

        let mut energy = 0.0;
        for v in spectrum.iter().take(high_bin).skip(low_bin) {
            energy += v * v;
        }
        energy /= (high_bin - low_bin) as f64;

        self.energy_history[self.energy_index] = energy;
        self.energy_index = (self.energy_index + 1) % ENERGY_HISTORY_SIZE;

        let avg_energy: f64 = self.energy_history.iter().sum::<f64>() / ENERGY_HISTORY_SIZE as f64;
        let threshold = avg_energy * (1.0 + SENSITIVITY);
        let is_beat = energy > threshold && energy > 0.01;

        if is_beat {
            let time_since_last_beat = (now - self.last_beat_time) * 1000.0;
            if time_since_last_beat > MIN_BEAT_INTERVAL_MS {
                if self.last_beat_time > 0.0 {
                    self.intervals.push_back(time_since_last_beat);
                    if self.intervals.len() > INTERVAL_HISTORY_SIZE {
                        self.intervals.pop_front();
                    }

                    if self.intervals.len() >= 2 {
                        let mut sorted: Vec<f64> = self.intervals.iter().copied().collect();
                        // unwrap_or au lieu de unwrap — évite un panic si NaN
                        sorted.sort_by(|a, b| {
                            a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)
                        });
                        let median = sorted[sorted.len() / 2];
                        let instant_bpm = 60000.0 / median;

                        if (40.0..=240.0).contains(&instant_bpm) {
                            self.bpm = match self.bpm {
                                None => Some(instant_bpm),
                                Some(prev) => {
                                    Some(prev * (1.0 - BPM_SMOOTHING) + instant_bpm * BPM_SMOOTHING)
                                }
                            };

                            let mean =
                                self.intervals.iter().sum::<f64>() / self.intervals.len() as f64;
                            let variance = self
                                .intervals
                                .iter()
                                .map(|x| (x - mean).powi(2))
                                .sum::<f64>()
                                / self.intervals.len() as f64;
                            let cv = variance.sqrt() / mean;
                            self.confidence = (1.0 - cv).clamp(0.0, 1.0);
                        }
                    }
                }
                self.last_beat_time = now;
            }
        }

        // Décroissance de confiance si pas de beat depuis 3s
        if self.last_beat_time > 0.0 && (now - self.last_beat_time) > 3.0 {
            self.confidence *= 0.95;
            if self.confidence < 0.05 {
                self.bpm = None;
                self.intervals.clear();
                self.last_beat_time = 0.0;
            }
        }
    }

    pub fn bpm_data(&self) -> Option<BPMData> {
        self.bpm.map(|bpm| BPMData {
            bpm,
            confidence: self.confidence,
            last_beat_time: self.last_beat_time,
        })
    }
}

impl Default for BpmDetector {
    fn default() -> Self {
        Self::new()
    }
}

/// Gestionnaire de capture audio
#[derive(Clone)]
pub struct AudioCaptureManager {
    shared_state: Arc<Mutex<AudioState>>,
    running: Arc<AtomicBool>,
    sample_rate: Arc<Mutex<f64>>,
    /// Le stream cpal est stocké ici pour permettre un stop propre
    /// (remplace l'ancien `std::mem::forget` qui fuyait à chaque restart)
    stream: Arc<Mutex<Option<cpal::Stream>>>,
}

impl AudioCaptureManager {
    pub fn new() -> Self {
        AudioCaptureManager {
            shared_state: Arc::new(Mutex::new(AudioState::new())),
            running: Arc::new(AtomicBool::new(false)),
            sample_rate: Arc::new(Mutex::new(44100.0)),
            stream: Arc::new(Mutex::new(None)),
        }
    }

    /// Liste les périphériques d'entrée audio
    pub fn list_devices() -> Result<Vec<AudioDeviceInfo>, AudioCaptureError> {
        let host = cpal::default_host();
        let mut devices = Vec::new();
        for (idx, device) in host
            .devices()
            .map_err(|e| AudioCaptureError::BuildStreamError(e.to_string()))?
            .enumerate()
        {
            if device.default_input_config().is_ok() {
                let name = device.name().unwrap_or_else(|_| format!("Device {idx}"));
                let id = format!("{idx}");
                devices.push(AudioDeviceInfo { id, name });
            }
        }
        if devices.is_empty() {
            return Err(AudioCaptureError::NoDevice);
        }
        Ok(devices)
    }

    /// Démarre la capture sur le périphérique choisi (id = index dans list_devices)
    pub fn start(&self, device_id: Option<&str>) -> Result<(), AudioCaptureError> {
        // Si déjà en cours, stopper l'ancien stream proprement d'abord
        if self.running.swap(true, Ordering::SeqCst) {
            self.stop_internal();
            self.running.store(true, Ordering::SeqCst);
        }

        let host = cpal::default_host();
        let devices: Vec<_> = match host.devices() {
            Ok(d) => d.collect(),
            Err(e) => {
                self.running.store(false, Ordering::SeqCst);
                return Err(AudioCaptureError::BuildStreamError(e.to_string()));
            }
        };

        let device = match device_id {
            Some(id) if id != "default" => {
                let idx: usize = id
                    .parse()
                    .map_err(|_| AudioCaptureError::DeviceNotFound(id.to_string()))?;
                devices
                    .into_iter()
                    .nth(idx)
                    .ok_or_else(|| AudioCaptureError::DeviceNotFound(id.to_string()))?
            }
            _ => host
                .default_input_device()
                .ok_or(AudioCaptureError::NoDevice)?,
        };

        let supported_config = device
            .default_input_config()
            .map_err(|e| AudioCaptureError::BuildStreamError(e.to_string()))?;
        let sample_rate = supported_config.sample_rate().0 as f64;
        *self.sample_rate.lock().unwrap_or_else(|e| e.into_inner()) = sample_rate;

        let sample_format = supported_config.sample_format();

        // Construire le stream selon le format d'échantillon
        let stream = match sample_format {
            SampleFormat::F32 => self.build_stream_f32(&device, &supported_config.into())?,
            SampleFormat::I16 => self.build_stream_i16(&device, &supported_config.into())?,
            SampleFormat::U16 => self.build_stream_u16(&device, &supported_config.into())?,
            other => {
                self.running.store(false, Ordering::SeqCst);
                return Err(AudioCaptureError::UnsupportedSampleFormat(other));
            }
        };

        stream.play()?;

        // Stocker le stream au lieu de mem::forget — permet un stop propre
        *self.stream.lock().unwrap_or_else(|e| e.into_inner()) = Some(stream);

        Ok(())
    }

    fn build_stream_f32(
        &self,
        device: &cpal::Device,
        config: &cpal::StreamConfig,
    ) -> Result<cpal::Stream, AudioCaptureError> {
        self.build_stream_generic(device, config, |s: f32| s as f64)
    }

    fn build_stream_i16(
        &self,
        device: &cpal::Device,
        config: &cpal::StreamConfig,
    ) -> Result<cpal::Stream, AudioCaptureError> {
        self.build_stream_generic(device, config, |s: i16| s as f64 / i16::MAX as f64)
    }

    fn build_stream_u16(
        &self,
        device: &cpal::Device,
        config: &cpal::StreamConfig,
    ) -> Result<cpal::Stream, AudioCaptureError> {
        self.build_stream_generic(device, config, |s: u16| {
            (s as f64 - u16::MAX as f64 / 2.0) / (u16::MAX as f64 / 2.0)
        })
    }

    fn build_stream_generic<S, F>(
        &self,
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        convert: F,
    ) -> Result<cpal::Stream, AudioCaptureError>
    where
        S: cpal::Sample + cpal::SizedSample,
        F: Fn(S) -> f64 + Send + 'static,
    {
        let sample_rate = config.sample_rate.0 as f64;
        let fft_size = 1024usize;
        let hop_size = fft_size / 2;
        let shared_state = self.shared_state.clone();
        let running = self.running.clone();

        let mut planner = RealFftPlanner::<f64>::new();
        let r2c = planner.plan_fft_forward(fft_size);
        let window = hann_window(fft_size);
        let mut input_buf: VecDeque<f64> = VecDeque::with_capacity(fft_size * 2);
        let mut fft_input = r2c.make_input_vec();
        let mut fft_output = r2c.make_output_vec();
        let mut scratch = r2c.make_scratch_vec();
        let mut spectrum = vec![0.0f64; fft_size / 2 + 1];
        let mut bpm_detector = BpmDetector::new();
        let stream_start = std::time::Instant::now();
        let mut last_publish = std::time::Instant::now();

        let stream = device.build_input_stream(
            config,
            move |data: &[S], _: &cpal::InputCallbackInfo| {
                if !running.load(Ordering::SeqCst) {
                    return;
                }

                for &sample in data {
                    input_buf.push_back(convert(sample));
                }

                // Traiter par blocs de `hop_size` avec chevauchement 50%
                while input_buf.len() >= fft_size {
                    // Copier les échantillons dans fft_input avec fenêtre de Hann
                    for i in 0..fft_size {
                        fft_input[i] = input_buf[i] * window[i];
                    }

                    r2c.process_with_scratch(&mut fft_input, &mut fft_output, &mut scratch)
                        .unwrap_or_else(|e| eprintln!("[WARN] FFT error: {e}"));

                    for (i, c) in fft_output.iter().enumerate() {
                        spectrum[i] = c.norm() / fft_size as f64;
                    }

                    // Normaliser le spectre 0-1
                    let max_val = spectrum.iter().copied().fold(0.0, f64::max).max(1e-12);
                    for v in &mut spectrum {
                        *v /= max_val;
                    }

                    let bin_hz = sample_rate / fft_size as f64;

                    // Bass / Mid / High
                    let bins = spectrum.len();
                    let bass_end = (bins as f64 * 0.1) as usize;
                    let mid_end = (bins as f64 * 0.4) as usize;
                    let (bass_sum, mid_sum, high_sum) =
                        spectrum
                            .iter()
                            .enumerate()
                            .fold((0.0, 0.0, 0.0), |(b, m, h), (i, &v)| {
                                if i < bass_end {
                                    (b + v, m, h)
                                } else if i < mid_end {
                                    (b, m + v, h)
                                } else {
                                    (b, m, h + v)
                                }
                            });

                    let bass = if bass_end > 0 {
                        bass_sum / bass_end as f64
                    } else {
                        0.0
                    };
                    let mid = if mid_end > bass_end {
                        mid_sum / (mid_end - bass_end) as f64
                    } else {
                        0.0
                    };
                    let high = if bins > mid_end {
                        high_sum / (bins - mid_end) as f64
                    } else {
                        0.0
                    };

                    // RMS depuis les échantillons temporels du bloc
                    let rms = (input_buf.iter().take(fft_size).map(|v| v * v).sum::<f64>()
                        / fft_size as f64)
                        .sqrt();

                    // BPM : horloge absolue depuis le début du stream (fixe le bug du wrap)
                    let now = stream_start.elapsed().as_secs_f64();
                    bpm_detector.process(&spectrum, bin_hz, now);

                    // Publier AudioState toutes les ~100ms (throttle)
                    if last_publish.elapsed().as_millis() >= 100 {
                        last_publish = std::time::Instant::now();
                        let spec_clone: Vec<f64> =
                            spectrum.iter().map(|v| v.clamp(0.0, 1.0)).collect();
                        let state = AudioState {
                            bpm: bpm_detector.bpm_data(),
                            amplitude: Some(AmplitudeData {
                                rms: rms.clamp(0.0, 1.0),
                                bass: bass.clamp(0.0, 1.0),
                                mid: mid.clamp(0.0, 1.0),
                                high: high.clamp(0.0, 1.0),
                            }),
                            spectrum: Some(SpectrumData {
                                spectrum: spec_clone,
                                fft_size,
                            }),
                        };
                        // try_lock : ne pas bloquer le thread audio temps réel
                        if let Ok(mut s) = shared_state.try_lock() {
                            *s = state;
                        }
                    }

                    // Avancer de hop_size — VecDeque pop_front est O(1)
                    for _ in 0..hop_size {
                        input_buf.pop_front();
                    }
                }
            },
            move |err| eprintln!("[WARN] Audio stream error: {err}"),
            None,
        )?;

        Ok(stream)
    }

    /// Stoppe la capture et drop le stream proprement
    pub fn stop(&self) {
        self.stop_internal();
        if let Ok(mut s) = self.shared_state.lock() {
            *s = AudioState::new();
        }
    }

    fn stop_internal(&self) {
        self.running.store(false, Ordering::SeqCst);
        // Drop le stream → cpal arrête la capture
        if let Ok(mut stream_guard) = self.stream.lock() {
            stream_guard.take();
        }
    }

    pub fn get_state(&self) -> AudioState {
        self.shared_state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn sample_rate(&self) -> f64 {
        *self.sample_rate.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl Default for AudioCaptureManager {
    fn default() -> Self {
        Self::new()
    }
}

fn hann_window(size: usize) -> Vec<f64> {
    (0..size)
        .map(|i| {
            let phase = 2.0 * std::f64::consts::PI * i as f64 / (size as f64 - 1.0);
            0.5 * (1.0 - phase.cos())
        })
        .collect()
}
