//! HOLOFLOW Core - Rust OSC Engine
//! 
//! High-precision OSC engine for spatial audio trajectory control.
//! Provides microsecond-accurate timing, LFO modulation, and turbulence.

pub mod osc;
pub mod engine;
pub mod modulator;
pub mod ipc;
pub mod error;
pub mod graph;

pub use error::{HoloflowError, Result};