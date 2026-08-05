use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Données BPM
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BPMData {
    pub bpm: f64,
    pub confidence: f64,
    pub last_beat_time: f64,
}

/// Sources audio disponibles
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AudioSource {
    Microphone,
    File(String),
    Stream(String),
}

/// Données d'amplitude audio
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AmplitudeData {
    pub rms: f64,
    pub bass: f64,
    pub mid: f64,
    pub high: f64,
}

/// Données de spectre audio
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpectrumData {
    pub spectrum: Vec<f64>,
    pub fft_size: usize,
}

/// État audio
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioState {
    pub bpm: Option<BPMData>,
    pub amplitude: Option<AmplitudeData>,
    pub spectrum: Option<SpectrumData>,
}

impl AudioState {
    pub fn new() -> Self {
        AudioState {
            bpm: None,
            amplitude: None,
            spectrum: None,
        }
    }
}

impl Default for AudioState {
    fn default() -> Self {
        Self::new()
    }
}

/// Binding audio vers macro
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioBinding {
    pub source: AudioSource,
    pub macro_name: String,
    pub min_val: f64,
    pub max_val: f64,
    pub smooth: f64,
}

/// Audio Reactor - gère les bindings audio
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioReactor {
    pub bindings: HashMap<String, AudioBinding>,
    pub current_frame: Option<AudioFrame>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioFrame {
    pub rms: f64,
    pub bass: f64,
    pub mid: f64,
    pub high: f64,
    pub spectrum: Vec<f64>,
}

impl AudioReactor {
    pub fn new() -> Self {
        AudioReactor {
            bindings: HashMap::new(),
            current_frame: None,
        }
    }

    pub fn add_binding(&mut self, binding: AudioBinding) {
        let key = format!("{:?}-{}", binding.source, binding.macro_name);
        self.bindings.insert(key, binding);
    }

    pub fn remove_binding(&mut self, source: &AudioSource, macro_name: &str) {
        let key = format!("{source:?}-{macro_name}");
        self.bindings.remove(&key);
    }

    pub fn update(&mut self, frame: AudioFrame) {
        self.current_frame = Some(frame);
    }

    pub fn get_binding_value(&self, macro_name: &str) -> Option<f64> {
        // Trouver le binding pour cette macro
        for binding in self.bindings.values() {
            if binding.macro_name == macro_name {
                if let Some(frame) = &self.current_frame {
                    let value = match binding.source {
                        AudioSource::Microphone => frame.rms,
                        AudioSource::File(_) => frame.rms,
                        AudioSource::Stream(_) => frame.rms,
                    };
                    // Appliquer min/max/smoothing
                    let normalized =
                        (value - binding.min_val) / (binding.max_val - binding.min_val);
                    return Some(normalized.clamp(0.0, 1.0));
                }
            }
        }
        None
    }

    pub fn list_bindings(&self) -> Vec<AudioBinding> {
        self.bindings.values().cloned().collect()
    }

    pub fn clear_bindings(&mut self) {
        self.bindings.clear();
    }
}

impl Default for AudioReactor {
    fn default() -> Self {
        Self::new()
    }
}
