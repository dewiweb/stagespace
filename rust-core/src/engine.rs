//! Core trajectory engine with microsecond-accurate timing
//! 
//! This module provides the main playback loop with precise timing control,
//! replacing the Python implementation to avoid GIL-related timing issues.

use crate::osc::OscSender;
use crate::error::{HoloflowError, Result};
use std::time::{Duration, Instant};
use std::sync::Arc;
use std::collections::HashMap;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};

/// Engine parameters controlling playback behavior
/// 
/// Core common parameters plus an extensible `custom` map for engine-specific
/// parameters. This avoids changing the struct every time a new engine is added
/// and is the foundation for the f(t) engine design.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct EngineParams {
    /// Playback speed multiplier (1.0 = normal)
    pub speed: f32,
    
    /// Spatial scale (X axis)
    pub scale_x: f32,
    
    /// Spatial scale (Y axis)  
    pub scale_y: f32,
    
    /// Spatial scale (Z axis)
    pub scale_z: f32,
    
    /// Spatial shift (X axis)
    pub shift_x: f32,
    
    /// Spatial shift (Y axis)
    pub shift_y: f32,
    
    /// Spatial shift (Z axis)
    pub shift_z: f32,
    
    /// Turbulence amount (0.0 = none, 1.0 = max)
    pub turbulence: f32,
    
    /// Number of objects to generate positions for
    pub n_objects: usize,
    
    /// Base duration of one loop cycle (seconds)
    pub duration: f32,
    
    /// Engine-specific parameters (radius, freq_x, start_x, etc.)
    pub custom: HashMap<String, f32>,
}

impl EngineParams {
    /// Get normalized time in [0, 1] over the loop duration
    pub fn loop_time(&self, t: f32) -> f32 {
        let d = self.duration.max(0.001);
        (t % d) / d
    }
    
    /// Get a custom parameter with a default value
    pub fn get(&self, key: &str, default: f32) -> f32 {
        *self.custom.get(key).unwrap_or(&default)
    }
    
    /// Get an integer parameter with a default value
    pub fn get_int(&self, key: &str, default: i32) -> i32 {
        self.custom.get(key).map(|v| *v as i32).unwrap_or(default)
    }
    
    /// Get a boolean parameter with a default value
    pub fn get_bool(&self, key: &str, default: bool) -> bool {
        self.custom.get(key).map(|v| *v > 0.0).unwrap_or(default)
    }
}

impl Default for EngineParams {
    fn default() -> Self {
        EngineParams {
            speed: 1.0,
            scale_x: 1.0,
            scale_y: 1.0,
            scale_z: 1.0,
            shift_x: 0.0,
            shift_y: 0.0,
            shift_z: 0.0,
            turbulence: 0.0,
            n_objects: 1,
            duration: 10.0,
            custom: HashMap::new(),
        }
    }
}

/// Trajectory function signature: f(t, object_index, params) -> Vector3
pub type TrajectoryFn = fn(f32, usize, &EngineParams) -> (f32, f32, f32);

/// Simple circular trajectory
pub fn circular_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let radius = params.get("radius", 0.7);
    let plane = params.get_int("plane", 0); // 0=xy, 1=xz, 2=yz
    let phase_offset = params.get_bool("phase_offset", true);
    let phase = if phase_offset { 2.0 * std::f32::consts::PI * (obj_index as f32) / (params.n_objects as f32).max(1.0) } else { 0.0 };
    let angle = 2.0 * std::f32::consts::PI * params.speed * params.loop_time(t) + phase;
    
    let x = angle.cos() * radius;
    let y = angle.sin() * radius;
    
    match plane {
        1 => (x, params.shift_y, y + params.shift_z),   // xz
        2 => (params.shift_x, x, y + params.shift_z),   // yz
        _ => (x + params.shift_x, y + params.shift_y, params.shift_z), // xy
    }
}

/// Simple spiral trajectory
pub fn spiral_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let start_radius = params.get("start_radius", 0.1);
    let end_radius = params.get("end_radius", 0.9);
    let start_z = params.get("start_z", -0.8);
    let end_z = params.get("end_z", 0.8);
    let turns = params.get("turns", 3.0);
    let phase_offset = params.get_bool("phase_offset", true);
    let phase = if phase_offset { 2.0 * std::f32::consts::PI * (obj_index as f32) / (params.n_objects as f32).max(1.0) } else { 0.0 };
    
    let tn = params.loop_time(t);
    let radius = start_radius + (end_radius - start_radius) * tn;
    let angle = 2.0 * std::f32::consts::PI * turns * tn + phase;
    
    let x = radius * angle.cos();
    let y = radius * angle.sin();
    let z = start_z + (end_z - start_z) * tn;
    
    (x + params.shift_x, y + params.shift_y, z + params.shift_z)
}

