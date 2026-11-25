//! Séquenceur Score (docs/score-sequencer.md) — partition de clips
//! multi-pistes exécutée par le backend : horloge dédiée, spawn/stop
//! des moves via les mêmes primitives que les modes opérateur, courbes
//! évaluées au tick. Vérité runtime backend — le frontend résout le
//! document en payloads, il ne joue rien lui-même.
//!
//! Transport : `play` balaye les résidus `sc-*` et spawn le scheduler ;
//! `stop` désactive les moves score selon leurs fades/end_mode déclarés
//! (comme le stop des autres modes) ; `seek` en lecture = scrub
//! (kill + respawn au curseur) ; `update` = hot-swap de la partition
//! avec survie des clips inchangés (`tl.active`) ; `set_loop` est
//! live-safe (le scheduler relit la région en continu).
//!
//! Découpage : `types` (wire), `curves` (moteur de courbes),
//! `scheduler` (thread horloge + tir/kill), `commands` (IPC transport).

mod commands;
mod curves;
pub(crate) mod scheduler;
#[cfg(test)]
mod tests;
pub(crate) mod types;

pub use commands::*;
/// Snapshot UI — repoussé aussi par le hook panic de
/// `move_management` (le score affiche son état après un Esc).
pub(crate) use types::timeline_state;
pub use types::{ScoreTimeline, ScoreTimelineState};
