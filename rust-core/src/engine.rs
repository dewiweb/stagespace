//! Core trajectory engine with microsecond-accurate timing
//! 
//! This module provides the main playback loop with precise timing control,
//! replacing the Python implementation to avoid GIL-related timing issues.

use crate::osc::OscSender;
use crate::error::{HoloflowError, Result};
use crate::graph::CompiledGraph;
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

/// Elliptical trajectory
pub fn elliptical_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let a = params.get("a", 0.8); // semi-major axis
    let b = params.get("b", 0.4); // semi-minor axis
    let plane = params.get_int("plane", 0); // 0=xy, 1=xz, 2=yz
    let phase_offset = params.get_bool("phase_offset", true);
    let phase = if phase_offset { 2.0 * std::f32::consts::PI * (obj_index as f32) / (params.n_objects as f32).max(1.0) } else { 0.0 };
    let angle = 2.0 * std::f32::consts::PI * params.speed * params.loop_time(t) + phase;
    
    let x = a * angle.cos();
    let y = b * angle.sin();
    
    match plane {
        1 => (x + params.shift_x, params.shift_y, y + params.shift_z),
        2 => (params.shift_x, x + params.shift_y, y + params.shift_z),
        _ => (x + params.shift_x, y + params.shift_y, params.shift_z),
    }
}

/// Oscillation on a single axis
pub fn oscillation_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let axis = params.get_int("axis", 2); // 0=x, 1=y, 2=z
    let amplitude = params.get("amplitude", 0.7);
    let frequency = params.get("frequency", 2.0);
    let damping = params.get("damping", 0.0);
    let phase_offset = params.get_bool("phase_offset", true);
    let po = if phase_offset { 2.0 * std::f32::consts::PI * (obj_index as f32) / (params.n_objects as f32).max(1.0) } else { 0.0 };
    
    let tn = params.loop_time(t);
    let omega = 2.0 * std::f32::consts::PI * frequency;
    let env = (-damping * tn).exp();
    let value = amplitude * env * (omega * tn * params.speed + po).sin();
    
    let mut x = params.shift_x;
    let mut y = params.shift_y;
    let mut z = params.shift_z;
    
    match axis {
        0 => x += value,
        1 => y += value,
        _ => z += value,
    }
    
    (x, y, z)
}

/// Convergence / divergence from a start radius to an end radius
pub fn converge_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let start_radius = params.get("start_radius", 0.9);
    let end_radius = params.get("end_radius", 0.0);
    let easing = params.get_int("easing", 0); // 0=linear, 1=ease_in, 2=ease_out, 3=smooth
    let base_angle = 2.0 * std::f32::consts::PI * (obj_index as f32) / (params.n_objects as f32).max(1.0);
    
    let mut tn = params.loop_time(t);
    match easing {
        1 => tn = tn * tn,
        2 => tn = 1.0 - (1.0 - tn) * (1.0 - tn),
        3 => tn = 3.0 * tn * tn - 2.0 * tn * tn * tn,
        _ => {}
    }
    
    let r = start_radius + (end_radius - start_radius) * tn;
    let x = r * base_angle.cos();
    let y = r * base_angle.sin();
    
    (x + params.shift_x, y + params.shift_y, params.shift_z)
}

