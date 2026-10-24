/// Fonction de position compilée — hot-swappable pour cue recall
/// Fonction de position compilée — `Arc` (pas `Box`) : clonable à coût
/// nul pour que le worker évalue la frame SANS tenir le mutex de swap
/// (audit I8 — sinon recall/sample attendent la fin du frame entier).
pub type PositionFn = std::sync::Arc<dyn Fn(f64, usize) -> nalgebra::Vector3<f64> + Send + Sync>;

/// Callback appelé à chaque frame avec les positions calculées
pub type PositionCallback = Box<dyn Fn(f64, Vec<(usize, nalgebra::Vector3<f64>)>) + Send + Sync>;

/// Contexte passé à la fonction de post-processing (graph global)
pub struct PostProcessContext<'a> {
    /// Temps écoulé depuis le démarrage du MergeRuntime
    pub t: f64,
    /// Macros spatiales (scale, rotation, shift, radius_scale, height_offset)
    pub macros: &'a crate::runtime::MacroState,
    /// Audio state (pour AudioFalloff)
    pub audio_state: &'a crate::audio::AudioState,
    /// Positions des tracks .hol (pour Barycenter) — track_id → [x, y, z]
    pub track_positions: &'a std::collections::HashMap<u32, [f64; 3]>,
    /// Positions manuelles (pour ManualPosition) — object_index → [x, y, z]
    pub manual_positions: &'a std::collections::HashMap<usize, [f64; 3]>,
    /// Origin (isobarycentre des tracks)
    pub origin: nalgebra::Vector3<f64>,
    /// Profondeurs par track (pour PerTrackDepth)
    pub track_depths: &'a [f64],
}

/// Fonction de post-processing compilée depuis le graph global.
///
/// Prend les positions mergées (tous les moves confondus) et applique
/// les transformations du graph global (Scale, Rotate, Shift, RadiusScale,
/// HeightOffset, PerTrackDepth, Barycenter, AudioFalloff, ManualPosition).
///
/// Hot-swappable pour mise à jour temps réel du graph global.
pub type PostProcessFn = Box<
    dyn Fn(
            &PostProcessContext,
            Vec<(usize, nalgebra::Vector3<f64>)>,
        ) -> Vec<(usize, nalgebra::Vector3<f64>)>
        + Send
        + Sync,
>;

/// Mode de loop
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LoopMode {
    /// Loop infini — t = t % duration (pour live)
    Loop,
    /// One-shot — s'arrête à la fin de duration
    OneShot,
}

/// Direction de lecture
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PlayDirection {
    /// Forward — t augmente normalement
    Forward,
    /// Backward — t décroît (t = duration - t)
    Backward,
    /// Ping-pong — alterne forward et backward
    PingPong,
}

/// Stats de performance — lues à chaque frame
#[derive(Debug, Clone, Default, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PerfStats {
    pub fps: f64,
    pub osc_rate: f64,
    pub latency_ms: f64,
    pub cpu_percent: f64,
    /// Taux d'erreur OSC (0.0 = parfait, 1.0 = tout échoue)
    pub osc_error_rate: f64,
    /// Fraction des envois rejetés en ECONNREFUSED (destination injoignable —
    /// typiquement : aucun listener sur le port cible, ICMP port-unreachable).
    /// Sous-ensemble de osc_error_rate, distinct du packet loss réseau.
    pub osc_refused_rate: f64,
    /// Circuit-breaker OSC ouvert — sends suspendus (merge + preview
    /// continuent), sonde de reconnexion à 1 Hz. Renderer down.
    pub osc_suspended: bool,
    /// Durée de travail de la dernière frame de merge (µs) — merge +
    /// sends + perf, hors sleep de pacing. Jauge le coût réel du hot-path.
    pub merge_frame_us: f64,
}
