use nalgebra::Vector3;
use serde::{Deserialize, Serialize};

/// Interface commune pour tous les falloffs
pub trait Falloff {
    /// Calcule l'influence [0, 1] à un instant t et une position
    fn influence(&self, t: f64, position: Vector3<f64>, context: &FalloffContext) -> f64;

    /// Nom du falloff
    fn name(&self) -> &str;
}

/// Contexte pour les falloffs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FalloffContext {
    pub duration: f64,
    pub n_objects: usize,
}

/// TimeFalloff : influence basée sur le temps
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeFalloff {
    pub start_time: f64,
    pub end_time: f64,
    pub curve: FalloffCurve,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FalloffCurve {
    Linear,
    EaseIn,
    EaseOut,
    EaseInOut,
}

impl Falloff for TimeFalloff {
    fn influence(&self, t: f64, _position: Vector3<f64>, _context: &FalloffContext) -> f64 {
        // Sémantique fade-in : 0 avant start_time, rampe dans
        // [start_time, end_time], puis influence tenue à 1 — retomber à 0
        // après end_time produisait une impulsion discontinue (snap des
        // positions à l'origine).
        if t < self.start_time {
            return 0.0;
        }
        if t >= self.end_time {
            return 1.0;
        }

        let span = self.end_time - self.start_time;
        // start == end est intercepté ci-dessus ; on borne quand même la
        // division pour les fenêtres quasi nulles (évite tout NaN).
        let progress = if span.abs() < 1e-10 {
            1.0
        } else {
            (t - self.start_time) / span
        };

        match self.curve {
            FalloffCurve::Linear => progress,
            FalloffCurve::EaseIn => progress * progress,
            FalloffCurve::EaseOut => 1.0 - (1.0 - progress) * (1.0 - progress),
            FalloffCurve::EaseInOut => {
                if progress < 0.5 {
                    2.0 * progress * progress
                } else {
                    1.0 - 2.0 * (1.0 - progress) * (1.0 - progress)
                }
            }
        }
    }

    fn name(&self) -> &str {
        "TimeFalloff"
    }
}

/// PointDistanceFalloff : influence basée sur la distance à un point
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PointDistanceFalloff {
    pub center: [f64; 3],
    pub max_distance: f64,
    pub curve: FalloffCurve,
}

impl PointDistanceFalloff {
    pub fn center_vector(&self) -> Vector3<f64> {
        Vector3::new(self.center[0], self.center[1], self.center[2])
    }
}

impl Falloff for PointDistanceFalloff {
    fn influence(&self, _t: f64, position: Vector3<f64>, _context: &FalloffContext) -> f64 {
        let center = self.center_vector();
        let distance = (position - center).norm();

        if distance >= self.max_distance {
            return 0.0;
        }

        let progress = 1.0 - (distance / self.max_distance);

        match self.curve {
            FalloffCurve::Linear => progress,
            FalloffCurve::EaseIn => progress * progress,
            FalloffCurve::EaseOut => 1.0 - (1.0 - progress) * (1.0 - progress),
            FalloffCurve::EaseInOut => {
                if progress < 0.5 {
                    2.0 * progress * progress
                } else {
                    1.0 - 2.0 * (1.0 - progress) * (1.0 - progress)
                }
            }
        }
    }

    fn name(&self) -> &str {
        "PointDistanceFalloff"
    }
}

/// DirectionalFalloff : influence basée sur la projection sur une direction
/// Retourne 1.0 du côté positif, 0.0 du côté négatif, avec une zone de transition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectionalFalloff {
    pub direction: [f64; 3],
    pub max_distance: f64,
    pub curve: FalloffCurve,
}

impl DirectionalFalloff {
    pub fn dir_vector(&self) -> Vector3<f64> {
        let d = Vector3::new(self.direction[0], self.direction[1], self.direction[2]);
        let norm = d.norm();
        if norm > 1e-10 {
            d / norm
        } else {
            Vector3::new(0.0, 0.0, 1.0)
        }
    }
}

impl Falloff for DirectionalFalloff {
    fn influence(&self, _t: f64, position: Vector3<f64>, _context: &FalloffContext) -> f64 {
        let dir = self.dir_vector();
        let projection = position.dot(&dir);

        if projection >= self.max_distance {
            return 1.0;
        }
        if projection <= -self.max_distance {
            return 0.0;
        }

        let progress = (projection + self.max_distance) / (2.0 * self.max_distance);

        match self.curve {
            FalloffCurve::Linear => progress,
            FalloffCurve::EaseIn => progress * progress,
            FalloffCurve::EaseOut => 1.0 - (1.0 - progress) * (1.0 - progress),
            FalloffCurve::EaseInOut => {
                if progress < 0.5 {
                    2.0 * progress * progress
                } else {
                    1.0 - 2.0 * (1.0 - progress) * (1.0 - progress)
                }
            }
        }
    }

