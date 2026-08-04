use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};
use super::types::{LoopMode, PlayDirection};

/// Configuration du runtime — loop mode, direction, fade, preview
pub struct RuntimeConfig {
    loop_mode: AtomicU8,   // 0 = Loop, 1 = OneShot
    direction: AtomicU8,   // 0 = Forward, 1 = Backward, 2 = PingPong
    fade_in: AtomicU64,    // stocké en ms (u64) pour être atomic
    fade_out: AtomicU64,
    preview_mode: AtomicBool,
}

impl RuntimeConfig {
    pub fn new() -> Self {
        RuntimeConfig {
            loop_mode: AtomicU8::new(0),
            direction: AtomicU8::new(0),
            fade_in: AtomicU64::new(0),
            fade_out: AtomicU64::new(0),
            preview_mode: AtomicBool::new(false),
        }
    }

    pub fn set_loop_mode(&self, mode: LoopMode) {
        self.loop_mode.store(match mode {
            LoopMode::Loop => 0,
            LoopMode::OneShot => 1,
        }, Ordering::Relaxed);
    }

    pub fn set_direction(&self, dir: PlayDirection) {
        self.direction.store(match dir {
            PlayDirection::Forward => 0,
            PlayDirection::Backward => 1,
            PlayDirection::PingPong => 2,
        }, Ordering::Relaxed);
    }

    pub fn set_fade(&self, fade_in: f64, fade_out: f64) {
        self.fade_in.store((fade_in * 1000.0) as u64, Ordering::Relaxed);
        self.fade_out.store((fade_out * 1000.0) as u64, Ordering::Relaxed);
    }

    pub fn set_preview_mode(&self, enabled: bool) {
        self.preview_mode.store(enabled, Ordering::SeqCst);
    }

    pub fn is_preview_mode(&self) -> bool {
        self.preview_mode.load(Ordering::SeqCst)
    }

    pub fn get_loop_mode(&self) -> LoopMode {
        match self.loop_mode.load(Ordering::Relaxed) {
            1 => LoopMode::OneShot,
            _ => LoopMode::Loop,
        }
    }

    pub fn get_direction(&self) -> PlayDirection {
        match self.direction.load(Ordering::Relaxed) {
            1 => PlayDirection::Backward,
            2 => PlayDirection::PingPong,
            _ => PlayDirection::Forward,
        }
    }

    pub fn get_fade(&self) -> (f64, f64) {
        let fade_in_s = self.fade_in.load(Ordering::Relaxed) as f64 / 1000.0;
        let fade_out_s = self.fade_out.load(Ordering::Relaxed) as f64 / 1000.0;
        (fade_in_s, fade_out_s)
    }
}
