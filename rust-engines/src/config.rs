use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Configuration de STAGESPACE
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Configuration du runtime
    pub runtime: RuntimeConfig,
    /// Configuration OSC
    pub osc: OscConfig,
    /// Configuration audio
    pub audio: AudioConfig,
    /// Configuration du graphe
    pub graph: GraphConfig,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            runtime: RuntimeConfig::default(),
            osc: OscConfig::default(),
            audio: AudioConfig::default(),
            graph: GraphConfig::default(),
        }
    }
}

/// Configuration du runtime
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeConfig {
    /// FPS par défaut
    pub default_fps: f64,
    /// Durée par défaut (secondes)
    pub default_duration: f64,
    /// Nombre maximum d'objets
    pub max_objects: usize,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            default_fps: 60.0,
            default_duration: 4.0,
            max_objects: 1024,
        }
    }
}

/// Configuration OSC
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OscConfig {
    /// Adresse par défaut
    pub default_address: String,
    /// Port par défaut
    pub default_port: u16,
    /// Profil par défaut
    pub default_profile: String,
    /// Offset d'objet par défaut
    pub default_object_offset: u32,
}

impl Default for OscConfig {
    fn default() -> Self {
        Self {
            default_address: "127.0.0.1".to_string(),
            default_port: 9000,
            default_profile: "generic".to_string(),
            default_object_offset: 0,
        }
    }
}

/// Configuration audio
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioConfig {
    /// Source par défaut
    pub default_source: String,
    /// Fréquence d'échantillonnage
    pub sample_rate: u32,
    /// Taille du buffer FFT
    pub fft_size: usize,
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            default_source: "microphone".to_string(),
            sample_rate: 44100,
            fft_size: 1024,
        }
    }
}

/// Configuration du graphe
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphConfig {
    /// Nombre maximum de nœuds
    pub max_nodes: usize,
    /// Nombre maximum d'arêtes
    pub max_edges: usize,
    /// Activation de la validation automatique
    pub auto_validate: bool,
}

impl Default for GraphConfig {
    fn default() -> Self {
        Self {
            max_nodes: 1000,
            max_edges: 5000,
            auto_validate: true,
        }
    }
}

impl Config {
    /// Charge la configuration depuis un fichier
    pub fn load_from_file(path: &PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(path)?;
        let config: Config = serde_json::from_str(&content)?;
        Ok(config)
    }

    /// Sauvegarde la configuration dans un fichier
    pub fn save_to_file(&self, path: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }

    /// Retourne la configuration par défaut
    pub fn default_config() -> Self {
        Self::default()
    }
}
