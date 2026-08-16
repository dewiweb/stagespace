use super::types::PerfStats;
use std::sync::atomic::{AtomicU64, Ordering};

/// Monitor de performance — stats lock-free via atomics (bits de f64)
pub struct PerfMonitor {
    fps: AtomicU64,
    osc_rate: AtomicU64,
    latency_ms: AtomicU64,
    cpu: AtomicU64,
    osc_error_rate: AtomicU64,
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
        }
    }

    pub fn update(&self, fps: f64, osc_rate: f64, latency_ms: f64, cpu: f64) {
        self.update_with_error_rate(fps, osc_rate, latency_ms, cpu, 0.0);
    }

    pub fn update_with_error_rate(
        &self,
        fps: f64,
        osc_rate: f64,
        latency_ms: f64,
        cpu: f64,
        osc_error_rate: f64,
    ) {
        self.fps.store(fps.to_bits(), Ordering::Relaxed);
        self.osc_rate.store(osc_rate.to_bits(), Ordering::Relaxed);
        self.latency_ms
            .store(latency_ms.to_bits(), Ordering::Relaxed);
        self.cpu.store(cpu.to_bits(), Ordering::Relaxed);
        self.osc_error_rate
            .store(osc_error_rate.to_bits(), Ordering::Relaxed);
    }

    pub fn get_stats(&self) -> PerfStats {
        PerfStats {
            fps: f64::from_bits(self.fps.load(Ordering::Relaxed)),
            osc_rate: f64::from_bits(self.osc_rate.load(Ordering::Relaxed)),
            latency_ms: f64::from_bits(self.latency_ms.load(Ordering::Relaxed)),
            cpu_percent: f64::from_bits(self.cpu.load(Ordering::Relaxed)),
            osc_error_rate: f64::from_bits(self.osc_error_rate.load(Ordering::Relaxed)),
        }
    }
}
