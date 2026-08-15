use tracing::{debug, error, info, instrument, warn};
use tracing_subscriber;

/// Initialise le système de logging
pub fn init_logging() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
}

/// Log l'initialisation du runtime
#[instrument]
pub fn log_runtime_init(fps: f64, n_objects: usize) {
    info!(fps, n_objects, "Runtime initialized");
}

/// Log la compilation du graphe
#[instrument]
pub fn log_graph_compilation(node_count: usize, edge_count: usize) {
    info!(node_count, edge_count, "Graph compilation started");
}

/// Log la compilation réussie
#[instrument]
pub fn log_compilation_success(duration_ms: u128) {
    info!(duration_ms, "Graph compilation successful");
}

/// Log une erreur de compilation
#[instrument]
pub fn log_compilation_error(error: &str) {
    error!(error, "Graph compilation failed");
}

/// Log le début du playback
#[instrument]
pub fn log_playback_start(duration: f64, osc_profile: &str) {
    info!(duration, osc_profile, "Playback started");
}

/// Log l'arrêt du playback
#[instrument]
pub fn log_playback_stop() {
    info!("Playback stopped");
}

/// Log un message OSC envoyé
#[instrument]
pub fn log_osc_message(address: &str, data_len: usize) {
    debug!(address, data_len, "OSC message sent");
}

/// Log une erreur OSC
#[instrument]
pub fn log_osc_error(error: &str) {
    warn!(error, "OSC error occurred");
}
