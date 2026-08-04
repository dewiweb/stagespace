/// Fonction de position compilée — hot-swappable pour cue recall
pub type PositionFn = Box<dyn Fn(f64, usize) -> nalgebra::Vector3<f64> + Send + Sync>;

/// Callback appelé à chaque frame avec les positions calculées
pub type PositionCallback = Box<dyn Fn(f64, Vec<(usize, nalgebra::Vector3<f64>)>) + Send + Sync>;

/// Mode de loop
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LoopMode {
    /// Loop infini — t = t % duration (pour live)
    Loop,
    /// One-shot — s'arrête à la fin de duration
    OneShot,
}

/// Direction de lecture
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PlayDirection {
    /// Forward — t augmente normalement
    Forward,
    /// Backward — t décroît (t = duration - t)
    Backward,
    /// Ping-pong — alterne forward et backward
    PingPong,
}

/// Stats de performance — lues à chaque frame
#[derive(Debug, Clone, Default)]
pub struct PerfStats {
    pub fps: f64,
    pub osc_rate: f64,
    pub latency_ms: f64,
    pub cpu_percent: f64,
}
