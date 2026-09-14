pub mod animation;
pub mod audio;
pub mod audio_capture;
pub mod bpm;
pub mod compiler;
pub mod config;
pub mod cuelist;
pub mod engines;
pub mod error;
pub mod falloffs;
pub mod graph;
pub mod logging;
pub mod merge_runtime;
pub mod modulator;
pub mod osc_receiver;
pub mod osc_sender;
pub mod patch;
pub mod position_buffer;
pub mod post_process_compiler;
pub mod presets;
pub mod rng;
pub mod runtime;
pub mod validator;

#[cfg(test)]
mod animation_tests;
#[cfg(test)]
mod audio_tests;
#[cfg(test)]
mod bench;
#[cfg(test)]
mod compiler_tests;
#[cfg(test)]
mod config_tests;
#[cfg(test)]
mod graph_tests;
#[cfg(test)]
mod integration_tests;
#[cfg(test)]
mod validator_tests;

pub use animation::{
    Animation, AnimationLoopMode, AnimationState, AudioMod, AudioModSource, AudioModTarget,
    Direction, ShapeType, TrackAssignment,
};
pub use audio::{
    AmplitudeData, AudioBinding, AudioFrame, AudioReactor, AudioSource, AudioState, BPMData,
    SpectrumData,
};
pub use audio_capture::{AudioCaptureError, AudioCaptureManager, AudioDeviceInfo, BpmDetector};
pub use bpm::BpmTracker;
pub use compiler::{AudioParamOverrides, CompilationError, CompiledFunction, Compiler};
pub use config::{AudioConfig, Config, GraphConfig, OscConfig, RuntimeConfig};
pub use cuelist::{Cue, CuelistManager, MacroSnapshot, SpatialMacroSnapshot};
pub use engines::{Engine, EngineParams, MAX_OBJECTS};
pub use error::{Result, StagespaceError};
pub use falloffs::{
    AudioAmplitudeFalloff, DirectionalFalloff, Falloff, FalloffContext, FalloffCurve,
    PointDistanceFalloff, TimeFalloff,
};
pub use graph::{Edge, Graph, Node, NodeId, NodeType};
pub use logging::{
    init_logging, log_compilation_error, log_compilation_success, log_graph_compilation,
    log_osc_error, log_osc_message, log_playback_start, log_playback_stop, log_runtime_init,
};
pub use merge_runtime::{MergeRuntime, MergeStrategy, MoveState};
pub use modulator::{ModulationSlot, Modulator, Waveform};
pub use osc_receiver::{OscMapping, OscReceiver};
pub use osc_sender::{OscProfile, OscSender};
pub use patch::{AudioObject, ObjectGroup, PatchManager};
pub use position_buffer::{IndexedPosition, PositionBuffer};
pub use post_process_compiler::{
    compile_post_process, PostProcessCompileError, PostProcessCompileParams,
};
pub use presets::{Preset, PresetManager};
pub use rng::SimpleRng;
pub use runtime::{
    LoopMode, MacroState, PerfStats, PlayDirection, PositionFn, PostProcessContext, PostProcessFn,
    Runtime,
};
pub use validator::{ValidationError, ValidationResult, Validator};
