//! LFO Modulator for real-time parameter modulation
//! 
//! Provides multi-slot LFO modulation of engine parameters (speed, scale, shift)
//! with various waveforms: sine, triangle, square, sawtooth, random (S&H)

use crate::engine::EngineParams;
use crate::error::{HoloflowError, Result};
use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};

/// Waveform types for LFO
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum Waveform {
    Sine,
    Triangle,
    Square,
    Sawtooth,
    Random,
}

impl Waveform {
    /// Compute waveform value in [-1, 1] for phase in [0, 1)
    pub fn compute(&self, phase: f32) -> f32 {
        match self {
            Waveform::Sine => (2.0 * std::f32::consts::PI * phase).sin(),
            Waveform::Triangle => {
                if phase < 1.0 {
                    1.0 - 4.0 * (phase - 0.5).abs()
                } else {
                    -1.0
                }
            }
            Waveform::Square => {
                if phase < 0.5 { 1.0 } else { -1.0 }
            }
            Waveform::Sawtooth => 2.0 * phase - 1.0,
            Waveform::Random => {
                // Sample & hold - random value changes at phase wrap
                use std::collections::HashMap;
                use std::sync::Mutex;
                lazy_static::lazy_static! {
                    static ref RANDOM_VALUES: Mutex<HashMap<u32, f32>> = Mutex::new(HashMap::new());
                }
                
                let phase_int = (phase * 1000.0) as u32;
                let mut values = RANDOM_VALUES.lock().unwrap();
                
                if !values.contains_key(&phase_int) {
                    use rand::Rng;
                    let mut rng = rand::thread_rng();
                    values.insert(phase_int, rng.gen_range(-1.0..1.0));
                }
                
                *values.get(&phase_int).unwrap_or(&0.0)
            }
        }
    }
}

/// Target parameter for LFO modulation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ModulationTarget {
    Speed,
    ScaleX,
    ScaleY,
    ScaleZ,
    ShiftX,
    ShiftY,
    ShiftZ,
}

/// Single LFO slot configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LfoSlot {
    pub target: ModulationTarget,
    pub waveform: Waveform,
    pub rate: f32,      // Hz
    pub depth: f32,     // Modulation depth
    pub center: f32,    // Center value
    pub phase: f32,     // Current phase [0, 1)
}

impl LfoSlot {
    pub fn new(target: ModulationTarget, waveform: Waveform, rate: f32, depth: f32, center: f32) -> Self {
        LfoSlot {
            target,
            waveform,
            rate,
            depth,
            center,
            phase: 0.0,
        }
    }
    
    /// Update phase and compute modulated value
    pub fn update(&mut self, delta: f32) -> f32 {
        self.phase = (self.phase + self.rate * delta) % 1.0;
        let modulation = self.waveform.compute(self.phase);
        self.center + modulation * self.depth
    }
}

/// LFO Modulator with multiple slots
pub struct Modulator {
    slots: Arc<Mutex<Vec<LfoSlot>>>,
    running: Arc<Mutex<bool>>,
    target_params: Arc<Mutex<EngineParams>>,
    update_rate: f32, // Hz
}

impl Modulator {
    /// Create a new modulator
    pub fn new(target_params: Arc<Mutex<EngineParams>>, update_rate: f32) -> Self {
        Modulator {
            slots: Arc::new(Mutex::new(Vec::new())),
            running: Arc::new(Mutex::new(false)),
            target_params,
            update_rate,
        }
    }
    
    /// Add a new LFO slot
    pub async fn add_slot(&self, slot: LfoSlot) {
        let mut slots = self.slots.lock().await;
        slots.push(slot);
    }
    
    /// Remove a slot by index
    pub async fn remove_slot(&self, index: usize) -> Result<()> {
        let mut slots = self.slots.lock().await;
        if index >= slots.len() {
            return Err(HoloflowError::InvalidParameter(format!("Slot index {} out of range", index)));
        }
        slots.remove(index);
        Ok(())
    }
    
    /// Get all slots
    pub async fn get_slots(&self) -> Vec<LfoSlot> {
        let slots = self.slots.lock().await;
        slots.clone()
    }
    
    /// Start modulation loop
    pub async fn start(&self) -> Result<()> {
        let mut running = self.running.lock().await;
        if *running {
            return Err(HoloflowError::EngineError("Modulator already running".to_string()));
        }
        *running = true;
        drop(running);
        
        let slots = self.slots.clone();
        let running_flag = self.running.clone();
        let target_params = self.target_params.clone();
        let update_interval = Duration::from_secs_f32(1.0 / self.update_rate);
        
        tokio::spawn(async move {
            let mut last_update = Instant::now();
            
            loop {
                // Check if we should stop
                {
                    let running = running_flag.lock().await;
                    if !*running {
                        break;
                    }
                }
                
                let now = Instant::now();
                let delta = now.duration_since(last_update).as_secs_f32();
                last_update = now;
                
                // Update all slots and apply to target params
                let mut slots_guard = slots.lock().await;
                let mut params = target_params.lock().await;
                
                for slot in slots_guard.iter_mut() {
                    let modulated_value = slot.update(delta);
                    
                    match slot.target {
                        ModulationTarget::Speed => params.speed = modulated_value,
                        ModulationTarget::ScaleX => params.scale_x = modulated_value,
                        ModulationTarget::ScaleY => params.scale_y = modulated_value,
                        ModulationTarget::ScaleZ => params.scale_z = modulated_value,
                        ModulationTarget::ShiftX => params.shift_x = modulated_value,
                        ModulationTarget::ShiftY => params.shift_y = modulated_value,
                        ModulationTarget::ShiftZ => params.shift_z = modulated_value,
                    }
                }
                
                drop(slots_guard);
                drop(params);
                
                // Sleep to maintain update rate
                tokio::time::sleep(update_interval).await;
            }
        });
        
        Ok(())
    }
    
    /// Stop modulation loop
    pub async fn stop(&self) {
        let mut running = self.running.lock().await;
        *running = false;
    }
    
    /// Check if modulator is running
    pub async fn is_running(&self) -> bool {
        let running = self.running.lock().await;
        *running
    }
}

use std::time::{Duration, Instant};

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_waveform_sine() {
        let value = Waveform::Sine.compute(0.0);
        assert!((value - 0.0).abs() < 0.01);
        
        let value = Waveform::Sine.compute(0.25);
        assert!((value - 1.0).abs() < 0.01);
    }
    
    #[test]
    fn test_waveform_square() {
        let value = Waveform::Square.compute(0.25);
        assert_eq!(value, 1.0);
        
        let value = Waveform::Square.compute(0.75);
        assert_eq!(value, -1.0);
    }
    
    #[test]
    fn test_lfo_slot_update() {
        let mut slot = LfoSlot::new(
            ModulationTarget::Speed,
            Waveform::Sine,
            1.0, // 1 Hz
            0.5, // depth
            1.0, // center
        );
        
        let value = slot.update(0.25); // 1/4 second at 1 Hz = 90 degrees
        assert!((value - 1.5).abs() < 0.01); // center + sin(90°) * depth = 1.0 + 1.0 * 0.5
    }
}