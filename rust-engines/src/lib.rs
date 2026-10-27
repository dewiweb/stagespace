pub mod animation;
pub mod audio;
pub mod audio_capture;
pub mod compiler;
pub mod config;
pub mod cuelist;
pub mod engines;
pub mod error;
pub mod falloffs;
pub mod graph;
pub mod graph_json;
pub mod hol_parser;
pub mod kinematics;
pub mod logging;
pub mod merge_runtime;
pub mod node_params;
pub mod node_spec;
pub mod osc_receiver;
pub mod osc_sender;
pub mod param_slots;
pub mod plugins;
pub mod position_buffer;
pub mod position_sink;
pub mod post_process_compiler;
pub mod presets;
pub mod rng;
pub mod runtime;
pub mod signal_compiler;
pub mod spatial_transform;
pub mod validator;
pub mod zones;

#[cfg(test)]
mod animation_tests;
#[cfg(test)]
#[cfg(test)]
mod bench;
#[cfg(test)]
mod compiler_tests;
#[cfg(test)]
mod config_tests;
#[cfg(test)]
mod generative_graph_tests;
#[cfg(test)]
mod graph_tests;
#[cfg(test)]
mod integration_tests;
#[cfg(test)]
mod param_slots_tests;
#[cfg(test)]
mod plugin_tests;
mod port_matrix_tests;
#[cfg(test)]
mod validator_tests;

pub use animation::{
    Animation, AnimationLoopMode, AnimationState, AudioMod, AudioModSource, AudioModTarget,
    Direction, ShapeType, TrackAssignment,
};
pub use audio::{
    AmplitudeData, AudioBinding, AudioFrame, AudioSource, AudioState, BPMData, SpectrumData,
};
pub use audio_capture::{AudioCaptureError, AudioCaptureManager, AudioDeviceInfo, BpmDetector};
pub use compiler::{
    AudioParamOverrides, CompilationError, CompiledFunction, Compiler, LiveInputs, OscValueMap,
};
pub use config::{AudioConfig, Config, GraphConfig, OscConfig, RuntimeConfig};
pub use cuelist::{
    Cue, CuelistManager, MacroSnapshot, MoveSnapshot, SpatialMacroSnapshot, CUE_SCHEMA_VERSION,
};
pub use engines::{Engine, EngineParams, MAX_OBJECTS};
pub use error::{Result, StagespaceError};
pub use falloffs::{
    AudioAmplitudeFalloff, DirectionalFalloff, Falloff, FalloffContext, FalloffCurve,
    PointDistanceFalloff, TimeFalloff,
};
pub use graph::{Edge, Graph, Node, NodeId, NodeType};
pub use graph_json::{
    GraphEdgeJson, GraphJson, GraphNodeData, GraphNodeJson, GraphNodePosition,
    GRAPH_JSON_SCHEMA_VERSION,
};
pub use hol_parser::{aed_to_xyz, parse_hol_project, HolTrack};
pub use kinematics::{ChannelModulation, KinematicSource, KinematicState};
pub use logging::{
    init_logging, log_compilation_error, log_compilation_success, log_graph_compilation,
    log_osc_error, log_osc_message, log_playback_start, log_playback_stop, log_plugin_error,
    log_runtime_init,
};
pub use merge_runtime::{MergeRuntime, MergeStrategy, MoveState};
pub use osc_receiver::{
    MacroTarget, MappingDestination, ObjectRef, OscInStatsSnapshot, OscInTargets, OscMapping,
    OscReceiver, Transform,
};
pub use osc_sender::{OscProfile, OscSender, SpatialChannel, SpatialChannels};
pub use plugins::{PluginEngine, PluginError, PluginManifest, PluginRegistry};
pub use position_buffer::{IndexedPosition, PositionBuffer};
pub use position_sink::{OscSink, PositionSink, SendReport};
pub use post_process_compiler::{
    compile_post_process, extract_graph_effects, GraphEffects, PostProcessCompileError,
    PostProcessCompileParams,
};
pub use presets::{Preset, PresetManager};
pub use rng::SimpleRng;
pub use runtime::{
    LoopMode, MacroState, PerfStats, PlayDirection, PositionFn, PostProcessContext, PostProcessFn,
    Runtime,
};
pub use signal_compiler::{
    compile_move_signal_graph, compile_signal_graph, empty_signal_fn, macro_with_deltas,
    SignalCompileError, SignalCtx, SignalDeltas, SignalFn, SignalOutput,
};
pub use validator::{
    diagnose, GraphContext, GraphIssue, IssueSeverity, ValidationError, ValidationResult, Validator,
};
pub use zones::{apply_zones, Zone, ZoneShape};
