use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Manager pour les overrides de position par objet — l'ingénieur peut forcer une position manuelle
#[derive(Clone)]
pub struct OverrideManager {
    overrides: Arc<Mutex<HashMap<usize, nalgebra::Vector3<f64>>>>,
}

impl Default for OverrideManager {
    fn default() -> Self {
        Self::new()
    }
}

impl OverrideManager {
    pub fn new() -> Self {
        OverrideManager {
            overrides: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn set(&self, obj_index: usize, pos: nalgebra::Vector3<f64>) {
        if let Ok(mut ovr) = self.overrides.lock() {
            ovr.insert(obj_index, pos);
        }
    }

    pub fn clear(&self, obj_index: usize) {
        if let Ok(mut ovr) = self.overrides.lock() {
            ovr.remove(&obj_index);
        }
    }

    pub fn clear_all(&self) {
        if let Ok(mut ovr) = self.overrides.lock() {
            ovr.clear();
        }
    }

    pub fn get(&self, obj_index: usize) -> Option<nalgebra::Vector3<f64>> {
        if let Ok(ovr) = self.overrides.lock() {
            ovr.get(&obj_index).copied()
        } else {
            None
        }
    }

    pub fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<usize, nalgebra::Vector3<f64>>> {
        self.overrides.lock().unwrap_or_else(|e| e.into_inner())
    }
}
