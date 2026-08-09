//! État d'un move actif dans le MergeRuntime (fade in/out, weight, priority)

/// Stratégie de merge quand plusieurs moves ciblent le même track
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum MergeStrategy {
    /// Dernier move activé gagne (par poids/fade le plus élevé)
    #[default]
    Override,
    /// Blend linéaire pondéré par weight * fade
    Crossfade,
    /// Moyenne pondérée de toutes les positions
    Blend,
    /// Move avec la priorité la plus haute gagne
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
    pub weight: f64,
    pub is_active: bool,
    pub is_preview: bool,
    /// Priorité pour la stratégie Priority (plus élevé = gagne)
    pub priority: u32,
    /// Frame count au dernier write — pour détecter les workers stale
    pub last_frame_count: u64,
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
        }
    }

    /// Démarre un fade in
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
