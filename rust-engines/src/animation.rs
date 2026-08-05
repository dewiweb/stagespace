use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Type de shape — correspond aux engines disponibles
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ShapeType {
    #[default]
    Circle,
    Elliptical,
    Spiral,
    Lissajous,
    Figure8,
    Linear,
    Oscillation,
    PerlinNoise,
    Formation,
    Converge,
    Pendulum,
    RoseCurve,
    Helix,
    Custom, // graphe expert
}

/// Direction de lecture
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum Direction {
    #[default]
    Forward,
    Backward,
    PingPong,
}

/// Mode de loop
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum AnimationLoopMode {
    #[default]
    Loop,
    OneShot,
}

/// Source audio pour un AudioMod
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AudioModSource {
    Bpm,
    AmplitudeRms,
    AmplitudeBass,
    AmplitudeMid,
    AmplitudeHigh,
    SpectrumBand(usize), // index de bande FFT
}

/// Cible d'un AudioMod — quel macro est modulé
/// Tous les targets sont des macros (appliqués par le runtime en post-engine)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AudioModTarget {
    Speed,
    Scale,
    RadiusScale,
    HeightOffset,
    OffsetX,
    OffsetY,
    OffsetZ,
    Yaw,
    Pitch,
    Roll,
}

/// Un mod audio = "la musique modifie ce paramètre"
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioMod {
    pub source: AudioModSource,
    pub target: AudioModTarget,
    /// Combien l'audio influence le paramètre (0.0 = aucun effet, 1.0 = effet max)
    pub amount: f64,
    /// Valeur de base du paramètre (sans modulation) — le runtime fait base + amount * audio_value
    pub base_value: f64,
    /// Lissage du signal (0.0 = brut, 1.0 = très lissé)
    #[serde(default = "default_smoothing")]
    pub smoothing: f64,
}

fn default_smoothing() -> f64 {
    0.3
}

/// Assignment d'une track à une animation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackAssignment {
    pub track_id: u32,
    /// 0.0 = la track ne bouge pas, 1.0 = la track suit la trajectoire à 100%
    #[serde(default = "default_depth")]
    pub depth: f64,
    /// Décalage de phase dans le cycle (0° à 360°)
    #[serde(default)]
    pub phase_offset: f64,
}

fn default_depth() -> f64 {
    1.0
}

/// Une animation = un mouvement vivant
/// C'est le modèle central de STAGESPACE — remplace le Cue basé sur le graphe
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Animation {
    pub id: String,
    pub name: String,

    // ── Shape : la forme du mouvement (obsolète — gardé pour compat sérialisation)
    #[serde(default)]
    pub shape: ShapeType,
    /// Paramètres spécifiques au shape (radius, turns, etc.) — obsolète
    #[serde(default)]
    pub shape_params: HashMap<String, f64>,

    // ── Perform : comment ça joue
    #[serde(default = "default_speed")]
    pub speed: f64,
    #[serde(default = "default_duration")]
    pub duration: f64,
    #[serde(default)]
    pub direction: Direction,
    #[serde(default)]
    pub loop_mode: AnimationLoopMode,

    // ── Transform : position/rotation globale (= macros)
    #[serde(default = "default_scale")]
    pub scale: f64,
    #[serde(default)]
    pub yaw: f64,
    #[serde(default)]
    pub pitch: f64,
    #[serde(default)]
    pub roll: f64,
    #[serde(default)]
    pub offset_x: f64,
    #[serde(default)]
    pub offset_y: f64,
    #[serde(default)]
    pub offset_z: f64,

    // ── Assignments : qui bouge, comment
    #[serde(default)]
    pub assignments: Vec<TrackAssignment>,
    /// 0.0 = pas de spread, 1.0 = tracks réparties uniformément sur le cycle
    #[serde(default)]
    pub phase_spread: f64,

    // ── Audio reactive : ce qui respire avec la musique
    #[serde(default)]
    pub audio_mods: Vec<AudioMod>,

    // ── Graphe expert (toujours présent — remplace shape/shape_params)
    #[serde(default = "default_graph_json")]
    pub graph_json: serde_json::Value,

    // ── Fade
    #[serde(default = "default_fade")]
    pub fade_in: f64,
    #[serde(default = "default_fade")]
    pub fade_out: f64,
}

fn default_speed() -> f64 {
    1.0
}
fn default_duration() -> f64 {
    4.0
}
fn default_scale() -> f64 {
    1.0
}
fn default_fade() -> f64 {
    0.5
}
fn default_graph_json() -> serde_json::Value {
    serde_json::json!({})
}

impl Default for Animation {
    fn default() -> Self {
        Animation {
            id: String::new(),
            name: "Animation".to_string(),
            shape: ShapeType::default(),
            shape_params: HashMap::new(),
            speed: default_speed(),
            duration: default_duration(),
            direction: Direction::default(),
            loop_mode: AnimationLoopMode::default(),
            scale: default_scale(),
            yaw: 0.0,
            pitch: 0.0,
            roll: 0.0,
            offset_x: 0.0,
            offset_y: 0.0,
            offset_z: 0.0,
            assignments: Vec::new(),
            phase_spread: 0.0,
            audio_mods: Vec::new(),
            graph_json: default_graph_json(),
            fade_in: default_fade(),
            fade_out: default_fade(),
        }
    }
}

