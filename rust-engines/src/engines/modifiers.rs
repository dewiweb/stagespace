use nalgebra::{Rotation3, Vector3};
use std::f64::consts::PI;

/// Apply scale modifier to a position
pub fn scale(pos: Vector3<f64>, sx: f64, sy: f64, sz: f64) -> Vector3<f64> {
    Vector3::new(pos.x * sx, pos.y * sy, pos.z * sz)
}

/// Apply offset modifier to a position
pub fn offset(pos: Vector3<f64>, ox: f64, oy: f64, oz: f64) -> Vector3<f64> {
    Vector3::new(pos.x + ox, pos.y + oy, pos.z + oz)
}

/// Apply rotation modifier to a position (angles in radians)
pub fn rotate(pos: Vector3<f64>, angle_x: f64, angle_y: f64, angle_z: f64) -> Vector3<f64> {
    let rx = Rotation3::from_euler_angles(angle_x, 0.0, 0.0);
    let ry = Rotation3::from_euler_angles(0.0, angle_y, 0.0);
    let rz = Rotation3::from_euler_angles(0.0, 0.0, angle_z);
    rz * (ry * (rx * pos))
}

/// Apply phase shift: shift time by object_index * shift * duration
pub fn phase_shift_time(t: f64, object_index: usize, shift: f64, duration: f64) -> f64 {
    let shifted = t + object_index as f64 * shift * duration;
    if duration > 0.0 {
        shifted.rem_euclid(duration)
    } else {
        shifted
    }
}

/// Mirror — reflect position across a plane (xy, xz, yz) at a given offset
pub fn mirror(pos: Vector3<f64>, plane: &str, offset: f64) -> Vector3<f64> {
    match plane {
        "xy" => Vector3::new(pos.x, pos.y, 2.0 * offset - pos.z),
        "xz" => Vector3::new(pos.x, 2.0 * offset - pos.y, pos.z),
        "yz" => Vector3::new(2.0 * offset - pos.x, pos.y, pos.z),
        _ => pos,
    }
}

/// Clamp — constrain position to a bounding box.
/// Bounds are swapped per-axis if min > max — `f64::clamp` panics on inverted
/// bounds, and a panic in the merge thread means an OSC blackout.
pub fn clamp(pos: Vector3<f64>, min: Vector3<f64>, max: Vector3<f64>) -> Vector3<f64> {
    let c = |v: f64, lo: f64, hi: f64| {
        if lo <= hi {
            v.clamp(lo, hi)
        } else {
            v.clamp(hi, lo)
        }
    };
    Vector3::new(
        c(pos.x, min.x, max.x),
        c(pos.y, min.y, max.y),
        c(pos.z, min.z, max.z),
    )
}

/// LFO — add a low-frequency oscillation to a position axis
/// waveform: sine, triangle, square, sawtooth
pub fn lfo(
    pos: Vector3<f64>,
    t: f64,
    waveform: &str,
    frequency: f64,
    amplitude: f64,
    axis: &str,
    phase: f64,
) -> Vector3<f64> {
    let angle = 2.0 * PI * frequency * t + phase;
    let value = match waveform {
        "sine" => angle.sin(),
        "triangle" => (2.0 / PI) * (angle.sin()).asin(),
        "square" => {
            if angle.sin() >= 0.0 {
                1.0
            } else {
                -1.0
            }
        }
        "sawtooth" => {
            // rem_euclid : `%` donne un reste négatif pour angle < 0
            // (t<0 ou phase<0) → le sawtooth sortait de [-1,1] en négatif.
            let normalized = (angle / (2.0 * PI)).rem_euclid(1.0);
            2.0 * normalized - 1.0
        }
        _ => angle.sin(),
    };
    let offset = amplitude * value;
    match axis {
        "x" => Vector3::new(pos.x + offset, pos.y, pos.z),
        "y" => Vector3::new(pos.x, pos.y + offset, pos.z),
        "z" => Vector3::new(pos.x, pos.y, pos.z + offset),
        "all" => Vector3::new(pos.x + offset, pos.y + offset, pos.z + offset),
        _ => Vector3::new(pos.x, pos.y + offset, pos.z),
    }
}

