use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use nalgebra::Vector3;

/// Objet audio
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioObject {
    pub osc_id: u32,
    pub name: String,
    pub color: String,
    pub notes: String,
}

/// Groupe d'objets
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectGroup {
    pub name: String,
    pub object_ids: Vec<u32>,
    pub engine: String,
    pub params: serde_json::Value,
    pub profile: String,
    pub color: String,
    pub anchor: Vector3<f64>,
}

/// Patch Manager - gestion des objets audio et des groupes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchManager {
    pub objects: HashMap<u32, AudioObject>,
    pub groups: HashMap<String, ObjectGroup>,
}

impl PatchManager {
    pub fn new() -> Self {
        PatchManager {
            objects: HashMap::new(),
            groups: HashMap::new(),
        }
    }

    /// Liste tous les objets
    pub fn list_objects(&self) -> Vec<AudioObject> {
        self.objects.values().cloned().collect()
    }

    /// Crée ou met à jour un objet
    pub fn set_object(&mut self, osc_id: u32, name: String, color: String, notes: String) -> AudioObject {
        let obj = AudioObject {
            osc_id,
            name,
            color,
            notes,
        };
        self.objects.insert(osc_id, obj.clone());
        obj
    }

    /// Supprime un objet
    pub fn remove_object(&mut self, osc_id: u32) {
        self.objects.remove(&osc_id);
    }

    /// Retourne un objet
    pub fn get_object(&self, osc_id: u32) -> Option<&AudioObject> {
        self.objects.get(&osc_id)
    }

    /// Liste tous les groupes
    pub fn list_groups(&self) -> Vec<ObjectGroup> {
        self.groups.values().cloned().collect()
    }

    /// Crée ou met à jour un groupe
    pub fn set_group(
        &mut self,
        name: String,
        object_ids: Vec<u32>,
        engine: String,
        params: serde_json::Value,
        profile: String,
        color: String,
        anchor: Vector3<f64>,
    ) -> ObjectGroup {
        let group = ObjectGroup {
            name: name.clone(),
            object_ids,
            engine,
            params,
            profile,
            color,
            anchor,
        };
        self.groups.insert(name, group.clone());
        group
    }

    /// Supprime un groupe
    pub fn remove_group(&mut self, name: &str) {
        self.groups.remove(name);
    }

    /// Retourne un groupe
    pub fn get_group(&self, name: &str) -> Option<&ObjectGroup> {
        self.groups.get(name)
    }

    /// Convertit un groupe en paramètres de playback
    pub fn group_to_play_params(&self, name: &str, host: String, port: u16, fps: f64) -> Result<serde_json::Value, String> {
        let group = self.groups.get(name)
            .ok_or_else(|| format!("Group '{}' not found", name))?;
        
        // Filtrer les params qui ne sont pas spécifiques au moteur
        let engine_params = if let Some(params) = group.params.as_object() {
            params.iter()
                .filter(|(k, _)| !matches!(k.as_str(), "n_objects" | "object_offset"))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        } else {
            serde_json::Map::new()
        };
        
        Ok(serde_json::json!({
            "engine": group.engine,
            "profile": group.profile,
            "host": host,
            "port": port,
            "fps": fps,
            "params": engine_params,
            "object_offset": 0,
            "label": group.name,
            "shift": {
                "x": group.anchor.x,
                "y": group.anchor.y,
                "z": group.anchor.z
            }
        }))
    }

    /// Efface tout le patch
    pub fn clear(&mut self) {
        self.objects.clear();
        self.groups.clear();
    }

    /// Retourne le nombre d'objets
    pub fn object_count(&self) -> usize {
        self.objects.len()
    }

    /// Retourne le nombre de groupes
    pub fn group_count(&self) -> usize {
        self.groups.len()
    }
}

impl Default for PatchManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_patch_manager_new() {
        let manager = PatchManager::new();
        assert_eq!(manager.object_count(), 0);
        assert_eq!(manager.group_count(), 0);
    }

    #[test]
    fn test_set_object() {
        let mut manager = PatchManager::new();
        manager.set_object(1, "Track 1".to_string(), "#FF0000".to_string(), "Bass".to_string());
        assert_eq!(manager.object_count(), 1);
    }

    #[test]
    fn test_get_object() {
        let mut manager = PatchManager::new();
        manager.set_object(1, "Track 1".to_string(), "#FF0000".to_string(), "Bass".to_string());
        let obj = manager.get_object(1);
        assert!(obj.is_some());
        assert_eq!(obj.unwrap().name, "Track 1");
    }

    #[test]
    fn test_remove_object() {
        let mut manager = PatchManager::new();
        manager.set_object(1, "Track 1".to_string(), "#FF0000".to_string(), "Bass".to_string());
        manager.remove_object(1);
        assert_eq!(manager.object_count(), 0);
    }

    #[test]
    fn test_set_group() {
        let mut manager = PatchManager::new();
        manager.set_group(
            "Group 1".to_string(),
            vec![1, 2, 3],
            "circular".to_string(),
            serde_json::json!({"radius": 0.7}),
            "holophonix".to_string(),
            "#00FF00".to_string(),
            Vector3::new(0.0, 0.0, 0.0),
        );
        assert_eq!(manager.group_count(), 1);
    }

    #[test]
    fn test_get_group() {
        let mut manager = PatchManager::new();
        manager.set_group(
            "Group 1".to_string(),
            vec![1, 2, 3],
            "circular".to_string(),
            serde_json::json!({"radius": 0.7}),
            "holophonix".to_string(),
            "#00FF00".to_string(),
            Vector3::new(0.0, 0.0, 0.0),
        );
        let group = manager.get_group("Group 1");
        assert!(group.is_some());
        assert_eq!(group.unwrap().object_ids.len(), 3);
    }

    #[test]
    fn test_group_to_play_params() {
        let mut manager = PatchManager::new();
        manager.set_group(
            "Group 1".to_string(),
            vec![1, 2, 3],
            "circular".to_string(),
            serde_json::json!({"radius": 0.7, "n_objects": 3}),
            "holophonix".to_string(),
            "#00FF00".to_string(),
            Vector3::new(0.0, 0.0, 0.0),
        );
        
        let params = manager.group_to_play_params("Group 1", "127.0.0.1".to_string(), 8000, 60.0);
        assert!(params.is_ok());
        let json = params.unwrap();
        assert_eq!(json["engine"], "circular");
        assert_eq!(json["profile"], "holophonix");
    }

    #[test]
    fn test_clear() {
        let mut manager = PatchManager::new();
        manager.set_object(1, "Track 1".to_string(), "#FF0000".to_string(), "Bass".to_string());
        manager.set_group(
            "Group 1".to_string(),
            vec![1],
            "circular".to_string(),
            serde_json::json!({}),
            "holophonix".to_string(),
            "#00FF00".to_string(),
            Vector3::new(0.0, 0.0, 0.0),
        );
        manager.clear();
        assert_eq!(manager.object_count(), 0);
        assert_eq!(manager.group_count(), 0);
    }
}
