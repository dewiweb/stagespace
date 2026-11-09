//! Types publics du routing OSC IN — extrait de osc_receiver.rs (Phase 5).

use super::*;

/// Profondeur max d'imbrication des bundles OSC — au-delà, le packet est
/// droppé (protection contre les bundles récursifs malveillants).
pub(crate) const MAX_BUNDLE_DEPTH: usize = 8;

/// Nombre max de clés de feedback (`last_values`) — borne mémoire : les clés
/// incluent l'index d'objet résolu, donc un mapping wildcard recevant des ids
/// arbitraires (/track/*/gain) pourrait faire croître la map sans limite.
pub(crate) const MAX_FEEDBACK_KEYS: usize = 4096;

// ─── Transform ──────────────────────────────────────────────────────────────

/// Transformation appliquée à chaque valeur OSC entrante.
/// Ordre : deadzone → `v * scale + offset` → clamp [min, max] → lissage.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Transform {
    pub scale: f64,
    pub offset: f64,
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// Lissage one-pole [0, 1) — 0 = brut, 0.9 = très lissé (état par mapping)
    pub smooth: f64,
    /// Deadzone sur la valeur brute : |v| < deadzone → 0 (joysticks, pads)
    pub deadzone: f64,
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            scale: 1.0,
            offset: 0.0,
            min: None,
            max: None,
            smooth: 0.0,
            deadzone: 0.0,
        }
    }
}

impl Transform {
    /// deadzone → affine → clamp (le lissage est appliqué par le receiver,
    /// qui détient l'état par mapping)
    pub fn apply(&self, v: f64) -> f64 {
        let mut v = v;
        if v.abs() < self.deadzone {
            v = 0.0;
        }
        let v = v * self.scale + self.offset;
        match (self.min, self.max) {
            (Some(min), Some(max)) => v.clamp(min, max),
            (Some(min), None) => v.max(min),
            (None, Some(max)) => v.min(max),
            (None, None) => v,
        }
    }

    pub(crate) fn validate(&self) -> Result<(), String> {
        if !(0.0..1.0).contains(&self.smooth) {
            return Err(format!("smooth must be in [0, 1), got {}", self.smooth));
        }
        if self.deadzone < 0.0 {
            return Err(format!("deadzone must be >= 0, got {}", self.deadzone));
        }
        if let (Some(min), Some(max)) = (self.min, self.max) {
            if min > max {
                return Err(format!("min ({min}) > max ({max})"));
            }
        }
        Ok(())
    }
}

// ─── Destinations ───────────────────────────────────────────────────────────

/// Référence à un objet cible : index fixe ou segment wildcard de l'adresse.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export)]
pub enum ObjectRef {
    /// Index fixe dans la liste des objets (même convention que set-channel)
    Index(usize),
    /// `"*"` = premier wildcard de l'adresse, `"*1"` = deuxième, etc.
    /// Le segment capturé est parsé comme usize.
    Wildcard(String),
}

impl ObjectRef {
    fn wildcard_index(&self) -> Option<usize> {
        match self {
            ObjectRef::Index(_) => None,
            ObjectRef::Wildcard(w) => Some(w.trim_start_matches('*').parse().unwrap_or(0)),
        }
    }

    /// Résout l'index d'objet à partir des segments capturés par les wildcards.
    /// Retourne None si le segment capturé n'est pas un entier.
    pub fn resolve(&self, captures: &[String]) -> Option<usize> {
        match self {
            ObjectRef::Index(i) => Some(*i),
            ObjectRef::Wildcard(_) => captures.get(self.wildcard_index()?)?.parse::<usize>().ok(),
        }
    }
}

/// Macros spatiales du MergeRuntime pilotables par OSC IN.
/// (`speed` est exclu — il est per-move, pas global.)
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MacroTarget {
    Scale,
    ShiftX,
    ShiftY,
    ShiftZ,
    Yaw,
    Pitch,
    Roll,
    RadiusScale,
    HeightOffset,
}

impl FromStr for MacroTarget {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "scale" => Ok(MacroTarget::Scale),
            "shift_x" | "shiftx" => Ok(MacroTarget::ShiftX),
            "shift_y" | "shifty" => Ok(MacroTarget::ShiftY),
            "shift_z" | "shiftz" => Ok(MacroTarget::ShiftZ),
            "yaw" => Ok(MacroTarget::Yaw),
            "pitch" => Ok(MacroTarget::Pitch),
            "roll" => Ok(MacroTarget::Roll),
            "radius_scale" | "radiusscale" | "radius" => Ok(MacroTarget::RadiusScale),
            "height_offset" | "heightoffset" | "height" => Ok(MacroTarget::HeightOffset),
            _ => Err(format!(
                "Unknown macro target: {s} (scale|shift_x|shift_y|shift_z|yaw|pitch|roll|radius_scale|height_offset)"
            )),
        }
    }
}

