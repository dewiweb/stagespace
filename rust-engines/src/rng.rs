//! Générateur pseudo-aléatoire déterministe partagé par les moteurs.
//!
//! Les moteurs doivent être des fonctions pures de `(t, object_index, params)` :
//! pour un même seed, la séquence produite est donc toujours identique, ce qui
//! garantit qu'un appel à `position(t, i, params)` est reproductible.

/// LCG 64 bits (constantes de Knuth / PCG), suffisant pour du bruit visuel.
pub struct SimpleRng {
    state: u64,
}

impl SimpleRng {
    pub fn new(seed: u64) -> Self {
        SimpleRng {
            state: seed.wrapping_add(1),
        }
    }

    /// Réel uniforme dans [0, 1)
    pub fn rand(&mut self) -> f64 {
        self.state = self.state.wrapping_mul(6364136223846793005).wrapping_add(1);
        // 31 bits de poids fort → [0, 1)
        ((self.state >> 33) as f64) / (1u64 << 31) as f64
    }

    /// Réel uniforme dans [min, max)
    pub fn uniform(&mut self, min: f64, max: f64) -> f64 {
        min + (max - min) * self.rand()
    }

    /// Tirage gaussien centré réduit (transformée de Box-Muller)
    pub fn randn(&mut self) -> f64 {
        // u1 est borné pour éviter ln(0) = -inf lorsque rand() retourne 0.0
        let u1 = self.rand().max(f64::MIN_POSITIVE);
        let u2 = self.rand();
        (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rand_in_unit_range() {
        let mut rng = SimpleRng::new(42);
        for _ in 0..1000 {
            let v = rng.rand();
            assert!((0.0..1.0).contains(&v), "rand() hors [0,1): {v}");
        }
    }

    #[test]
    fn test_deterministic_for_same_seed() {
        let mut a = SimpleRng::new(7);
        let mut b = SimpleRng::new(7);
        for _ in 0..100 {
            assert_eq!(a.rand(), b.rand());
        }
    }

    #[test]
    fn test_uniform_respects_bounds() {
        let mut rng = SimpleRng::new(1);
        for _ in 0..1000 {
            let v = rng.uniform(-0.3, 0.3);
            assert!((-0.3..0.3).contains(&v), "uniform() hors bornes: {v}");
        }
    }

    #[test]
    fn test_randn_is_finite() {
        // Régression : rand() peut retourner 0.0, ln(0) = -inf → sqrt(inf) = inf
        let mut rng = SimpleRng::new(0);
        for _ in 0..10_000 {
            assert!(rng.randn().is_finite());
        }
    }
}
