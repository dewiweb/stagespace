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
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
                        sorted
                            .sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
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
///
/// Le `cpal::Stream` n'est **pas Send** : il vit et meurt dans un thread de
/// capture dédié. Le manager ne garde que le `JoinHandle` et un canal de stop,
/// ce qui rend `AudioCaptureManager` `Send + Sync` (requis par Tauri State).
#[derive(Clone)]
pub struct AudioCaptureManager {
    shared_state: Arc<Mutex<AudioState>>,
    running: Arc<AtomicBool>,
    sample_rate: Arc<Mutex<f64>>,
    /// Thread qui possède le stream cpal (build → play → attente stop → drop)
    capture_thread: Arc<Mutex<Option<std::thread::JoinHandle<()>>>>,
    /// Canal vers le thread de capture : Stop, ou StreamDied remonté par
    /// le callback d'erreur cpal pour déclencher l'auto-reconnexion.
    event_tx: Arc<Mutex<Option<std::sync::mpsc::Sender<CaptureEvent>>>>,
    /// Dernière erreur fatale du stream (ex: device débranché) — consommée
    /// par le poller via `take_error()` pour émettre `audio-error` au frontend.
    last_error: Arc<Mutex<Option<String>>>,
    /// Positionné après une reconnexion réussie — le poller émet
    /// `audio-recovered` une fois (take_recovered).
    recovered: Arc<AtomicBool>,
}

/// Événements vers le thread de capture.
enum CaptureEvent {
    /// Arrêt demandé par `stop()` / nouveau `start()`.
    Stop,
    /// Le stream cpal est mort (device débranché, erreur fatale) — le
    /// thread de capture doit le drop puis retenter init_stream en backoff.
    StreamDied(String),
}

fn reconnect_device_index(
    names: impl Iterator<Item = Option<String>>,
    expected: &str,
) -> Result<usize, String> {
    if expected.is_empty() {
        return Err("Audio input name is empty — cannot identify it safely".into());
    }
    let mut matches = names
        .enumerate()
        .filter_map(|(index, name)| (name.as_deref() == Some(expected)).then_some(index));
    let index = matches
        .next()
        .ok_or_else(|| format!("Audio input '{expected}' is unavailable"))?;
    if matches.next().is_some() {
        return Err(format!(
            "Audio input '{expected}' is ambiguous — cannot identify it safely"
        ));
    }
    Ok(index)
}

const CALLBACK_TIMEOUT_MS: u64 = 2_000;
const CAPTURE_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(250);

struct CaptureHeartbeat {
    epoch: std::time::Instant,
    last_callback_ms: AtomicU64,
    received_data: AtomicBool,
}

impl CaptureHeartbeat {
    fn new() -> Self {
        Self {
            epoch: std::time::Instant::now(),
            last_callback_ms: AtomicU64::new(0),
            received_data: AtomicBool::new(false),
        }
    }

    fn reset(&self) {
        self.last_callback_ms
            .store(self.now_ms(), Ordering::Relaxed);
        self.received_data.store(false, Ordering::Release);
    }

    fn now_ms(&self) -> u64 {
        self.epoch.elapsed().as_millis() as u64
    }

    fn record_data(&self) {
        self.last_callback_ms
            .store(self.now_ms(), Ordering::Relaxed);
        self.received_data.store(true, Ordering::Release);
    }

    fn stalled_at(&self, now_ms: u64) -> bool {
        now_ms.saturating_sub(self.last_callback_ms.load(Ordering::Relaxed)) >= CALLBACK_TIMEOUT_MS
    }
}

fn run_capture_thread(
    running: &AtomicBool,
    shared_state: &Mutex<AudioState>,
    last_error: &Mutex<Option<String>>,
    recovered: &AtomicBool,
    task: impl FnOnce(),
) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(task));
    running.store(false, Ordering::SeqCst);
    *shared_state.lock().unwrap_or_else(|e| e.into_inner()) = AudioState::new();
    recovered.store(false, Ordering::SeqCst);
    if result.is_err() {
        *last_error.lock().unwrap_or_else(|e| e.into_inner()) =
            Some("Audio capture thread panicked — restart capture".to_string());
    }
}