/// Jitter — add smooth random noise to a position
/// Uses a hash-based pseudo-random function smoothed by sin
pub fn jitter(
    pos: Vector3<f64>,
    t: f64,
    object_index: usize,
    intensity: f64,
    frequency: f64,
    seed: f64,
) -> Vector3<f64> {
    // Le seed entre dans l'argument de sin (multiplié par un irrationnel) :
    // ajouté APRÈS le produit mais AVANT fract() — comme avant —, un seed
    // entier était invisible (fract(x + k) = fract(x)).
    let hash = |n: f64| -> f64 { ((n + seed * 12.9898).sin() * 43758.5453).fract() };
    let noise = |dim: f64| -> f64 {
        let h1 = hash(dim + object_index as f64 * 17.0);
        let h2 = hash(dim + object_index as f64 * 17.0 + 100.0);
        let smooth = (2.0 * PI * frequency * t + h1 * 2.0 * PI).sin();
        let smooth2 = (2.0 * PI * frequency * t * 1.3 + h2 * 2.0 * PI).sin();
        intensity * smooth * 0.5 + intensity * smooth2 * 0.3
    };
    Vector3::new(pos.x + noise(0.0), pos.y + noise(1.0), pos.z + noise(2.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    #[test]
    fn test_scale() {
        let pos = Vector3::new(1.0, 2.0, 3.0);
        let result = scale(pos, 2.0, 0.5, 1.0);
        assert!((result.x - 2.0).abs() < 1e-10);
        assert!((result.y - 1.0).abs() < 1e-10);
        assert!((result.z - 3.0).abs() < 1e-10);
    }

    #[test]
    fn test_offset() {
        let pos = Vector3::new(1.0, 2.0, 3.0);
        let result = offset(pos, 0.5, -1.0, 2.0);
        assert!((result.x - 1.5).abs() < 1e-10);
        assert!((result.y - 1.0).abs() < 1e-10);
        assert!((result.z - 5.0).abs() < 1e-10);
    }

    #[test]
    fn test_rotate_z_90() {
        let pos = Vector3::new(1.0, 0.0, 0.0);
        let result = rotate(pos, 0.0, 0.0, PI / 2.0);
        assert!((result.x - 0.0).abs() < 1e-10);
        assert!((result.y - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_phase_shift() {
        let t = phase_shift_time(0.0, 2, 0.1, 4.0);
        assert!((t - 0.8).abs() < 1e-10);
    }

    #[test]
    fn test_mirror_xz() {
        let pos = Vector3::new(1.0, 2.0, 3.0);
        let result = mirror(pos, "xz", 0.0);
        // Mirror Y across y=0: y becomes -y
        assert!((result.x - 1.0).abs() < 1e-10);
        assert!((result.y - (-2.0)).abs() < 1e-10);
        assert!((result.z - 3.0).abs() < 1e-10);
    }

    #[test]
    fn test_mirror_xz_offset() {
        let pos = Vector3::new(1.0, 2.0, 3.0);
        let result = mirror(pos, "xz", 5.0);
        // Mirror Y across y=5: y becomes 2*5 - 2 = 8
        assert!((result.y - 8.0).abs() < 1e-10);
    }

    #[test]
    fn test_clamp() {
        let pos = Vector3::new(10.0, -10.0, 3.0);
        let min = Vector3::new(-5.0, -5.0, -5.0);
        let max = Vector3::new(5.0, 5.0, 5.0);
        let result = clamp(pos, min, max);
        assert!((result.x - 5.0).abs() < 1e-10);
        assert!((result.y - (-5.0)).abs() < 1e-10);
        assert!((result.z - 3.0).abs() < 1e-10);
    }

    #[test]
    fn test_lfo_sine() {
        let pos = Vector3::new(1.0, 2.0, 3.0);
        let result = lfo(pos, 0.0, "sine", 1.0, 0.5, "y", 0.0);
        // At t=0, sin(0) = 0, so no offset
        assert!((result.y - 2.0).abs() < 1e-10);
    }

    #[test]
    fn test_lfo_sine_quarter() {
        let pos = Vector3::new(1.0, 2.0, 3.0);
        // At t=0.25, freq=1: angle = 2π*0.25 = π/2, sin = 1
        let result = lfo(pos, 0.25, "sine", 1.0, 0.5, "y", 0.0);
        assert!((result.y - 2.5).abs() < 1e-10);
    }

    #[test]
    fn test_lfo_square() {
        let pos = Vector3::new(0.0, 0.0, 0.0);
        let result = lfo(pos, 0.25, "square", 1.0, 1.0, "y", 0.0);
        // sin(π/2) = 1 >= 0, so square = 1
        assert!((result.y - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_jitter_bounds() {
        let pos = Vector3::new(0.0, 0.0, 0.0);
        let result = jitter(pos, 1.0, 0, 0.5, 1.0, 42.0);
        // Jitter should be within [-intensity, intensity] roughly
        assert!(result.x.abs() <= 1.0);
        assert!(result.y.abs() <= 1.0);
        assert!(result.z.abs() <= 1.0);
    }

    #[test]
    fn test_jitter_seed_changes_output() {
        // Régression : le seed était ajouté AVANT fract() → fract(x + 42)
        // ≡ fract(x + 43) — les seeds entiers produisaient un jitter identique.
        let pos = Vector3::new(0.0, 0.0, 0.0);
        let a = jitter(pos, 0.7, 0, 0.5, 1.0, 42.0);
        let b = jitter(pos, 0.7, 0, 0.5, 1.0, 43.0);
        assert!(
            (a - b).norm() > 1e-6,
            "seeds 42 et 43 doivent donner des jitters différents"
        );
    }

    #[test]
    fn test_lfo_sawtooth_negative_angle() {
        // Régression : `% 1.0` donnait un reste négatif pour angle < 0.
        // t = -0.25, freq = 1 → angle = -π/2 → normalized = 0.75 → 0.5
        let pos = Vector3::new(0.0, 0.0, 0.0);
        let result = lfo(pos, -0.25, "sawtooth", 1.0, 1.0, "y", 0.0);
        assert!((result.y - 0.5).abs() < 1e-10, "y={}", result.y);
        // Jamais hors [-1, 1]·amplitude, même pour t très négatif
        let far = lfo(pos, -123.456, "sawtooth", 1.0, 1.0, "y", 0.0);
        assert!(far.y.abs() <= 1.0 + 1e-12, "y={}", far.y);
    }
}