/// Formation of objects (circle, sphere, grid, line)
pub fn formation_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let shape = params.get_int("shape", 0); // 0=circle, 1=sphere, 2=grid, 3=line
    let radius = params.get("radius", 0.7);
    let rotate = params.get("rotate", 0.0); // rotations per loop
    let elevation = params.get("elevation", 0.0);
    let n = params.n_objects.max(1) as f32;
    let i = obj_index as f32;
    let theta = 2.0 * std::f32::consts::PI * params.loop_time(t) * params.speed * rotate;
    
    let (x, y, z) = match shape {
        1 => { // sphere (Fibonacci)
            let y_norm = 1.0 - (2.0 * i / n.max(1.0));
            let r = (1.0 - y_norm * y_norm).sqrt().max(0.0) * radius;
            let golden = std::f32::consts::PI * (3.0 - 5.0f32.sqrt());
            let phi = golden * i;
            let (sin_phi, cos_phi) = (phi + theta).sin_cos();
            (r * cos_phi, r * sin_phi, y_norm * radius)
        }
        2 => { // grid
            let side = n.sqrt().ceil() as f32;
            let row = (i / side).floor();
            let col = i % side;
            let x0 = (col / side.max(1.0) - 0.5) * 2.0 * radius;
            let y0 = (row / side.max(1.0) - 0.5) * 2.0 * radius;
            let (cos_t, sin_t) = theta.sin_cos();
            (x0 * cos_t - y0 * sin_t, x0 * sin_t + y0 * cos_t, elevation)
        }
        3 => { // line
            let x0 = (i / n.max(1.0) - 0.5) * 2.0 * radius;
            let (cos_t, sin_t) = theta.sin_cos();
            (x0 * cos_t, x0 * sin_t, elevation)
        }
        _ => { // circle
            let angle = 2.0 * std::f32::consts::PI * i / n.max(1.0) + theta;
            (radius * angle.cos(), radius * angle.sin(), elevation)
        }
    };
    
    (x + params.shift_x, y + params.shift_y, z + params.shift_z)
}

/// Pendulum simulation (approximated by damped harmonic oscillator)
pub fn pendulum_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let length = params.get("length", 0.8);
    let gravity = params.get("gravity", 9.81);
    let initial_angle = params.get("initial_angle", 0.5);
    let damping = params.get("damping", 0.05);
    let phase_offset = params.get_bool("phase_offset", true);
    let po = if phase_offset { std::f32::consts::PI * (obj_index as f32) / (params.n_objects as f32).max(1.0) } else { 0.0 };
    
    // Small-angle approximation: theta(t) = theta0 * exp(-damp*t) * cos(omega*t + po)
    let omega = (gravity / (length * 10.0)).sqrt();
    let elapsed = t - (t / params.duration.max(0.001)).floor() * params.duration; // restart each loop
    let theta = (initial_angle + po * 0.1) * (-damping * elapsed).exp() * (omega * elapsed).cos();
    
    let x = (length * theta.sin()).clamp(-1.0, 1.0);
    let z = (-length * theta.cos() + length * 0.5).clamp(-1.0, 1.0);
    
    (x + params.shift_x, params.shift_y, z + params.shift_z)
}

/// Rose curve trajectory (rhodonea)
pub fn rose_curve_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let radius = params.get("radius", 0.8);
    let n_petals = params.get("n_petals", 4.0); // k value
    let plane = params.get_int("plane", 0); // 0=xy, 1=xz, 2=yz
    let phase_offset = params.get_bool("phase_offset", true);
    let po = if phase_offset { 2.0 * std::f32::consts::PI * (obj_index as f32) / (params.n_objects as f32).max(1.0) } else { 0.0 };
    
    let theta = 2.0 * std::f32::consts::PI * params.speed * params.loop_time(t) + po;
    let r = radius * (n_petals * theta).cos();
    let x = r * theta.cos();
    let y = r * theta.sin();
    
    match plane {
        1 => (x + params.shift_x, params.shift_y, y + params.shift_z),
        2 => (params.shift_x, x + params.shift_y, y + params.shift_z),
        _ => (x + params.shift_x, y + params.shift_y, params.shift_z),
    }
}

/// Helix trajectory
pub fn helix_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let radius = params.get("radius", 0.7);
    let height = params.get("height", 1.6);
    let turns = params.get("turns", 3.0);
    let phase_offset = params.get_bool("phase_offset", true);
    let po = if phase_offset { 2.0 * std::f32::consts::PI * (obj_index as f32) / (params.n_objects as f32).max(1.0) } else { 0.0 };
    
    let tn = params.loop_time(t);
    let angle = 2.0 * std::f32::consts::PI * turns * tn + po;
    let z = height * (tn - 0.5); // centered around 0
    
    let x = radius * angle.cos();
    let y = radius * angle.sin();
    
    (x + params.shift_x, y + params.shift_y, z + params.shift_z)
}