/// Lissajous 3D trajectory
pub fn lissajous_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let freq_x = params.get("freq_x", 3.0);
    let freq_y = params.get("freq_y", 2.0);
    let freq_z = params.get("freq_z", 1.0);
    let amp_x = params.get("amp_x", 0.8);
    let amp_y = params.get("amp_y", 0.8);
    let amp_z = params.get("amp_z", 0.4);
    let phase_x = params.get("phase_x", 0.0);
    let phase_y = params.get("phase_y", std::f32::consts::FRAC_PI_2);
    let phase_offset = params.get_bool("phase_offset", true);
    let po = if phase_offset { 2.0 * std::f32::consts::PI * (obj_index as f32) / (params.n_objects as f32).max(1.0) } else { 0.0 };
    
    let theta = 2.0 * std::f32::consts::PI * params.loop_time(t) * params.speed;
    
    let x = amp_x * (freq_x * theta + phase_x + po).sin();
    let y = amp_y * (freq_y * theta + phase_y + po).sin();
    let z = amp_z * (freq_z * theta + po).sin();
    
    (x + params.shift_x, y + params.shift_y, z + params.shift_z)
}

/// Figure-8 (lemniscate of Bernoulli) trajectory
pub fn figure8_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let size = params.get("size", 0.7);
    let plane = params.get_int("plane", 0); // 0=xy, 1=xz, 2=yz
    let phase_offset = params.get_bool("phase_offset", true);
    let po = if phase_offset { 2.0 * std::f32::consts::PI * (obj_index as f32) / (params.n_objects as f32).max(1.0) } else { 0.0 };
    
    let theta = 2.0 * std::f32::consts::PI * params.loop_time(t) * params.speed + po;
    let denom = 1.0 + theta.sin() * theta.sin();
    let x = size * theta.cos() / denom;
    let y = size * theta.sin() * theta.cos() / denom;
    
    match plane {
        1 => (x + params.shift_x, params.shift_y, y + params.shift_z),
        2 => (params.shift_x, x + params.shift_y, y + params.shift_z),
        _ => (x + params.shift_x, y + params.shift_y, params.shift_z),
    }
}

/// Linear trajectory between two points
pub fn linear_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let start_x = params.get("start_x", -0.8);
    let start_y = params.get("start_y", 0.0);
    let start_z = params.get("start_z", 0.0);
    let end_x = params.get("end_x", 0.8);
    let end_y = params.get("end_y", 0.0);
    let end_z = params.get("end_z", 0.0);
    let pingpong = params.get_bool("pingpong", false);
    
    let mut tn = params.loop_time(t);
    if pingpong {
        tn = 1.0 - (2.0 * tn - 1.0).abs();
    }
    
    // Stagger offset between objects
    let n_objects = params.n_objects.max(1) as f32;
    let offset = if params.n_objects > 1 { (obj_index as f32) / (n_objects - 1.0) } else { 0.0 };
    let staggered_tn = ((tn - offset * 0.3).max(0.0) / (1.0 - offset * 0.3).max(0.001)).min(1.0);
    
    let x = start_x + (end_x - start_x) * staggered_tn;
    let y = start_y + (end_y - start_y) * staggered_tn;
    let z = start_z + (end_z - start_z) * staggered_tn;
    
    (x + params.shift_x, y + params.shift_y, z + params.shift_z)
}

/// Main playback engine
pub struct PlaybackEngine {
    osc_sender: Arc<OscSender>,
    trajectory: TrajectoryFn,
    params: Arc<Mutex<EngineParams>>,
    running: Arc<Mutex<bool>>,
    osc_address_template: String,
    target_fps: f32,
}

impl PlaybackEngine {
    /// Create a new playback engine
    pub fn new(
        osc_sender: OscSender,
        trajectory: TrajectoryFn,
        osc_address_template: &str,
        target_fps: f32,
    ) -> Self {
        PlaybackEngine {
            osc_sender: Arc::new(osc_sender),
            trajectory,
            params: Arc::new(Mutex::new(EngineParams::default())),
            running: Arc::new(Mutex::new(false)),
            osc_address_template: osc_address_template.to_string(),
            target_fps,
        }
    }
    
