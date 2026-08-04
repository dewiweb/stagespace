use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Preset - sauvegarde de configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preset {
    pub name: String,
    pub config: serde_json::Value,
    pub timestamp: f64,
}

/// Preset Manager - sauvegarde et restauration de configurations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetManager {
    pub presets: HashMap<String, Preset>,
}

impl PresetManager {
    pub fn new() -> Self {
        PresetManager {
            presets: HashMap::new(),
        }
    }

    /// Sauvegarde un preset
    pub fn save(&mut self, name: String, config: serde_json::Value) {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        let preset = Preset {
            name: name.clone(),
            config,
            timestamp,
        };
        self.presets.insert(name, preset);
    }

    /// Charge un preset
    pub fn load(&self, name: &str) -> Option<&Preset> {
        self.presets.get(name)
    }

    /// Supprime un preset
    pub fn delete(&mut self, name: &str) -> Result<(), String> {
        if self.presets.remove(name).is_some() {
            Ok(())
        } else {
            Err(format!("Preset '{}' not found", name))
        }
    }

    /// Retourne la liste des noms de presets
    pub fn get_presets(&self) -> Vec<String> {
        self.presets.keys().cloned().collect()
    }

    /// Vérifie si un preset existe
    pub fn exists(&self, name: &str) -> bool {
        self.presets.contains_key(name)
    }

    /// Retourne le nombre de presets
    pub fn len(&self) -> usize {
        self.presets.len()
    }

    /// Vérifie si le manager est vide
    pub fn is_empty(&self) -> bool {
        self.presets.is_empty()
    }

    /// Efface tous les presets
    pub fn clear(&mut self) {
        self.presets.clear();
    }
}

impl Default for PresetManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_preset_manager_new() {
        let manager = PresetManager::new();
        assert!(manager.is_empty());
        assert_eq!(manager.len(), 0);
    }

    #[test]
    fn test_save_preset() {
        let mut manager = PresetManager::new();
        manager.save("test".to_string(), serde_json::json!({"key": "value"}));
        assert_eq!(manager.len(), 1);
        assert!(manager.exists("test"));
    }

    #[test]
    fn test_load_preset() {
        let mut manager = PresetManager::new();
        let config = serde_json::json!({"key": "value"});
        manager.save("test".to_string(), config.clone());
        
        let loaded = manager.load("test");
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap().config, config);
    }

    #[test]
    fn test_delete_preset() {
        let mut manager = PresetManager::new();
        manager.save("test".to_string(), serde_json::json!({"key": "value"}));
        manager.delete("test").unwrap();
        assert!(manager.is_empty());
    }

    #[test]
    fn test_get_presets() {
        let mut manager = PresetManager::new();
        manager.save("preset1".to_string(), serde_json::json!({}));
        manager.save("preset2".to_string(), serde_json::json!({}));
        
        let presets = manager.get_presets();
        assert_eq!(presets.len(), 2);
        assert!(presets.contains(&"preset1".to_string()));
        assert!(presets.contains(&"preset2".to_string()));
    }

    #[test]
    fn test_clear() {
        let mut manager = PresetManager::new();
        manager.save("test".to_string(), serde_json::json!({}));
        manager.clear();
        assert!(manager.is_empty());
    }

    #[test]
    fn test_delete_nonexistent() {
        let mut manager = PresetManager::new();
        let result = manager.delete("nonexistent");
        assert!(result.is_err());
    }
}