/// Bouncing objects in a container (simplified f(t) approximation)
pub fn bouncing_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let container = params.get_int("container", 0); // 0=sphere, 1=box, 2=cylinder
    let container_size = params.get("container_size", 0.9);
    let gravity = params.get("gravity", 0.0);
    let seed = params.get_int("seed", 42) as f32;
    
    // Deterministic pseudo-random position based on time and object index
    let seed_val = seed + obj_index as f32 * 100.0;
    let tn = params.loop_time(t);
    
    // Base oscillation with gravity effect
    let freq = 2.0 + (seed_val * 0.1).sin() * 0.5;
    let phase = seed_val * 2.3;
    
    let mut x = (freq * tn * std::f32::consts::PI * 2.0 + phase).sin() * container_size * 0.5;
    let mut y = (freq * tn * std::f32::consts::PI * 2.0 + phase + 1.0).sin() * container_size * 0.5;
    let mut z = (freq * tn * std::f32::consts::PI * 2.0 + phase + 2.0).sin() * container_size * 0.5;
    
    // Apply gravity effect (bias toward negative Z)
    z -= gravity * tn * 0.1;
    
    // Clamp to container
    match container {
        1 => { // box
            x = x.clamp(-container_size, container_size);
            y = y.clamp(-container_size, container_size);
            z = z.clamp(-container_size, container_size);
        }
        2 => { // cylinder (clamp XY to circle, Z to box)
            let r_xy = (x * x + y * y).sqrt();
            if r_xy > container_size {
                let scale = container_size / r_xy;
                x *= scale;
                y *= scale;
            }
            z = z.clamp(-container_size, container_size);
        }
        _ => { // sphere
            let r = (x * x + y * y + z * z).sqrt();
            if r > container_size {
                let scale = container_size / r;
                x *= scale;
                y *= scale;
                z *= scale;
            }
        }
    }
    
    (x + params.shift_x, y + params.shift_y, z + params.shift_z)
}

/// Mutual avoidance (simplified f(t) approximation)
pub fn avoidance_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let repulsion_radius = params.get("repulsion_radius", 0.4);
    let container_size = params.get("container_size", 0.9);
    let seed = params.get_int("seed", 42) as f32;
    let n = params.n_objects.max(1) as f32;
    let i = obj_index as f32;
    
    let tn = params.loop_time(t);
    let seed_val = seed + i * 100.0;
    
    // Base circular arrangement with perturbation
    let base_angle = 2.0 * std::f32::consts::PI * i / n;
    let radius = 0.6 + repulsion_radius * 0.2 * (tn * 3.0 + seed_val).sin();
    
    let x = radius * (base_angle + tn).cos();
    let y = radius * (base_angle + tn).sin();
    let z = (tn * 2.0 + seed_val).sin() * 0.1;
    
    // Clamp to container
    let x = x.clamp(-container_size, container_size);
    let y = y.clamp(-container_size, container_size);
    let z = z.clamp(-container_size, container_size);
    
    (x + params.shift_x, y + params.shift_y, z + params.shift_z)
}

/// Spring motion (damped harmonic oscillator)
pub fn spring_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let spring_k = params.get("spring_k", 2.0); // spring constant
    let damping = params.get("damping", 0.1);
    let amplitude = params.get("amplitude", 0.5);
    let seed = params.get_int("seed", 42) as f32;
    
    let tn = params.loop_time(t);
    let seed_val = seed + obj_index as f32 * 100.0;
    
    // Damped oscillation: A * exp(-damp*t) * cos(omega*t)
    let omega = spring_k.sqrt();
    let decay = (-damping * tn).exp();
    let value = amplitude * decay * (omega * tn * std::f32::consts::PI * 2.0 + seed_val).cos();
    
    // Apply to different axes with phase offsets
    let x = value * (seed_val).cos();
    let y = value * (seed_val + 1.0).sin();
    let z = value * (seed_val + 2.0).cos();
    
    (x + params.shift_x, y + params.shift_y, z + params.shift_z)
}