    /// Update engine parameters (thread-safe)
    pub async fn update_params(&self, new_params: EngineParams) {
        let mut params = self.params.lock().await;
        *params = new_params;
    }
    
    /// Get current parameters
    pub async fn get_params(&self) -> EngineParams {
        let params = self.params.lock().await;
        params.clone()
    }
    
    /// Start the playback loop
    pub async fn start(&self) -> Result<()> {
        let mut running = self.running.lock().await;
        if *running {
            return Err(HoloflowError::EngineError("Engine already running".to_string()));
        }
        *running = true;
        drop(running);
        
        let osc_sender = self.osc_sender.clone();
        let trajectory = self.trajectory;
        let params = self.params.clone();
        let running_flag = self.running.clone();
        let osc_template = self.osc_address_template.clone();
        let frame_duration = Duration::from_secs_f32(1.0 / self.target_fps);
        
        tokio::spawn(async move {
            let mut t = 0.0f32;
            let mut last_frame = Instant::now();
            
            loop {
                // Check if we should stop
                {
                    let running = running_flag.lock().await;
                    if !*running {
                        break;
                    }
                }
                
                // Calculate timing
                let now = Instant::now();
                let elapsed = now.duration_since(last_frame);
                let delta = elapsed.as_secs_f32();
                last_frame = now;
                
                // Get current params
                let current_params = params.lock().await.clone();
                
                // Update time
                t += delta * current_params.speed;
                
                // Generate and send positions for all objects
                for obj_idx in 0..current_params.n_objects {
                    let (x, y, z) = trajectory(t, obj_idx, &current_params);
                    
                    // Apply turbulence if enabled
                    let (x, y, z) = if current_params.turbulence > 0.0 {
                        Self::apply_turbulence(x, y, z, current_params.turbulence, t, obj_idx)
                    } else {
                        (x, y, z)
                    };
                    
                    // Format OSC address (e.g., "/track/1/xyz")
                    let address = osc_template.replace("{}", &format!("{}", obj_idx + 1));
                    
                    // Send OSC message
                    if let Err(e) = osc_sender.send_floats(&address, vec![x, y, z]) {
                        eprintln!("OSC send error: {}", e);
                    }
                }
                
                // Sleep to maintain target FPS
                let frame_time = Instant::now().duration_since(now);
                if frame_time < frame_duration {
                    tokio::time::sleep(frame_duration - frame_time).await;
                }
            }
        });
        
        Ok(())
    }
    
    /// Stop the playback loop
    pub async fn stop(&self) {
        let mut running = self.running.lock().await;
        *running = false;
    }
    
    /// Check if engine is running
    pub async fn is_running(&self) -> bool {
        let running = self.running.lock().await;
        *running
    }
    
    /// Apply coherent turbulence to position
    fn apply_turbulence(x: f32, y: f32, z: f32, amount: f32, t: f32, obj_idx: usize) -> (f32, f32, f32) {
        // Simple coherent noise using sine waves at different frequencies
        let offset = (obj_idx as f32) * 100.0;
        let noise_x = (t * 3.7 + offset).sin() * 0.1 + (t * 7.3 + offset).cos() * 0.05;
        let noise_y = (t * 4.1 + offset).cos() * 0.1 + (t * 5.9 + offset).sin() * 0.05;
        let noise_z = (t * 2.9 + offset).sin() * 0.1 + (t * 8.1 + offset).cos() * 0.05;
        
        let scale = amount * 0.3; // Scale turbulence amount
        (
            x + noise_x * scale,
            y + noise_y * scale,
            z + noise_z * scale,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_circular_trajectory() {
        let mut params = EngineParams::default();
        params.custom.insert("radius".to_string(), 1.0);
        let (x, y, z) = circular_trajectory(0.0, 0, &params);
        assert!((x - 1.0).abs() < 0.01); // cos(0) = 1
        assert!(y.abs() < 0.01); // sin(0) = 0
        assert_eq!(z, 0.0);
    }
    
    #[test]
    fn test_params_default() {
        let params = EngineParams::default();
        assert_eq!(params.speed, 1.0);
        assert_eq!(params.scale_x, 1.0);
        assert_eq!(params.turbulence, 0.0);
    }
}