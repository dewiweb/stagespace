use std::sync::atomic::{AtomicU64, Ordering};

/// Macros temps réel — lues à chaque frame, modifiables sans recompilation
#[derive(Debug)]
pub struct MacroState {
    pub speed: std::sync::atomic::AtomicU64,  // bits of f64
    pub scale: std::sync::atomic::AtomicU64,
    pub shift_x: std::sync::atomic::AtomicU64,
    pub shift_y: std::sync::atomic::AtomicU64,
    pub shift_z: std::sync::atomic::AtomicU64,
    pub yaw: std::sync::atomic::AtomicU64,    // rotation autour de Y (degrés)
    pub pitch: std::sync::atomic::AtomicU64,  // rotation autour de X (degrés)
    pub roll: std::sync::atomic::AtomicU64,   // rotation autour de Z (degrés)
}

impl MacroState {
    pub fn new() -> Self {
        MacroState {
            speed: AtomicU64::new(1.0f64.to_bits()),
            scale: AtomicU64::new(1.0f64.to_bits()),
            shift_x: AtomicU64::new(0.0f64.to_bits()),
            shift_y: AtomicU64::new(0.0f64.to_bits()),
            shift_z: AtomicU64::new(0.0f64.to_bits()),
            yaw: AtomicU64::new(0.0f64.to_bits()),
            pitch: AtomicU64::new(0.0f64.to_bits()),
            roll: AtomicU64::new(0.0f64.to_bits()),
        }
    }

    pub fn get_speed(&self) -> f64 { f64::from_bits(self.speed.load(Ordering::Relaxed)) }
    pub fn get_scale(&self) -> f64 { f64::from_bits(self.scale.load(Ordering::Relaxed)) }
    pub fn get_shift(&self) -> nalgebra::Vector3<f64> {
        nalgebra::Vector3::new(
            f64::from_bits(self.shift_x.load(Ordering::Relaxed)),
            f64::from_bits(self.shift_y.load(Ordering::Relaxed)),
            f64::from_bits(self.shift_z.load(Ordering::Relaxed)),
        )
    }
    pub fn get_rotation(&self) -> (f64, f64, f64) {
        (
            f64::from_bits(self.yaw.load(Ordering::Relaxed)),
            f64::from_bits(self.pitch.load(Ordering::Relaxed)),
            f64::from_bits(self.roll.load(Ordering::Relaxed)),
        )
    }

    pub fn set_speed(&self, v: f64) { self.speed.store(v.to_bits(), Ordering::Relaxed); }
    pub fn set_scale(&self, v: f64) { self.scale.store(v.to_bits(), Ordering::Relaxed); }
    pub fn set_shift(&self, x: f64, y: f64, z: f64) {
        self.shift_x.store(x.to_bits(), Ordering::Relaxed);
        self.shift_y.store(y.to_bits(), Ordering::Relaxed);
        self.shift_z.store(z.to_bits(), Ordering::Relaxed);
    }
    pub fn set_rotation(&self, yaw: f64, pitch: f64, roll: f64) {
        self.yaw.store(yaw.to_bits(), Ordering::Relaxed);
        self.pitch.store(pitch.to_bits(), Ordering::Relaxed);
        self.roll.store(roll.to_bits(), Ordering::Relaxed);
    }
}

impl Clone for MacroState {
    fn clone(&self) -> Self {
        MacroState {
            speed: AtomicU64::new(self.speed.load(Ordering::Relaxed)),
            scale: AtomicU64::new(self.scale.load(Ordering::Relaxed)),
            shift_x: AtomicU64::new(self.shift_x.load(Ordering::Relaxed)),
            shift_y: AtomicU64::new(self.shift_y.load(Ordering::Relaxed)),
            shift_z: AtomicU64::new(self.shift_z.load(Ordering::Relaxed)),
            yaw: AtomicU64::new(self.yaw.load(Ordering::Relaxed)),
            pitch: AtomicU64::new(self.pitch.load(Ordering::Relaxed)),
            roll: AtomicU64::new(self.roll.load(Ordering::Relaxed)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_macro_state_realtime() {
        let macros = MacroState::new();
        assert!((macros.get_speed() - 1.0).abs() < 1e-10);
        macros.set_speed(2.5);
        assert!((macros.get_speed() - 2.5).abs() < 1e-10);
        macros.set_shift(1.0, -2.0, 0.5);
        let s = macros.get_shift();
        assert!((s.x - 1.0).abs() < 1e-10);
        assert!((s.y + 2.0).abs() < 1e-10);
        assert!((s.z - 0.5).abs() < 1e-10);
    }
}
