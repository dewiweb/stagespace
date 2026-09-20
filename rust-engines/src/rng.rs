//! Générateur pseudo-aléatoire déterministe partagé par les moteurs.
//!
//! Les moteurs doivent être des fonctions pures de `(t, object_index, params)` :
//! pour un même seed, la séquence produite est donc toujours identique, ce qui
//! garantit qu'un appel à `position(t, i, params)` est reproductible.

/// LCG 64 bits (constantes de Knuth / PCG), suffisant pour du bruit visuel.
pub struct SimpleRng {
    state: u64,
    /// Seconde variate de Box-Muller mise de côté (voir [`Self::randn`]).
    spare_gauss: Option<f64>,
}

impl SimpleRng {
    pub fn new(seed: u64) -> Self {
        SimpleRng {
            state: seed.wrapping_add(1),
            spare_gauss: None,
        }
    }

    /// Réel uniforme dans [0, 1)
    pub fn rand(&mut self) -> f64 {
        self.state = self.state.wrapping_mul(6364136223846793005).wrapping_add(1);
        // 31 bits de poids fort → [0, 1)
        ((self.state >> 33) as f64) / (1u64 << 31) as f64
    }

    /// Réel uniforme dans [min, max)
    ///
    /// Note : `min > max` n'est pas une erreur — l'intervalle est simplement
    /// inversé (la pente `(max - min)` devient négative et le tirage tombe
    /// dans `[max, min)`). Toléré volontairement : les paramètres venant du
    /// frontend ne doivent pas pouvoir faire paniquer le moteur.
    pub fn uniform(&mut self, min: f64, max: f64) -> f64 {
        min + (max - min) * self.rand()
    }

    /// Tirage gaussien centré réduit (transformée de Box-Muller).
    ///
    /// Box-Muller produit DEUX variates indépendantes : la seconde est mise en
    /// cache et servie à l'appel suivant (une paire de tirages `rand` économisée
    /// sur deux).
    pub fn randn(&mut self) -> f64 {
        if let Some(spare) = self.spare_gauss.take() {
            return spare;
        }
        // u1 est borné pour éviter ln(0) = -inf lorsque rand() retourne 0.0
        let u1 = self.rand().max(f64::MIN_POSITIVE);
        let u2 = self.rand();
        let r = (-2.0 * u1.ln()).sqrt();
        let (sin, cos) = (2.0 * std::f64::consts::PI * u2).sin_cos();
        self.spare_gauss = Some(r * sin);
        r * cos
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

    #[test]
    fn test_randn_uses_both_box_muller_variates() {
        // Les deux variates de Box-Muller sont servies : deux randn()
        // consécutifs doivent être distincts (la seconde vient du cache, sans
        // consommer le stream LCG).
        let mut rng = SimpleRng::new(123);
        let a = rng.randn();
        let b = rng.randn();
        assert!(a.is_finite() && b.is_finite());
        assert_ne!(a, b);
    }

    #[test]
    fn test_randn_deterministic_with_spare() {
        let mut a = SimpleRng::new(55);
        let mut b = SimpleRng::new(55);
        for _ in 0..100 {
            assert_eq!(a.randn(), b.randn());
        }
    }

    #[test]
    fn test_uniform_inverted_bounds_is_tolerated() {
        // Documenté : min > max inverse l'intervalle au lieu de paniquer
        let mut rng = SimpleRng::new(1);
        for _ in 0..100 {
            let v = rng.uniform(0.5, -0.5);
            // min + (max-min)·r, r ∈ [0,1) → tombe dans (max, min] inversé
            assert!(
                (-0.5..=0.5).contains(&v),
                "uniform inversé hors bornes: {v}"
            );
        }
    }
}
