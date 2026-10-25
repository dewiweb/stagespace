use super::types::PerfStats;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// Monitor de performance — stats lock-free via atomics (bits de f64)
pub struct PerfMonitor {
    fps: AtomicU64,
    osc_rate: AtomicU64,
    latency_ms: AtomicU64,
    cpu: AtomicU64,
    osc_error_rate: AtomicU64,
    osc_refused_rate: AtomicU64,
    osc_suspended: AtomicBool,
    merge_frame_us: AtomicU64,
    merge_lock_us: AtomicU64,
}

impl Default for PerfMonitor {
    fn default() -> Self {
        Self::new()
    }
}

impl PerfMonitor {
    pub fn new() -> Self {
        PerfMonitor {
            fps: AtomicU64::new(0),
            osc_rate: AtomicU64::new(0),
            latency_ms: AtomicU64::new(0),
            cpu: AtomicU64::new(0),
            osc_error_rate: AtomicU64::new(0),
            osc_refused_rate: AtomicU64::new(0),
            osc_suspended: AtomicBool::new(false),
            merge_frame_us: AtomicU64::new(0),
            merge_lock_us: AtomicU64::new(0),
        }
    }

    /// Durée de travail de la frame de merge (µs) — merge + sends + perf,
    /// hors sleep de pacing. Appelé une fois par frame par le merge thread.
    pub fn set_merge_frame_us(&self, us: f64) {
        self.merge_frame_us.store(us.to_bits(), Ordering::Relaxed);
    }

    /// Temps total d'attente en acquisition de locks sur la frame de merge
    /// (µs) — contention observable du hot-path. Appelé une fois par frame.
    pub fn set_merge_lock_us(&self, us: f64) {
        self.merge_lock_us.store(us.to_bits(), Ordering::Relaxed);
    }

    /// État du circuit-breaker OSC (true = sends suspendus, sonde @1Hz).
    pub fn set_osc_suspended(&self, suspended: bool) {
        self.osc_suspended.store(suspended, Ordering::Relaxed);
    }

    pub fn update(&self, fps: f64, osc_rate: f64, latency_ms: f64, cpu: f64) {
        self.update_with_error_rate(fps, osc_rate, latency_ms, cpu, 0.0, 0.0);
    }

    pub fn update_with_error_rate(
        &self,
        fps: f64,
        osc_rate: f64,
        latency_ms: f64,
        cpu: f64,
        osc_error_rate: f64,
        osc_refused_rate: f64,
    ) {
        self.fps.store(fps.to_bits(), Ordering::Relaxed);
        self.osc_rate.store(osc_rate.to_bits(), Ordering::Relaxed);
        self.latency_ms
            .store(latency_ms.to_bits(), Ordering::Relaxed);
        self.cpu.store(cpu.to_bits(), Ordering::Relaxed);
        self.osc_error_rate
            .store(osc_error_rate.to_bits(), Ordering::Relaxed);
        self.osc_refused_rate
            .store(osc_refused_rate.to_bits(), Ordering::Relaxed);
    }

    pub fn get_stats(&self) -> PerfStats {
        PerfStats {
            fps: f64::from_bits(self.fps.load(Ordering::Relaxed)),
            osc_rate: f64::from_bits(self.osc_rate.load(Ordering::Relaxed)),
            latency_ms: f64::from_bits(self.latency_ms.load(Ordering::Relaxed)),
            cpu_percent: f64::from_bits(self.cpu.load(Ordering::Relaxed)),
            osc_error_rate: f64::from_bits(self.osc_error_rate.load(Ordering::Relaxed)),
            osc_refused_rate: f64::from_bits(self.osc_refused_rate.load(Ordering::Relaxed)),
            osc_suspended: self.osc_suspended.load(Ordering::Relaxed),
            merge_frame_us: f64::from_bits(self.merge_frame_us.load(Ordering::Relaxed)),
            merge_lock_us: f64::from_bits(self.merge_lock_us.load(Ordering::Relaxed)),
        }
    }
}