/// État d'exécution d'une animation — ce que le runtime lit à chaque frame
/// Dérivé de l'Animation au moment du launch, puis modifiable en temps réel
#[derive(Debug, Clone)]
pub struct AnimationState {
    // Per-track : depth et phase_offset
    pub track_depths: Vec<f64>,
    pub track_phase_offsets: Vec<f64>,

    // Audio mods actifs
    pub audio_mods: Vec<AudioMod>,

    // Smoothing state pour chaque audio mod
    pub smoothed_values: Vec<f64>,
}

impl AnimationState {
    /// Construit l'état d'exécution à partir d'une Animation + la liste des track_ids ciblées
    pub fn from_animation(anim: &Animation, track_ids: &[u32]) -> Self {
        let n = track_ids.len();
        let mut track_depths = vec![1.0; n];
        let mut track_phase_offsets = vec![0.0; n];

        // Appliquer les assignments
        for (i, &tid) in track_ids.iter().enumerate() {
            if let Some(asg) = anim.assignments.iter().find(|a| a.track_id == tid) {
                track_depths[i] = asg.depth;
                track_phase_offsets[i] = asg.phase_offset;
            }
        }

        // Appliquer phase_spread : répartir les tracks uniformément sur le cycle
        if anim.phase_spread > 0.0 && n > 1 {
            for (i, phase_offset) in track_phase_offsets.iter_mut().enumerate() {
                let spread_fraction = i as f64 / (n as f64);
                // Le spread ajoute un offset proportionnel
                *phase_offset += spread_fraction * 360.0 * anim.phase_spread;
            }
        }

        let audio_mods = anim.audio_mods.clone();
        let smoothed_values = vec![0.0; audio_mods.len()];

        AnimationState {
            track_depths,
            track_phase_offsets,
            audio_mods,
            smoothed_values,
        }
    }

    /// Récupère la valeur audio pour un AudioModSource donné
    fn get_audio_value(source: &AudioModSource, audio: &crate::audio::AudioState) -> f64 {
        match source {
            AudioModSource::Bpm => audio.bpm.as_ref().map(|b| b.bpm / 120.0).unwrap_or(1.0),
            AudioModSource::AmplitudeRms => audio.amplitude.as_ref().map(|a| a.rms).unwrap_or(0.0),
            AudioModSource::AmplitudeBass => {
                audio.amplitude.as_ref().map(|a| a.bass).unwrap_or(0.0)
            }
            AudioModSource::AmplitudeMid => audio.amplitude.as_ref().map(|a| a.mid).unwrap_or(0.0),
            AudioModSource::AmplitudeHigh => {
                audio.amplitude.as_ref().map(|a| a.high).unwrap_or(0.0)
            }
            AudioModSource::SpectrumBand(idx) => audio
                .spectrum
                .as_ref()
                .and_then(|s| s.spectrum.get(*idx).copied())
                .unwrap_or(0.0),
        }
    }

    /// Calcule les deltas audio pour chaque macro à un instant donné.
    ///
    /// Philosophie : les audio mods produisent un DELTA (un ajout) qui s'additionne
    /// à la macro de base. Le runtime fait : macro_effective = macro_base + audio_delta.
    ///
    /// Pour radius_scale et scale (qui sont multiplicatifs), le delta est additif
    /// sur le multiplicateur : scale_effective = scale_base + audio_delta
    /// (ex: scale_base=1.0, audio_delta=0.3 → scale_effective=1.3)
    ///
    /// Retourne un HashMap<macro_key, delta_value>
    pub fn compute_audio_modulated_params(
        &mut self,
        audio: &crate::audio::AudioState,
    ) -> HashMap<String, f64> {
        let mut result = HashMap::new();

        for (i, mod_) in self.audio_mods.iter().enumerate() {
            let raw_value = Self::get_audio_value(&mod_.source, audio);

            // Appliquer le smoothing
            let smooth_factor = mod_.smoothing.clamp(0.0, 0.95);
            self.smoothed_values[i] =
                self.smoothed_values[i] * smooth_factor + raw_value * (1.0 - smooth_factor);

            let smoothed = self.smoothed_values[i];

            // Le delta = amount * audio_value (la base est la macro elle-même)
            let delta = mod_.amount * smoothed;

            let key = match &mod_.target {
                AudioModTarget::Speed => "speed",
                AudioModTarget::Scale => "scale",
                AudioModTarget::RadiusScale => "radius_scale",
                AudioModTarget::HeightOffset => "height_offset",
                AudioModTarget::OffsetX => "offset_x",
                AudioModTarget::OffsetY => "offset_y",
                AudioModTarget::OffsetZ => "offset_z",
                AudioModTarget::Yaw => "yaw",
                AudioModTarget::Pitch => "pitch",
                AudioModTarget::Roll => "roll",
            };
            // Accumuler les deltas si plusieurs mods ciblent la même macro
            let entry = result.entry(key.to_string()).or_insert(0.0);
            *entry += delta;
        }

        result
    }
}
