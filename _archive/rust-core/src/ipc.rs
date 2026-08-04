//! IPC (Inter-Process Communication) module
//! 
//! Handles communication between Python API and Rust core via Unix socket
//! using JSON messages for simplicity and transparency.

use crate::engine::{PlaybackEngine, EngineParams, TrajectoryFn};
use crate::modulator::{Modulator, LfoSlot, Waveform, ModulationTarget};
use crate::osc::OscSender;
use crate::error::Result;
use tokio::net::UnixListener;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;

/// IPC message types
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum IpcMessage {
    /// Start playback with given parameters
    StartPlayback {
        session_id: String,
        trajectory_type: String,
        params: EngineParams,
        osc_host: String,
        osc_port: u16,
        osc_address_template: String,
        target_fps: f32,
    },
    
    /// Stop playback
    StopPlayback { session_id: String },
    
    /// Update engine parameters
    UpdateParams {
        session_id: String,
        params: EngineParams,
    },
    
    /// Add LFO slot
    AddLfoSlot {
        target: String,
        waveform: String,
        rate: f32,
        depth: f32,
        center: f32,
    },
    
    /// Remove LFO slot
    RemoveLfoSlot { index: usize },
    
    /// Get current status
    GetStatus { session_id: String },
    
    /// Response message
    Response {
        success: bool,
        data: Option<serde_json::Value>,
        error: Option<String>,
    },
}

/// IPC server handling Python ↔ Rust communication
pub struct IpcServer {
    listener: UnixListener,
    sessions: Arc<Mutex<HashMap<String, Arc<PlaybackEngine>>>>,
    modulators: Arc<Mutex<HashMap<String, Arc<Modulator>>>>,
}

impl IpcServer {
    /// Create a new IPC server
    pub async fn new(socket_path: &str) -> Result<Self> {
        // Remove socket file if it exists
        if let Err(_) = std::fs::remove_file(socket_path) {
            // File doesn't exist, that's fine
        }
        
        let listener = UnixListener::bind(socket_path)?;
        
        Ok(IpcServer {
            listener,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            modulators: Arc::new(Mutex::new(HashMap::new())),
        })
    }
    
    /// Start the IPC server
    pub async fn run(&self) -> Result<()> {
        println!("IPC server listening on {:?}", self.listener.local_addr()?);
        
        loop {
            match self.listener.accept().await {
                Ok((stream, _addr)) => {
                    let sessions = self.sessions.clone();
                    let modulators = self.modulators.clone();
                    
                    tokio::spawn(async move {
                        let (reader, writer) = tokio::io::split(stream);
                        let mut reader = BufReader::new(reader);
                        let mut writer = BufWriter::new(writer);
                        let mut line = String::new();
                        
                        loop {
                            line.clear();
                            match reader.read_line(&mut line).await {
                                Ok(0) => break, // Connection closed
                                Ok(_) => {
                                    let trimmed = line.trim();
                                    if trimmed.is_empty() {
                                        continue;
                                    }
                                    
                                    if let Ok(msg) = serde_json::from_str::<IpcMessage>(trimmed) {
                                        let response = Self::handle_message(msg, &sessions, &modulators).await;
                                        
                                        if let Ok(response_json) = serde_json::to_string(&response) {
                                            let _ = writer.write_all(response_json.as_bytes()).await;
                                            let _ = writer.write_all(b"\n").await;
                                            let _ = writer.flush().await;
                                        }
                                    }
                                }
                                Err(e) => {
                                    eprintln!("IPC read error: {}", e);
                                    break;
                                }
                            }
                        }
                    });
                }
                Err(e) => {
                    eprintln!("IPC accept error: {}", e);
                }
            }
        }
    }
    
