use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Formes d'onde disponibles
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Waveform {
    Sine,
    Triangle,
    Square,
    Sawtooth,
    Random,
}

/// Slot de modulation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModulationSlot {
    pub target: String,
    pub waveform: Waveform,
    pub rate: f64,
    pub depth: f64,
    pub center: f64,
    pub phase: f64,
}

/// Modulator - LFO modulateur multi-slot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Modulator {
    pub slots: HashMap<String, ModulationSlot>,
    pub is_running: bool,
}

impl Modulator {
    pub fn new() -> Self {
        Modulator {
            slots: HashMap::new(),
            is_running: false,
        }
    }

    /// Ajoute un slot de modulation
    pub fn add_slot(
        &mut self,
        target: String,
        waveform: Waveform,
        rate: f64,
        depth: f64,
        center: f64,
    ) {
        let slot = ModulationSlot {
            target: target.clone(),
            waveform,
            rate,
            depth,
            center,
            phase: 0.0,
        };
        self.slots.insert(target, slot);
    }

    /// Supprime un slot de modulation
    pub fn remove_slot(&mut self, target: &str) {
        self.slots.remove(target);
    }

    /// Retourne tous les slots
    pub fn get_slots(&self) -> &HashMap<String, ModulationSlot> {
        &self.slots
    }

    /// Retourne un slot spécifique
    pub fn get_slot(&self, target: &str) -> Option<&ModulationSlot> {
        self.slots.get(target)
    }

    /// Met à jour un slot
    pub fn update_slot(&mut self, target: &str, slot: ModulationSlot) {
        self.slots.insert(target.to_string(), slot);
    }

    /// Calcule la valeur modulée pour un target à un instant t
    pub fn calculate_value(&self, target: &str, t: f64) -> Option<f64> {
        if let Some(slot) = self.slots.get(target) {
            let phase = 2.0 * std::f64::consts::PI * slot.rate * t + slot.phase;
            let modulation = match slot.waveform {
                Waveform::Sine => phase.sin(),
                Waveform::Triangle => {
                    // Triangle wave approximation
                    let p = (phase / (2.0 * std::f64::consts::PI)) % 2.0;
                    if p < 1.0 {
                        2.0 * p - 1.0
                    } else {
                        3.0 - 2.0 * p
                    }
                }
                Waveform::Square => {
                    if phase.sin() >= 0.0 {
                        1.0
                    } else {
                        -1.0
                    }
                }
                Waveform::Sawtooth => {
                    let p = (phase / (2.0 * std::f64::consts::PI)) % 2.0;
                    p - 1.0
                }
                Waveform::Random => {
                    // Simplified: use sin as base for deterministic random
                    (phase * 7.0).sin()
                }
            };

            Some(slot.center + modulation * slot.depth)
        } else {
            None
        }
    }

    /// Démarre le modulator
    pub fn start(&mut self) {
        self.is_running = true;
    }

    /// Arrête le modulator
    pub fn stop(&mut self) {
        self.is_running = false;
    }

    /// Efface tous les slots
    pub fn clear(&mut self) {
        self.slots.clear();
    }

    /// Retourne le nombre de slots
    pub fn len(&self) -> usize {
        self.slots.len()
    }

    /// Vérifie si le modulator est vide
    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }
}

impl Default for Modulator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_modulator_new() {
        let modulator = Modulator::new();
        assert!(!modulator.is_running);
        assert!(modulator.is_empty());
    }

    #[test]
    fn test_add_slot() {
        let mut modulator = Modulator::new();
        modulator.add_slot("speed".to_string(), Waveform::Sine, 0.5, 0.3, 1.0);
        assert_eq!(modulator.len(), 1);
    }

    #[test]
    fn test_remove_slot() {
        let mut modulator = Modulator::new();
        modulator.add_slot("speed".to_string(), Waveform::Sine, 0.5, 0.3, 1.0);
        modulator.remove_slot("speed");
        assert!(modulator.is_empty());
    }

    #[test]
    fn test_calculate_value_sine() {
        let mut modulator = Modulator::new();
        modulator.add_slot("speed".to_string(), Waveform::Sine, 1.0, 0.5, 1.0);

        let value = modulator.calculate_value("speed", 0.0);
        assert!(value.is_some());
        // At t=0, sin(0)=0, so value = center = 1.0
        assert!((value.unwrap() - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_calculate_value_triangle() {
        let mut modulator = Modulator::new();
        modulator.add_slot("speed".to_string(), Waveform::Triangle, 1.0, 0.5, 1.0);

        let value = modulator.calculate_value("speed", 0.0);
        assert!(value.is_some());
    }

    #[test]
    fn test_start_stop() {
        let mut modulator = Modulator::new();
        modulator.start();
        assert!(modulator.is_running);
        modulator.stop();
        assert!(!modulator.is_running);
    }

    #[test]
    fn test_clear() {
        let mut modulator = Modulator::new();
        modulator.add_slot("speed".to_string(), Waveform::Sine, 0.5, 0.3, 1.0);
        modulator.clear();
        assert!(modulator.is_empty());
    }
}
