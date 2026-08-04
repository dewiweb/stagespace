pub mod engines;
pub mod rng;
pub mod runtime;
pub mod graph;
pub mod validator;
pub mod compiler;
pub mod falloffs;
pub mod audio;
pub mod bpm;
pub mod osc_receiver;
pub mod osc_sender;
pub mod cuelist;
pub mod presets;
pub mod modulator;
pub mod patch;
pub mod logging;
pub mod error;
pub mod config;
pub mod animation;

#[cfg(test)]
mod bench;
#[cfg(test)]
mod runtime_tests;
#[cfg(test)]
mod graph_tests;
#[cfg(test)]
mod validator_tests;
#[cfg(test)]
mod compiler_tests;
#[cfg(test)]
mod audio_tests;
#[cfg(test)]
mod config_tests;
#[cfg(test)]
mod integration_tests;
#[cfg(test)]
mod animation_tests;

pub use engines::{Engine, EngineParams, MAX_OBJECTS};
pub use rng::SimpleRng;
pub use runtime::{Runtime, PositionFn, MacroState, LoopMode, PlayDirection, PerfStats};
pub use graph::{Graph, Node, NodeId, NodeType, Edge};
pub use validator::{Validator, ValidationError, ValidationResult};
pub use compiler::{Compiler, CompiledFunction, CompilationError};
pub use falloffs::{Falloff, FalloffContext, TimeFalloff, PointDistanceFalloff, DirectionalFalloff, AudioAmplitudeFalloff, FalloffCurve};
pub use audio::{AudioState, AmplitudeData, SpectrumData, AudioSource, AudioReactor, AudioBinding, AudioFrame, BPMData};
pub use bpm::BpmTracker;
pub use osc_receiver::{OscReceiver, OscMapping};
pub use osc_sender::{OscSender, OscProfile};
pub use cuelist::{CuelistManager, Cue};
pub use presets::{PresetManager, Preset};
pub use modulator::{Modulator, ModulationSlot, Waveform};
pub use animation::{Animation, AnimationState, TrackAssignment, AudioMod, AudioModSource, AudioModTarget, ShapeType, Direction, AnimationLoopMode};
pub use patch::{PatchManager, AudioObject, ObjectGroup};
pub use logging::{init_logging, log_runtime_init, log_graph_compilation, log_compilation_success,
    log_compilation_error, log_playback_start, log_playback_stop, log_osc_message, log_osc_error,
    log_osc_received, log_audio_state, log_audio_error};
pub use error::{StagespaceError, Result};
pub use config::{Config, RuntimeConfig, OscConfig, AudioConfig, GraphConfig};