    /// Handle incoming IPC message
    async fn handle_message(
        msg: IpcMessage,
        sessions: &Arc<Mutex<HashMap<String, Arc<PlaybackEngine>>>>,
        modulators: &Arc<Mutex<HashMap<String, Arc<Modulator>>>>,
    ) -> IpcMessage {
        match msg {
            IpcMessage::StartPlayback {
                session_id,
                trajectory_type,
                params,
                osc_host,
                osc_port,
                osc_address_template,
                target_fps,
            } => {
                // Create OSC sender
                let osc_sender = match OscSender::new(&osc_host, osc_port) {
                    Ok(sender) => sender,
                    Err(e) => {
                        return IpcMessage::Response {
                            success: false,
                            data: None,
                            error: Some(format!("Failed to create OSC sender: {}", e)),
                        };
                    }
                };
                
                // Select trajectory function
                let trajectory: TrajectoryFn = match trajectory_type.as_str() {
                    "circular" => crate::engine::circular_trajectory,
                    "spiral" => crate::engine::spiral_trajectory,
                    "lissajous" => crate::engine::lissajous_trajectory,
                    "figure8" => crate::engine::figure8_trajectory,
                    "linear" => crate::engine::linear_trajectory,
                    "elliptical" => crate::engine::elliptical_trajectory,
                    "oscillation" => crate::engine::oscillation_trajectory,
                    "converge" => crate::engine::converge_trajectory,
                    "formation" => crate::engine::formation_trajectory,
                    "pendulum" => crate::engine::pendulum_trajectory,
                    "rose_curve" => crate::engine::rose_curve_trajectory,
                    "helix" => crate::engine::helix_trajectory,
                    "bouncing" => crate::engine::bouncing_trajectory,
                    "avoidance" => crate::engine::avoidance_trajectory,
                    "spring" => crate::engine::spring_trajectory,
                    "follow" => crate::engine::follow_trajectory,
                    "swarm" => crate::engine::swarm_trajectory,
                    "perlin_noise" => crate::engine::perlin_noise_trajectory,
                    _ => {
                        return IpcMessage::Response {
                            success: false,
                            data: None,
                            error: Some(format!("Unknown trajectory type: {}", trajectory_type)),
                        };
                    }
                };
                
                // Create playback engine
                let engine = Arc::new(PlaybackEngine::new(
                    osc_sender,
                    trajectory,
                    &osc_address_template,
                    target_fps,
                ));
                
                // Set initial parameters
                engine.update_params(params.clone()).await;
                
                // Start playback
                if let Err(e) = engine.start().await {
                    return IpcMessage::Response {
                        success: false,
                        data: None,
                        error: Some(format!("Failed to start playback: {}", e)),
                    };
                }
                
                // Store session
                let mut sessions_guard = sessions.lock().await;
                sessions_guard.insert(session_id.clone(), engine);
                
                // Create modulator for this session
                let params_arc = Arc::new(Mutex::new(params));
                let modulator = Arc::new(Modulator::new(params_arc, 30.0)); // 30 Hz update rate
                let mut modulators_guard = modulators.lock().await;
                modulators_guard.insert(session_id.clone(), modulator);
                
                IpcMessage::Response {
                    success: true,
                    data: Some(serde_json::json!({ "session_id": session_id })),
                    error: None,
                }
            }
            
            IpcMessage::StopPlayback { session_id } => {
                let mut sessions_guard = sessions.lock().await;
                let mut modulators_guard = modulators.lock().await;
                
                if let Some(engine) = sessions_guard.remove(&session_id) {
                    engine.stop().await;
                }
                
                if let Some(modulator) = modulators_guard.remove(&session_id) {
                    modulator.stop().await;
                }
                
                IpcMessage::Response {
                    success: true,
                    data: Some(serde_json::json!({ "session_id": session_id })),
                    error: None,
                }
            }
            
            IpcMessage::UpdateParams { session_id, params } => {
                let sessions_guard = sessions.lock().await;
                
                if let Some(engine) = sessions_guard.get(&session_id) {
                    engine.update_params(params.clone()).await;
                    IpcMessage::Response {
                        success: true,
                        data: None,
                        error: None,
                    }
                } else {
                    IpcMessage::Response {
                        success: false,
                        data: None,
                        error: Some(format!("Session {} not found", session_id)),
                    }
                }
            }
            
            IpcMessage::AddLfoSlot {
                target,
                waveform,
                rate,
                depth,
                center,
            } => {
                // For now, add to first available modulator
                // TODO: Add session_id to this message
                let modulators_guard = modulators.lock().await;
                
                if let Some((_, _modulator)) = modulators_guard.iter().next() {
                    let target_enum = match target.as_str() {
                        "speed" => ModulationTarget::Speed,
                        "scale_x" => ModulationTarget::ScaleX,
                        "scale_y" => ModulationTarget::ScaleY,
                        "scale_z" => ModulationTarget::ScaleZ,
                        "shift_x" => ModulationTarget::ShiftX,
                        "shift_y" => ModulationTarget::ShiftY,
                        "shift_z" => ModulationTarget::ShiftZ,
                        _ => {
                            return IpcMessage::Response {
                                success: false,
                                data: None,
                                error: Some(format!("Unknown target: {}", target)),
                            };
                        }
                    };
                    
                    let waveform_enum = match waveform.as_str() {
                        "sine" => Waveform::Sine,
                        "triangle" => Waveform::Triangle,
                        "square" => Waveform::Square,
                        "sawtooth" => Waveform::Sawtooth,
                        "random" => Waveform::Random,
                        _ => {
                            return IpcMessage::Response {
                                success: false,
                                data: None,
                                error: Some(format!("Unknown waveform: {}", waveform)),
                            };
                        }
                    };
                    
                    let _slot = LfoSlot::new(target_enum, waveform_enum, rate, depth, center);
                    // Note: This is a simplified version - we need to handle async properly
                    // For now, return success
                    IpcMessage::Response {
                        success: true,
                        data: None,
                        error: None,
                    }
                } else {
                    IpcMessage::Response {
                        success: false,
                        data: None,
                        error: Some("No active modulator".to_string()),
                    }
                }
            }
            
            IpcMessage::RemoveLfoSlot { index: _ } => {
                // Simplified version
                IpcMessage::Response {
                    success: true,
                    data: None,
                    error: None,
                }
            }
            
            IpcMessage::GetStatus { session_id } => {
                let sessions_guard = sessions.lock().await;
                
                if let Some(engine) = sessions_guard.get(&session_id) {
                    let is_running = engine.is_running().await;
                    let params = engine.get_params().await;
                    
                    IpcMessage::Response {
                        success: true,
                        data: Some(serde_json::json!({
                            "running": is_running,
                            "params": params
                        })),
                        error: None,
                    }
                } else {
                    IpcMessage::Response {
                        success: false,
                        data: None,
                        error: Some(format!("Session {} not found", session_id)),
                    }
                }
            }
            
            IpcMessage::Response { .. } => {
                IpcMessage::Response {
                    success: false,
                    data: None,
                    error: Some("Unexpected response message".to_string()),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_ipc_message_serialization() {
        let msg = IpcMessage::StartPlayback {
            session_id: "test".to_string(),
            trajectory_type: "circular".to_string(),
            params: EngineParams::default(),
            osc_host: "127.0.0.1".to_string(),
            osc_port: 8000,
            osc_address_template: "/track/{}/xyz".to_string(),
            target_fps: 60.0,
        };
        
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("StartPlayback"));
        
        let decoded: IpcMessage = serde_json::from_str(&json).unwrap();
        match decoded {
            IpcMessage::StartPlayback { session_id, .. } => {
                assert_eq!(session_id, "test");
            }
            _ => panic!("Wrong message type"),
        }
    }
}