/// Follow leader (objects follow the first one)
pub fn follow_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let follow_distance = params.get("follow_distance", 0.3);
    let speed = params.get("speed", 1.0);
    let seed = params.get_int("seed", 42) as f32;
    
    let tn = params.loop_time(t);
    let seed_val = seed + obj_index as f32 * 100.0;
    
    // Leader (obj_index 0) moves in a circle
    let leader_angle = 2.0 * std::f32::consts::PI * tn * speed;
    let leader_x = 0.7 * leader_angle.cos();
    let leader_y = 0.7 * leader_angle.sin();
    
    if obj_index == 0 {
        (leader_x + params.shift_x, leader_y + params.shift_y, params.shift_z)
    } else {
        // Followers trail behind with delay
        let delay = obj_index as f32 * follow_distance;
        let follower_angle = 2.0 * std::f32::consts::PI * (tn - delay).max(0.0) * speed;
        let x = 0.7 * follower_angle.cos();
        let y = 0.7 * follower_angle.sin();
        let z = (seed_val * tn).sin() * 0.1;
        
        (x + params.shift_x, y + params.shift_y, z + params.shift_z)
    }
}

/// Swarm / Boids-like behavior (simplified f(t) approximation)
pub fn swarm_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let cohesion = params.get("cohesion", 0.5);
    let separation = params.get("separation", 0.3);
    let seed = params.get_int("seed", 42) as f32;
    let n = params.n_objects.max(1) as f32;
    let i = obj_index as f32;
    
    let tn = params.loop_time(t);
    let seed_val = seed + i * 100.0;
    
    // Base circular motion with swarm-like perturbations
    let base_angle = 2.0 * std::f32::consts::PI * i / n;
    let swarm_radius = 0.5 + cohesion * 0.2 * (tn * 2.0 + seed_val).sin();
    
    // Separation effect: offset based on object index
    let sep_offset = separation * (i / n - 0.5) * 2.0;
    
    let angle = base_angle + tn + sep_offset;
    let x = swarm_radius * angle.cos();
    let y = swarm_radius * angle.sin();
    let z = (tn * 3.0 + seed_val).sin() * 0.15;
    
    (x + params.shift_x, y + params.shift_y, z + params.shift_z)
}

/// Perlin-like noise (harmonic superposition)
pub fn perlin_noise_trajectory(t: f32, obj_index: usize, params: &EngineParams) -> (f32, f32, f32) {
    let intensity = params.get("intensity", 0.5);
    let smoothness = params.get("smoothness", 0.5);
    let seed = params.get_int("seed", 42) as f32;
    
    let tn = params.loop_time(t);
    let seed_val = seed + obj_index as f32 * 100.0;
    
    // Number of harmonics based on smoothness
    let n_harmonics = (3.0 + (1.0 - smoothness) * 9.0) as i32;
    
    let mut x = 0.0;
    let mut y = 0.0;
    let mut z = 0.0;
    
    for h in 1..=n_harmonics {
        let freq = (h as f32) * (1.0 + (seed_val * 0.2).sin());
        let amp = intensity / (h as f32).powf(0.5 + smoothness);
        let phase = seed_val * (h as f32) * 0.5;
        
        x += amp * (freq * tn * std::f32::consts::PI * 2.0 + phase).sin();
        y += amp * (freq * tn * std::f32::consts::PI * 2.0 + phase + 1.0).sin();
        z += amp * (freq * tn * std::f32::consts::PI * 2.0 + phase + 2.0).sin();
    }
    
    // Normalize and clamp
    let max_val = intensity * (n_harmonics as f32);
    x = (x / max_val).clamp(-1.0, 1.0);
    y = (y / max_val).clamp(-1.0, 1.0);
    z = (z / max_val).clamp(-1.0, 1.0);
    
    (x + params.shift_x, y + params.shift_y, z + params.shift_z)
}

/// Unified source for playback: either a single trajectory function or a compiled graph
#[derive(Clone)]
pub enum PlaybackSource {
    Trajectory(TrajectoryFn),
    Graph(CompiledGraph),
}

