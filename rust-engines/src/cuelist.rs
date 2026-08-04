use serde::{Deserialize, Serialize};

/// Cue - snapshot complet d'un moment du spectacle
/// Contient le graphe + les macros + les tracks ciblées + le fade
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cue {
    pub id: String,
    pub name: String,
    pub description: String,
    pub graph: serde_json::Value,
    pub timestamp: f64,
    /// Macros au moment du store (speed, scale, shift, rotation)
    #[serde(default)]
    pub macros: Option<MacroSnapshot>,
    /// Indices des tracks ciblées par ce cue (vide = tous les tracks)
    #[serde(default)]
    pub track_indices: Vec<usize>,
    /// Durée du crossfade quand on rappelle ce cue (secondes)
    #[serde(default = "default_fade")]
    pub fade_duration: f64,
    /// Numéro de cue dans la setlist (editable par l'utilisateur)
    #[serde(default)]
    pub cue_number: Option<String>,
}

/// Snapshot des macros au moment du store
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroSnapshot {
    pub speed: f64,
    pub scale: f64,
    pub shift_x: f64,
    pub shift_y: f64,
    pub shift_z: f64,
    pub yaw: f64,
    pub pitch: f64,
    pub roll: f64,
}

fn default_fade() -> f64 { 0.5 }

/// Cue List Manager - gestion des cues (snapshots de playback)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CuelistManager {
    pub cues: Vec<Cue>,
}

impl CuelistManager {
    pub fn new() -> Self {
        CuelistManager {
            cues: Vec::new(),
        }
    }

    /// Ajoute un cue
    pub fn add(&mut self, cue: Cue) {
        self.cues.push(cue);
    }

    /// Supprime un cue par index
    pub fn remove(&mut self, index: usize) -> Result<(), String> {
        if index < self.cues.len() {
            self.cues.remove(index);
            Ok(())
        } else {
            Err(format!("Index {} out of bounds", index))
        }
    }

    /// Supprime un cue par ID
    pub fn remove_by_id(&mut self, id: &str) -> Result<(), String> {
        if let Some(pos) = self.cues.iter().position(|c| c.id == id) {
            self.cues.remove(pos);
            Ok(())
        } else {
            Err(format!("Cue with id {} not found", id))
        }
    }

    /// Met à jour un cue
    pub fn update(&mut self, index: usize, cue: Cue) -> Result<(), String> {
        if index < self.cues.len() {
            self.cues[index] = cue;
            Ok(())
        } else {
            Err(format!("Index {} out of bounds", index))
        }
    }

    /// Retourne un cue par index
    pub fn get(&self, index: usize) -> Option<&Cue> {
        self.cues.get(index)
    }

    /// Retourne un cue par ID
    pub fn get_by_id(&self, id: &str) -> Option<&Cue> {
        self.cues.iter().find(|c| c.id == id)
    }

    /// Liste tous les cues
    pub fn list(&self) -> &[Cue] {
        &self.cues
    }

    /// Efface la cue list
    pub fn clear(&mut self) {
        self.cues.clear();
    }

    /// Retourne le nombre de cues
    pub fn len(&self) -> usize {
        self.cues.len()
    }

    /// Vérifie si la cue list est vide
    pub fn is_empty(&self) -> bool {
        self.cues.is_empty()
    }
}

impl Default for CuelistManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cuelist_new() {
        let manager = CuelistManager::new();
        assert!(manager.is_empty());
        assert_eq!(manager.len(), 0);
    }

    #[test]
    fn test_add_cue() {
        let mut manager = CuelistManager::new();
        let cue = Cue {
            id: "cue1".to_string(),
            name: "Test Cue".to_string(),
            description: "Test".to_string(),
            graph: serde_json::json!({}),
            timestamp: 0.0, macros: None, track_indices: vec![], fade_duration: 0.5, cue_number: None,
        };
        manager.add(cue);
        assert_eq!(manager.len(), 1);
    }

    #[test]
    fn test_remove_cue() {
        let mut manager = CuelistManager::new();
        let cue = Cue {
            id: "cue1".to_string(),
            name: "Test Cue".to_string(),
            description: "Test".to_string(),
            graph: serde_json::json!({}),
            timestamp: 0.0, macros: None, track_indices: vec![], fade_duration: 0.5, cue_number: None,
        };
        manager.add(cue);
        manager.remove(0).unwrap();
        assert!(manager.is_empty());
    }

    #[test]
    fn test_remove_by_id() {
        let mut manager = CuelistManager::new();
        let cue = Cue {
            id: "cue1".to_string(),
            name: "Test Cue".to_string(),
            description: "Test".to_string(),
            graph: serde_json::json!({}),
            timestamp: 0.0, macros: None, track_indices: vec![], fade_duration: 0.5, cue_number: None,
        };
        manager.add(cue);
        manager.remove_by_id("cue1").unwrap();
        assert!(manager.is_empty());
    }

    #[test]
    fn test_get_cue() {
        let mut manager = CuelistManager::new();
        let cue = Cue {
            id: "cue1".to_string(),
            name: "Test Cue".to_string(),
            description: "Test".to_string(),
            graph: serde_json::json!({}),
            timestamp: 0.0, macros: None, track_indices: vec![], fade_duration: 0.5, cue_number: None,
        };
        manager.add(cue.clone());
        let retrieved = manager.get(0);
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().id, "cue1");
    }

    #[test]
    fn test_get_by_id() {
        let mut manager = CuelistManager::new();
        let cue = Cue {
            id: "cue1".to_string(),
            name: "Test Cue".to_string(),
            description: "Test".to_string(),
            graph: serde_json::json!({}),
            timestamp: 0.0, macros: None, track_indices: vec![], fade_duration: 0.5, cue_number: None,
        };
        manager.add(cue);
        let retrieved = manager.get_by_id("cue1");
        assert!(retrieved.is_some());
    }

    #[test]
    fn test_update_cue() {
        let mut manager = CuelistManager::new();
        let cue = Cue {
            id: "cue1".to_string(),
            name: "Test Cue".to_string(),
            description: "Test".to_string(),
            graph: serde_json::json!({}),
            timestamp: 0.0, macros: None, track_indices: vec![], fade_duration: 0.5, cue_number: None,
        };
        manager.add(cue);
        
        let updated = Cue {
            id: "cue1".to_string(),
            name: "Updated Cue".to_string(),
            description: "Updated".to_string(),
            graph: serde_json::json!({}),
            timestamp: 1.0, macros: None, track_indices: vec![], fade_duration: 0.5, cue_number: None,
        };
        manager.update(0, updated).unwrap();
        
        let retrieved = manager.get(0).unwrap();
        assert_eq!(retrieved.name, "Updated Cue");
    }

    #[test]
    fn test_clear() {
        let mut manager = CuelistManager::new();
        let cue = Cue {
            id: "cue1".to_string(),
            name: "Test Cue".to_string(),
            description: "Test".to_string(),
            graph: serde_json::json!({}),
            timestamp: 0.0, macros: None, track_indices: vec![], fade_duration: 0.5, cue_number: None,
        };
        manager.add(cue);
        manager.clear();
        assert!(manager.is_empty());
    }
}