impl MacroTarget {
    /// Écrit la valeur dans l'atomic correspondant (lock-free)
    pub(crate) fn apply(&self, macros: &MacroState, v: f64) {
        let field = match self {
            MacroTarget::Scale => &macros.scale,
            MacroTarget::ShiftX => &macros.shift_x,
            MacroTarget::ShiftY => &macros.shift_y,
            MacroTarget::ShiftZ => &macros.shift_z,
            MacroTarget::Yaw => &macros.yaw,
            MacroTarget::Pitch => &macros.pitch,
            MacroTarget::Roll => &macros.roll,
            MacroTarget::RadiusScale => &macros.radius_scale,
            MacroTarget::HeightOffset => &macros.height_offset,
        };
        field.store(v.to_bits(), Ordering::Relaxed);
    }

    fn name(&self) -> &'static str {
        match self {
            MacroTarget::Scale => "scale",
            MacroTarget::ShiftX => "shift_x",
            MacroTarget::ShiftY => "shift_y",
            MacroTarget::ShiftZ => "shift_z",
            MacroTarget::Yaw => "yaw",
            MacroTarget::Pitch => "pitch",
            MacroTarget::Roll => "roll",
            MacroTarget::RadiusScale => "radius_scale",
            MacroTarget::HeightOffset => "height_offset",
        }
    }
}

/// Destination d'un mapping OSC IN.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum MappingDestination {
    /// Stockage passif — valeur lisible via get_last_value / get_all_values
    /// (polling par le frontend ou injection manuelle dans le graphe)
    Handler { name: String },
    /// Macro spatiale globale du MergeRuntime (scale, shift_*, yaw, pitch,
    /// roll, radius_scale, height_offset)
    Macro { name: MacroTarget },
    /// Canal spatial étendu d'un objet (gain, spread, distance, presence,
    /// yaw, aperture, lfe)
    Channel {
        channel: SpatialChannel,
        object: ObjectRef,
    },
    /// Position manuelle d'un objet — nécessite au moins 3 valeurs (x, y, z)
    Position { object: ObjectRef },
}

impl MappingDestination {
    /// Clé sous laquelle la dernière valeur reçue est stockée dans last_values
    /// (feedback UI / polling). Inclut l'index résolu quand il est disponible.
    pub(crate) fn feedback_key(&self, captures: &[String]) -> String {
        let obj = |o: &ObjectRef| match o {
            ObjectRef::Index(i) => i.to_string(),
            ObjectRef::Wildcard(w) => o
                .resolve(captures)
                .map(|i| i.to_string())
                .unwrap_or_else(|| w.clone()),
        };
        match self {
            MappingDestination::Handler { name } => name.clone(),
            MappingDestination::Macro { name } => format!("macro:{}", name.name()),
            MappingDestination::Channel { channel, object } => {
                format!("channel:{channel:?}:{}", obj(object))
            }
            MappingDestination::Position { object } => format!("position:{}", obj(object)),
        }
    }
}

/// Mapping OSC → destination avec transform.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OscMapping {
    /// Adresse OSC — `*` matche exactement un segment (capturé pour
    /// [`ObjectRef::Wildcard`])
    pub address: String,
    pub destination: MappingDestination,
    #[serde(default)]
    pub transform: Transform,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

// ─── Targets ────────────────────────────────────────────────────────────────

/// Canaux spatiaux partagés (object_index → SpatialChannels)
pub type SharedChannels = Arc<RwLock<HashMap<usize, SpatialChannels>>>;
/// Positions manuelles partagées (object_index → [x, y, z])
pub type SharedPositions = Arc<RwLock<HashMap<usize, [f64; 3]>>>;

/// Points de sortie du routing OSC IN — Arcs partagés avec le MergeRuntime.
/// Le receiver écrit directement dedans depuis son thread ; le merge thread
/// les lit normalement — aucun lock supplémentaire dans son chemin temps réel.
#[derive(Clone, Default)]
pub struct OscInTargets {
    pub macros: Option<Arc<MacroState>>,
    pub object_channels: Option<SharedChannels>,
    pub manual_positions: Option<SharedPositions>,
}

impl std::fmt::Debug for OscInTargets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OscInTargets")
            .field("macros", &self.macros.is_some())
            .field("object_channels", &self.object_channels.is_some())
            .field("manual_positions", &self.manual_positions.is_some())
            .finish()
    }
}

/// Statistiques du pipeline OSC IN (pour monitoring live)
#[derive(Debug, Default)]
pub struct OscInStats {
    pub packets_received: AtomicU64,
    pub messages_matched: AtomicU64,
    pub values_routed: AtomicU64,
    pub messages_dropped: AtomicU64,
    /// Datagrams UDP reçus mais indécodables (malformés / non-OSC) —
    /// avant : silencieusement ignorés.
    pub decode_errors: AtomicU64,
}

/// Snapshot sérialisable des stats
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OscInStatsSnapshot {
    #[ts(type = "number")]
    pub packets_received: u64,
    #[ts(type = "number")]
    pub messages_matched: u64,
    #[ts(type = "number")]
    pub values_routed: u64,
    #[ts(type = "number")]
    pub messages_dropped: u64,
    #[ts(type = "number")]
    pub decode_errors: u64,
}
