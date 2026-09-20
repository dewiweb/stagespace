//! État d'un move actif dans le MergeRuntime (fade in/out, weight, priority)

/// Stratégie de merge quand plusieurs moves ciblent le même track
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum MergeStrategy {
    /// Dernier move activé gagne (par poids/fade le plus élevé).
    /// Tie-break déterministe : move_id lexicographiquement le plus grand.
    #[default]
    Override,
    /// Blend linéaire pondéré par weight * fade
    Crossfade,
    /// Moyenne pondérée de toutes les positions
    Blend,
    /// Move avec la priorité la plus haute gagne
    /// (tie-breaks : fade puis move_id — déterministe)
    Priority,
}

/// État d'un move actif dans le MergeRuntime
#[derive(Debug, Clone)]
pub struct MoveState {
    pub osc_ids: Vec<u32>,
    pub track_indices: Vec<usize>,
    pub fade_in_remaining: f64,
    pub fade_out_remaining: f64,
    pub fade_in_duration: f64,
    pub fade_out_duration: f64,
    /// Poids du move — multiplie le fade dans le snapshot mergé
    /// (Crossfade/Blend "pondéré par weight * fade"). Défaut 1.0.
    pub weight: f64,
    pub is_active: bool,
    pub is_preview: bool,
    /// Priorité pour la stratégie Priority (plus élevé = gagne)
    pub priority: u32,
    /// Dernier `frame_count` observé sur le PositionBuffer du worker —
    /// lu à chaque frame du merge pour détecter les workers stale/morts.
    pub last_frame_count: u64,
    /// Nombre de frames de merge consécutives sans write du worker.
    /// Au-delà de la limite (cf. merge loop), le move est retiré.
    pub stale_frames: u32,
}

impl MoveState {
    pub fn new(osc_ids: Vec<u32>, track_indices: Vec<usize>, is_preview: bool) -> Self {
        MoveState {
            osc_ids,
            track_indices,
            fade_in_remaining: 0.0,
            fade_out_remaining: 0.0,
            fade_in_duration: 0.0,
            fade_out_duration: 0.0,
            weight: 1.0,
            is_active: true,
            is_preview,
            priority: 0,
            last_frame_count: 0,
            stale_frames: 0,
        }
    }

    /// Démarre un fade in.
    ///
    /// Réservé pour les fades d'entrée déclenchés par les cues/recall —
    /// le merge consomme `fade_in_remaining` via [`MoveState::update_fade`].
    /// Aujourd'hui aucun chemin de production ne l'appelle (les moves
    /// entrent à fade=1), mais l'API est conservée : `update_fade`
    /// implémente déjà la rampe d'entrée.
    pub fn start_fade_in(&mut self, duration: f64) {
        self.fade_in_duration = duration;
        self.fade_in_remaining = duration;
    }

    /// Démarre un fade out
    pub fn start_fade_out(&mut self, duration: f64) {
        self.fade_out_duration = duration;
        self.fade_out_remaining = duration;
    }

    /// Avance le fade d'un delta de temps. Retourne le facteur de fade actuel (0.0 → 1.0).
    ///
    /// `dt` est le temps réel mesuré entre deux frames du merge — pas le
    /// nominal `1/fps` — pour que les fades ne s'étirent pas sous jitter.
    pub fn update_fade(&mut self, dt: f64) -> f64 {
        let mut fade = 1.0;
        if self.fade_in_remaining > 0.0 {
            self.fade_in_remaining -= dt;
            let progress = 1.0 - (self.fade_in_remaining / self.fade_in_duration).clamp(0.0, 1.0);
            fade *= progress;
        }
        if self.fade_out_remaining > 0.0 {
            self.fade_out_remaining -= dt;
            if self.fade_out_remaining <= 0.0 {
                self.is_active = false;
                return 0.0;
            }
            let progress = (self.fade_out_remaining / self.fade_out_duration).clamp(0.0, 1.0);
            fade *= progress;
        }
        fade.clamp(0.0, 1.0)
    }

    /// Vrai si le move est en train de fader out
    pub fn is_fading_out(&self) -> bool {
        self.fade_out_remaining > 0.0
    }
}