impl PlaybackSource {
    /// Evaluate the source at time `t` with given params, returning OSC messages to send
    pub fn evaluate(&self, t: f32, params: &EngineParams) -> Vec<OscMessage> {
        match self {
            PlaybackSource::Trajectory(trajectory) => {
                (0..params.n_objects)
                    .map(|obj_idx| {
                        let (mut x, mut y, mut z) = trajectory(t, obj_idx, params);
                        
                        // Apply turbulence
                        if params.turbulence > 0.0 {
                            (x, y, z) = Self::apply_turbulence_static(x, y, z, params.turbulence, t, obj_idx);
                        }
                        
                        // Default address template for trajectory mode: /track/{}/xyz
                        let address = format!("/track/{}/xyz", obj_idx + 1);
                        OscMessage { address, x, y, z }
                    })
                    .collect()
            }
            PlaybackSource::Graph(compiled) => {
                compiled.evaluate(t)
                    .into_iter()
                    .map(|output| {
                        OscMessage {
                            address: output.address,
                            x: output.value.x,
                            y: output.value.y,
                            z: output.value.z,
                        }
                    })
                    .collect()
            }
        }
    }
    
    fn apply_turbulence_static(x: f32, y: f32, z: f32, amount: f32, t: f32, obj_idx: usize) -> (f32, f32, f32) {
        let offset = (obj_idx as f32) * 100.0;
        let noise_x = (t * 3.7 + offset).sin() * 0.1 + (t * 7.3 + offset).cos() * 0.05;
        let noise_y = (t * 4.1 + offset).cos() * 0.1 + (t * 5.9 + offset).sin() * 0.05;
        let noise_z = (t * 2.9 + offset).sin() * 0.1 + (t * 8.1 + offset).cos() * 0.05;
        
        let scale = amount * 0.3;
        (
            x + noise_x * scale,
            y + noise_y * scale,
            z + noise_z * scale,
        )
    }
}

/// A single OSC message ready to be sent
#[derive(Debug, Clone)]
pub struct OscMessage {
    pub address: String,
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

/// Main playback engine
pub struct PlaybackEngine {
    osc_sender: Arc<OscSender>,
    source: PlaybackSource,
    params: Arc<Mutex<EngineParams>>,
    running: Arc<Mutex<bool>>,
    target_fps: f32,
}

impl PlaybackEngine {
    /// Create a new playback engine from a trajectory function
    pub fn new(
        osc_sender: OscSender,
        trajectory: TrajectoryFn,
        _osc_address_template: &str,
        target_fps: f32,
    ) -> Self {
        PlaybackEngine {
            osc_sender: Arc::new(osc_sender),
            source: PlaybackSource::Trajectory(trajectory),
            params: Arc::new(Mutex::new(EngineParams::default())),
            running: Arc::new(Mutex::new(false)),
            target_fps,
        }
    }
    
    /// Create a new playback engine from a compiled graph
    pub fn from_graph(
        osc_sender: OscSender,
        graph: CompiledGraph,
        target_fps: f32,
    ) -> Self {
        PlaybackEngine {
            osc_sender: Arc::new(osc_sender),
            source: PlaybackSource::Graph(graph),
            params: Arc::new(Mutex::new(EngineParams::default())),
            running: Arc::new(Mutex::new(false)),
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
        let source = self.source.clone();
        let params = self.params.clone();
        let running_flag = self.running.clone();
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
                
                // Evaluate source and send OSC messages
                let messages = source.evaluate(t, &current_params);
                for msg in messages {
                    if let Err(e) = osc_sender.send_floats(&msg.address, vec![msg.x, msg.y, msg.z]) {
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
    
    #[test]
    fn test_playback_source_graph() {
        use crate::graph::*;
        
        let mut graph = Graph::new();
        graph.add_node(Node {
            id: "engine".to_string(),
            node_type: NodeType::Engine { engine_type: "circular".to_string() },
            params: {
                let mut p = EngineParams::default();
                p.custom.insert("radius".to_string(), 1.0);
                p
            },
            n_objects: 1,
        });
        graph.add_node(Node {
            id: "out".to_string(),
            node_type: NodeType::Output { address_template: "/track/{}/xyz".to_string() },
            params: EngineParams::default(),
            n_objects: 1,
        });
        graph.add_edge(Edge {
            from: "engine".to_string(),
            to: "out".to_string(),
            to_input: "in".to_string(),
        });
        
        let compiled = CompiledGraph::compile(graph).unwrap();
        let source = PlaybackSource::Graph(compiled);
        let params = EngineParams::default();
        let messages = source.evaluate(0.0, &params);
        
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].address, "/track/1/xyz");
        assert!((messages[0].x - 1.0).abs() < 0.01);
    }
}