impl AudioCaptureManager {
    pub fn new() -> Self {
        AudioCaptureManager {
            shared_state: Arc::new(Mutex::new(AudioState::new())),
            running: Arc::new(AtomicBool::new(false)),
            sample_rate: Arc::new(Mutex::new(44100.0)),
            capture_thread: Arc::new(Mutex::new(None)),
            event_tx: Arc::new(Mutex::new(None)),
            last_error: Arc::new(Mutex::new(None)),
            recovered: Arc::new(AtomicBool::new(false)),
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
    ///
    /// Le stream cpal est construit **dans** le thread de capture (il n'est pas
    /// Send). Un oneshot channel rapporte le résultat de l'init pour que les
    /// erreurs remontent encore de façon synchrone à l'appelant.
    pub fn start(&self, device_id: Option<&str>) -> Result<(), AudioCaptureError> {
        // Si déjà en cours, stopper l'ancien stream proprement d'abord
        self.stop_internal();
        self.running.store(true, Ordering::SeqCst);
        self.recovered.store(false, Ordering::SeqCst);

        let device_id_owned = device_id.map(|s| s.to_string());
        let shared_state = self.shared_state.clone();
        let running = self.running.clone();
        let sample_rate_arc = self.sample_rate.clone();
        let last_error_arc = self.last_error.clone();
        let recovered_arc = self.recovered.clone();
        // Nouvelle tentative = erreur précédente consommée/obsolète
        *self.last_error.lock().unwrap_or_else(|e| e.into_inner()) = None;
        let (init_tx, init_rx) = std::sync::mpsc::channel::<Result<f64, String>>();
        let (event_tx, event_rx) = std::sync::mpsc::channel::<CaptureEvent>();
        let event_tx_thread = event_tx.clone();

        let handle = std::thread::spawn(move || {
            run_capture_thread(
                &running,
                &shared_state,
                &last_error_arc,
                &recovered_arc,
                || {
                    let heartbeat = Arc::new(CaptureHeartbeat::new());
                    let mut awaiting_recovery = false;
                    let mut device_name = None;
                    let mut stream = match Self::init_stream(
                        device_id_owned.as_deref(),
                        &running,
                        &shared_state,
                        event_tx_thread.clone(),
                        &heartbeat,
                        &mut device_name,
                    ) {
                        Ok((stream, rate)) => {
                            *sample_rate_arc.lock().unwrap_or_else(|e| e.into_inner()) = rate;
                            if init_tx.send(Ok(rate)).is_err() {
                                return; // l'appelant est parti
                            }
                            Some(stream)
                        }
                        Err(e) => {
                            let _ = init_tx.send(Err(e));
                            return;
                        }
                    };
                    // Boucle de vie : Stop → sortie ; StreamDied → drop + retries en
                    // backoff (500ms → 5s) tant que la capture reste demandée. Un
                    // device débranché/rebranché se reconnecte tout seul.
                    'outer: loop {
                        if !running.load(Ordering::SeqCst) {
                            break;
                        }
                        let event = match event_rx.recv_timeout(CAPTURE_POLL_INTERVAL) {
                            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                                if heartbeat.stalled_at(heartbeat.now_ms()) {
                                    Ok(CaptureEvent::StreamDied(
                                        "Audio data callback stalled for 2 seconds".into(),
                                    ))
                                } else {
                                    if awaiting_recovery
                                        && heartbeat.received_data.load(Ordering::Acquire)
                                    {
                                        *last_error_arc.lock().unwrap_or_else(|e| e.into_inner()) =
                                            None;
                                        recovered_arc.store(true, Ordering::SeqCst);
                                        awaiting_recovery = false;
                                    }
                                    continue;
                                }
                            }
                            event => event,
                        };
                        match event {
                            Err(_) | Ok(CaptureEvent::Stop) => break,
                            Ok(CaptureEvent::StreamDied(err)) => {
                                eprintln!("[WARN] Audio stream died: {err} — reconnecting");
                                recovered_arc.store(false, Ordering::SeqCst);
                                // État figé = influence fantôme dans les nodes audio :
                                // reset à zéro pendant la coupure.
                                *shared_state.lock().unwrap_or_else(|e| e.into_inner()) =
                                    AudioState::new();
                                *last_error_arc.lock().unwrap_or_else(|e| e.into_inner()) =
                                    Some(err);
                                drop(stream.take());
                                *shared_state.lock().unwrap_or_else(|e| e.into_inner()) =
                                    AudioState::new();
                                let mut backoff = std::time::Duration::from_millis(500);
                                loop {
                                    match event_rx.recv_timeout(backoff) {
                                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected)
                                        | Ok(CaptureEvent::Stop) => break 'outer,
                                        // Pas de stream vivant — un second StreamDied
                                        // est impossible, ignorer par robustesse.
                                        Ok(CaptureEvent::StreamDied(_)) => continue,
                                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                                            match Self::init_stream(
                                                device_id_owned.as_deref(),
                                                &running,
                                                &shared_state,
                                                event_tx_thread.clone(),
                                                &heartbeat,
                                                &mut device_name,
                                            ) {
                                                Ok((s, rate)) => {
                                                    stream = Some(s);
                                                    *sample_rate_arc
                                                        .lock()
                                                        .unwrap_or_else(|e| e.into_inner()) = rate;
                                                    awaiting_recovery = true;
                                                    eprintln!("[INFO] Audio capture reconnected");
                                                    continue 'outer;
                                                }
                                                Err(e) => {
                                                    eprintln!(
                                                "[WARN] Audio reconnect failed: {e} — retrying"
                                            );
                                                    backoff = (backoff * 2)
                                                        .min(std::time::Duration::from_secs(5));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    drop(stream);
                },
            );
        });

        *self
            .capture_thread
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(handle);
        *self.event_tx.lock().unwrap_or_else(|e| e.into_inner()) = Some(event_tx);

        // Attendre le résultat de l'init (borné : ne jamais bloquer l'appelant)
        match init_rx.recv_timeout(std::time::Duration::from_secs(5)) {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(e)) => {
                self.running.store(false, Ordering::SeqCst);
                Err(AudioCaptureError::BuildStreamError(e))
            }
            Err(_) => {
                self.running.store(false, Ordering::SeqCst);
                Err(AudioCaptureError::BuildStreamError(
                    "audio capture init timeout".to_string(),
                ))
            }
        }
    }

    /// Construit et démarre le stream dans le thread courant.
    /// Retourne (stream, sample_rate) — le stream doit être gardé vivant par l'appelant.
    fn init_stream(
        device_id: Option<&str>,
        running: &Arc<AtomicBool>,
        shared_state: &Arc<Mutex<AudioState>>,
        event_tx: std::sync::mpsc::Sender<CaptureEvent>,
        heartbeat: &Arc<CaptureHeartbeat>,
        resolved_name: &mut Option<String>,
    ) -> Result<(cpal::Stream, f64), String> {
        let host = cpal::default_host();
        let devices: Vec<_> = match host.devices() {
            Ok(d) => d.collect(),
            Err(e) => return Err(e.to_string()),
        };

        let device_names: Vec<_> = devices
            .iter()
            .map(|device| {
                device
                    .default_input_config()
                    .ok()
                    .and_then(|_| device.name().ok())
            })
            .collect();
        let device = if let Some(name) = resolved_name.as_deref() {
            let index = reconnect_device_index(device_names.iter().cloned(), name)?;
            devices
                .into_iter()
                .nth(index)
                .ok_or_else(|| format!("Audio input '{name}' is unavailable"))?
        } else {
            match device_id {
                Some(id) if id != "default" => {
                    let idx: usize = id.parse().map_err(|_| format!("device not found: {id}"))?;
                    devices
                        .into_iter()
                        .nth(idx)
                        .ok_or_else(|| format!("device not found: {id}"))?
                }
                _ => host
                    .default_input_device()
                    .ok_or_else(|| "no input device".to_string())?,
            }
        };
        let device_name = device
            .name()
            .map_err(|e| format!("Cannot identify audio input: {e}"))?;
        reconnect_device_index(device_names.into_iter(), &device_name)?;

        let supported_config = device.default_input_config().map_err(|e| e.to_string())?;
        let sample_rate = supported_config.sample_rate().0 as f64;
        let sample_format = supported_config.sample_format();

        let stream = match sample_format {
            SampleFormat::F32 => build_stream_generic(
                &device,
                &supported_config.into(),
                running,
                shared_state,
                event_tx.clone(),
                heartbeat,
                |s: f32| s as f64,
            ),
            SampleFormat::I16 => build_stream_generic(
                &device,
                &supported_config.into(),
                running,
                shared_state,
                event_tx.clone(),
                heartbeat,
                |s: i16| s as f64 / i16::MAX as f64,
            ),
            SampleFormat::U16 => build_stream_generic(
                &device,
                &supported_config.into(),
                running,
                shared_state,
                event_tx.clone(),
                heartbeat,
                |s: u16| (s as f64 - u16::MAX as f64 / 2.0) / (u16::MAX as f64 / 2.0),
            ),
            other => return Err(format!("unsupported sample format: {other:?}")),
        }
        .map_err(|e| e.to_string())?;

        heartbeat.reset();
        stream.play().map_err(|e| e.to_string())?;
        *resolved_name = Some(device_name);
        Ok((stream, sample_rate))
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
        // Signaler le stop au thread puis attendre la fin (drop du stream)
        if let Some(tx) = self
            .event_tx
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            let _ = tx.send(CaptureEvent::Stop);
        }
        if let Some(handle) = self
            .capture_thread
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            let _ = handle.join();
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

    /// Dernière erreur fatale du stream, s'il y en a une.
    pub fn last_error(&self) -> Option<String> {
        self.last_error
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Consomme la dernière erreur (une seule notification par erreur).
    /// Appelé par le poller audio pour émettre `audio-error` vers le frontend.
    pub fn take_error(&self) -> Option<String> {
        self.last_error
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
    }

    /// Consomme le flag de reconnexion réussie (une seule notification) —
    /// le poller émet `audio-recovered` vers le frontend.
    pub fn take_recovered(&self) -> bool {
        self.recovered.swap(false, Ordering::SeqCst)
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

/// Construit le stream d'entrée pour un format d'échantillon donné.
/// Fonction libre appelée dans le thread de capture (le stream n'est pas Send).
fn build_stream_generic<S, F>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    running: &Arc<AtomicBool>,
    shared_state: &Arc<Mutex<AudioState>>,
    event_tx: std::sync::mpsc::Sender<CaptureEvent>,
    heartbeat: &Arc<CaptureHeartbeat>,
    convert: F,
) -> Result<cpal::Stream, AudioCaptureError>
where
    S: cpal::Sample + cpal::SizedSample,
    F: Fn(S) -> f64 + Send + 'static,
{
    let sample_rate = config.sample_rate.0 as f64;
    // Nombre de canaux du device — les données arrivent entrelacées
    // (L R L R …). Sans mixdown, la FFT analyserait L/R alternés = spectre
    // incohérent. On mixe en mono (moyenne des canaux de chaque frame).
    let channels = (config.channels as usize).max(1);
    let fft_size = 1024usize;
    let hop_size = fft_size / 2;
    let shared_state = shared_state.clone();
    let running = running.clone();
    let heartbeat = heartbeat.clone();

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
            if !data.is_empty() {
                heartbeat.record_data();
            }

            // Mixdown multicanal → mono : moyenne des canaux par frame.
            // `chunks` gère le dernier frame partiel (data.len() % channels).
            for frame in data.chunks(channels) {
                let sum: f64 = frame.iter().map(|&s| convert(s)).sum();
                input_buf.push_back(sum / frame.len() as f64);
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
                    let spec_clone: Vec<f64> = spectrum.iter().map(|v| v.clamp(0.0, 1.0)).collect();
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
        // Erreur stream (ex: device débranché) — on notifie le thread de
        // capture qui drop le stream et retente init_stream en backoff ;
        // c'est lui qui publie `last_error`/`recovered` pour le poller.
        move |err| {
            let _ = event_tx.send(CaptureEvent::StreamDied(err.to_string()));
        },
        None,
    )?;

    Ok(stream)
}

fn hann_window(size: usize) -> Vec<f64> {
    (0..size)
        .map(|i| {
            let phase = 2.0 * std::f64::consts::PI * i as f64 / (size as f64 - 1.0);
            0.5 * (1.0 - phase.cos())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconnect_follows_device_name_after_reordering() {
        let names = [Some("Other".to_string()), Some("Selected".to_string())];
        assert_eq!(
            reconnect_device_index(names.into_iter(), "Selected").unwrap(),
            1
        );
        let names = [Some("Selected".to_string()), Some("Other".to_string())];
        assert_eq!(
            reconnect_device_index(names.into_iter(), "Selected").unwrap(),
            0
        );
    }

    #[test]
    fn reconnect_does_not_fall_back_to_another_input() {
        let names = [Some("Replacement at old index".to_string())];
        assert!(reconnect_device_index(names.into_iter(), "Selected").is_err());
        assert!(reconnect_device_index(std::iter::empty(), "Selected").is_err());
    }

    #[test]
    fn reconnect_rejects_ambiguous_device_names() {
        let names = [
            Some("Selected".to_string()),
            None,
            Some("Selected".to_string()),
        ];
        assert!(reconnect_device_index(names.into_iter(), "Selected").is_err());
    }

    #[test]
    fn reconnect_rejects_empty_names() {
        assert!(reconnect_device_index([Some(String::new())].into_iter(), "").is_err());
    }

    #[test]
    fn reconnect_ignores_unidentifiable_devices() {
        let names = [None, Some("Selected".to_string()), None];
        assert_eq!(
            reconnect_device_index(names.into_iter(), "Selected").unwrap(),
            1
        );
    }

    #[test]
    fn heartbeat_detects_missing_first_callback_and_stall() {
        let heartbeat = CaptureHeartbeat::new();
        assert!(!heartbeat.stalled_at(CALLBACK_TIMEOUT_MS - 1));
        assert!(heartbeat.stalled_at(CALLBACK_TIMEOUT_MS));
        heartbeat.last_callback_ms.store(700, Ordering::Relaxed);
        assert!(!heartbeat.stalled_at(700 + CALLBACK_TIMEOUT_MS - 1));
        assert!(heartbeat.stalled_at(700 + CALLBACK_TIMEOUT_MS));
    }

    #[test]
    fn heartbeat_tracks_silent_data_and_resets_recovery() {
        let heartbeat = CaptureHeartbeat::new();
        heartbeat.record_data();
        assert!(heartbeat.received_data.load(Ordering::Acquire));
        assert!(!heartbeat.stalled_at(heartbeat.now_ms()));
        heartbeat.reset();
        assert!(!heartbeat.received_data.load(Ordering::Acquire));
        assert!(!heartbeat.stalled_at(heartbeat.now_ms()));
    }

    #[test]
    fn capture_panic_clears_state_and_reports_failure() {
        let manager = AudioCaptureManager::new();
        manager.running.store(true, Ordering::SeqCst);
        manager.recovered.store(true, Ordering::SeqCst);
        manager.shared_state.lock().unwrap().amplitude = Some(AmplitudeData {
            rms: 1.0,
            bass: 1.0,
            mid: 1.0,
            high: 1.0,
        });
        run_capture_thread(
            &manager.running,
            &manager.shared_state,
            &manager.last_error,
            &manager.recovered,
            || {
                let _guard = manager.shared_state.lock().unwrap();
                panic!("simulated capture panic");
            },
        );
        assert!(!manager.is_running());
        assert!(manager.get_state().amplitude.is_none());
        assert!(!manager.take_recovered());
        assert!(manager.take_error().unwrap().contains("panicked"));
        assert!(manager.take_error().is_none());
    }

    #[test]
    fn normal_capture_exit_does_not_report_a_panic() {
        let manager = AudioCaptureManager::new();
        manager.running.store(true, Ordering::SeqCst);
        run_capture_thread(
            &manager.running,
            &manager.shared_state,
            &manager.last_error,
            &manager.recovered,
            || {},
        );
        assert!(!manager.is_running());
        assert!(manager.take_error().is_none());
    }
}
