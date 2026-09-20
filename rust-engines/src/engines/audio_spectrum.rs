use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;

/// Moteur AudioSpectrum — génère des positions modulées par le spectre FFT
/// L'amplitude par bande de fréquence est injectée via extra["spectrum_band_<n>"]
/// ou extra["spectrum"] (array de valeurs normalisées 0..1).
///
/// Note : le runtime injecte actuellement TOUJOURS 8 bandes
/// (spectrum_band_0..7 / spectrum[8]) — `n_bands` ne contrôle que l'espacement
/// angulaire et la borne du mapping objet→bande, pas le spectre injecté.
/// `n_bands` est borné à [1, MAX_BANDS].
pub struct AudioSpectrumEngine;

/// Borne haute de n_bands — au-delà les bandes n'ont plus de sens visuel et
/// le paramètre pourrait venir d'entrées arbitraires.
const MAX_BANDS: usize = 64;

impl Engine for AudioSpectrumEngine {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let base_radius = params
            .extra
            .get("radius")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0);
        let plane = params
            .extra
            .get("plane")
            .and_then(|v| v.as_str())
            .unwrap_or("xz");
        let n_bands = params
            .extra
            .get("n_bands")
            .and_then(|v| v.as_u64())
            .unwrap_or(8)
            .clamp(1, MAX_BANDS as u64) as usize;

        // Lookup DIRECT de la bande de l'objet — ni Vec intermédiaire ni
        // format! par bande (ce code tourne × objets × frames).
        let spectrum_arr = params.extra.get("spectrum").and_then(|v| v.as_array());
        let band_count = spectrum_arr.map_or(n_bands, |a| a.len().max(1));
        let band_idx = object_index.min(band_count - 1);
        let amplitude = match spectrum_arr {
            Some(arr) => arr.get(band_idx).and_then(|v| v.as_f64()).unwrap_or(0.0),
            None => params
                .extra
                .get(format!("spectrum_band_{band_idx}"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
        };

        // Angle basé sur le temps + offset par bande pour éviter le chevauchement
        let angle = 2.0 * std::f64::consts::PI * t / params.duration.max(1e-9)
            + (band_idx as f64) * (2.0 * std::f64::consts::PI / n_bands as f64);

        // Le rayon est modulé par l'amplitude de la bande
        let modulated_radius = base_radius * (0.2 + 0.8 * amplitude);

        match plane {
            "xy" => Vector3::new(
                modulated_radius * angle.cos(),
                modulated_radius * angle.sin(),
                0.0,
            ),
            "xz" => Vector3::new(
                modulated_radius * angle.cos(),
                0.0,
                modulated_radius * angle.sin(),
            ),
            "yz" => Vector3::new(
                0.0,
                modulated_radius * angle.cos(),
                modulated_radius * angle.sin(),
            ),
            _ => Vector3::new(
                modulated_radius * angle.cos(),
                0.0,
                modulated_radius * angle.sin(),
            ),
        }
    }

    fn name(&self) -> &str {
        "audio_spectrum"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_audio_spectrum_default_params() {
        let engine = AudioSpectrumEngine;
        let params = EngineParams {
            n_objects: 4,
            duration: 4.0,
            fps: 60.0,
            extra: json!({}),
        };
        let pos = engine.position(1.0, 0, &params);
        assert!(pos.x.is_finite());
        assert!(pos.y.is_finite());
        assert!(pos.z.is_finite());
    }

    #[test]
    fn test_audio_spectrum_with_bands() {
        let engine = AudioSpectrumEngine;
        let params = EngineParams {
            n_objects: 4,
            duration: 4.0,
            fps: 60.0,
            extra: json!({
                "radius": 2.0,
                "n_bands": 4,
                "spectrum_band_0": 0.9,
                "spectrum_band_1": 0.5,
                "spectrum_band_2": 0.3,
                "spectrum_band_3": 0.1,
            }),
        };
        let pos0 = engine.position(0.0, 0, &params);
        let pos3 = engine.position(0.0, 3, &params);
        // L'objet 0 (bande 0, amplitude 0.9) devrait être plus loin de l'origine
        // que l'objet 3 (bande 3, amplitude 0.1)
        let r0 = (pos0.x.powi(2) + pos0.z.powi(2)).sqrt();
        let r3 = (pos3.x.powi(2) + pos3.z.powi(2)).sqrt();
        assert!(
            r0 > r3,
            "band 0 (amp=0.9) should have larger radius than band 3 (amp=0.1)"
        );
    }

    #[test]
    fn test_audio_spectrum_with_array() {
        let engine = AudioSpectrumEngine;
        let params = EngineParams {
            n_objects: 3,
            duration: 4.0,
            fps: 60.0,
            extra: json!({
                "radius": 1.5,
                "spectrum": [0.8, 0.4, 0.2],
            }),
        };
        let pos = engine.position(0.0, 0, &params);
        let radius = (pos.x.powi(2) + pos.z.powi(2)).sqrt();
        // Avec amplitude 0.8: radius = 1.5 * (0.2 + 0.8 * 0.8) = 1.5 * 0.84 = 1.26
        assert!(
            (radius - 1.26).abs() < 0.01,
            "expected radius ~1.26, got {radius}"
        );
    }

    #[test]
    fn test_n_bands_zero_or_huge_stays_finite() {
        // Régression : n_bands = 0 → division par 0 dans l'offset angulaire
        // → inf/NaN vers l'OSC. n_bands est borné à [1, MAX_BANDS].
        let engine = AudioSpectrumEngine;
        for n_bands in [0u64, 1, 10_000] {
            let params = EngineParams {
                n_objects: 4,
                duration: 4.0,
                fps: 60.0,
                extra: json!({"n_bands": n_bands, "spectrum_band_0": 0.5}),
            };
            let pos = engine.position(1.0, 0, &params);
            assert!(
                pos.iter().all(|v| v.is_finite()),
                "n_bands={n_bands} → pos={pos:?}"
            );
        }
    }

    #[test]
    fn test_object_index_beyond_bands_is_safe() {
        // object_index > nombre de bandes → clamp sur la dernière bande
        let engine = AudioSpectrumEngine;
        let params = EngineParams {
            n_objects: 4,
            duration: 4.0,
            fps: 60.0,
            extra: json!({"spectrum": [0.8, 0.4]}),
        };
        let pos = engine.position(0.0, 7, &params);
        assert!(pos.iter().all(|v| v.is_finite()));
        // band_idx clampé à 1 → amplitude 0.4 → radius = 1.0 * (0.2+0.8*0.4)
        let r = (pos.x.powi(2) + pos.z.powi(2)).sqrt();
        assert!((r - 0.52).abs() < 0.01, "r={r}");
    }
}