    fn name(&self) -> &str {
        "DirectionalFalloff"
    }
}

/// AudioAmplitudeFalloff : influence basée sur l'amplitude audio en temps réel
/// L'amplitude (0..1) est injectée via le contexte audio global
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioAmplitudeFalloff {
    pub band: String, // "rms", "bass", "mid", "high"
    pub min_val: f64,
    pub max_val: f64,
    pub curve: FalloffCurve,
}

impl AudioAmplitudeFalloff {
    /// Calcule l'influence à partir d'une valeur d'amplitude donnée
    pub fn influence_from_value(&self, amplitude: f64) -> f64 {
        // f64::clamp panique si min > max — paramètres venant du frontend
        let (lo, hi) = if self.min_val <= self.max_val {
            (self.min_val, self.max_val)
        } else {
            (self.max_val, self.min_val)
        };
        let clamped = if amplitude.is_finite() {
            amplitude.clamp(lo, hi)
        } else {
            lo
        };
        let progress = if (hi - lo).abs() < 1e-10 {
            0.0
        } else {
            (clamped - lo) / (hi - lo)
        };

        match self.curve {
            FalloffCurve::Linear => progress,
            FalloffCurve::EaseIn => progress * progress,
            FalloffCurve::EaseOut => 1.0 - (1.0 - progress) * (1.0 - progress),
            FalloffCurve::EaseInOut => {
                if progress < 0.5 {
                    2.0 * progress * progress
                } else {
                    1.0 - 2.0 * (1.0 - progress) * (1.0 - progress)
                }
            }
        }
    }
}

impl Falloff for AudioAmplitudeFalloff {
    fn influence(&self, _t: f64, _position: Vector3<f64>, _context: &FalloffContext) -> f64 {
        // L'amplitude réelle est injectée par le runtime via influence_from_value
        // En l'absence de données audio, retourne 0
        0.0
    }

    fn name(&self) -> &str {
        "AudioAmplitudeFalloff"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::Vector3;

    #[test]
    fn test_time_falloff_linear() {
        let falloff = TimeFalloff {
            start_time: 1.0,
            end_time: 3.0,
            curve: FalloffCurve::Linear,
        };
        let context = FalloffContext {
            duration: 4.0,
            n_objects: 9,
        };

        // Avant le start_time
        assert_eq!(falloff.influence(0.5, Vector3::zeros(), &context), 0.0);

        // Pendant le falloff
        assert!((falloff.influence(2.0, Vector3::zeros(), &context) - 0.5).abs() < 0.01);

        // Après le end_time : influence tenue à 1 (sémantique fade-in —
        // retomber à 0 produisait une impulsion discontinue)
        assert_eq!(falloff.influence(4.0, Vector3::zeros(), &context), 1.0);
    }

    #[test]
    fn test_time_falloff_zero_width_window() {
        // Régression : start == end → division 0/0 → NaN
        let falloff = TimeFalloff {
            start_time: 2.0,
            end_time: 2.0,
            curve: FalloffCurve::Linear,
        };
        let context = FalloffContext {
            duration: 4.0,
            n_objects: 9,
        };
        assert_eq!(falloff.influence(1.0, Vector3::zeros(), &context), 0.0);
        let at = falloff.influence(2.0, Vector3::zeros(), &context);
        assert!(at.is_finite() && at == 1.0, "influence={at}");
        assert_eq!(falloff.influence(3.0, Vector3::zeros(), &context), 1.0);
    }

    #[test]
    fn test_time_falloff_ease_in() {
        let falloff = TimeFalloff {
            start_time: 1.0,
            end_time: 3.0,
            curve: FalloffCurve::EaseIn,
        };
        let context = FalloffContext {
            duration: 4.0,
            n_objects: 9,
        };

        // Au milieu (progress = 0.5), ease-in = 0.25
        let influence = falloff.influence(2.0, Vector3::zeros(), &context);
        assert!((influence - 0.25).abs() < 0.01);
    }

    #[test]
    fn test_point_distance_falloff() {
        let falloff = PointDistanceFalloff {
            center: [0.0, 0.0, 0.0],
            max_distance: 2.0,
            curve: FalloffCurve::Linear,
        };
        let context = FalloffContext {
            duration: 4.0,
            n_objects: 9,
        };

        // Au centre
        assert_eq!(
            falloff.influence(0.0, Vector3::new(0.0, 0.0, 0.0), &context),
            1.0
        );

        // À mi-distance
        assert!((falloff.influence(0.0, Vector3::new(1.0, 0.0, 0.0), &context) - 0.5).abs() < 0.01);

        // Au-delà de max_distance
        assert_eq!(
            falloff.influence(0.0, Vector3::new(3.0, 0.0, 0.0), &context),
            0.0
        );
    }
}
