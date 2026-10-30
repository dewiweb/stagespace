use crate::graph_json::GraphJson;
use crate::kinematics::ChannelModulation;
use crate::osc_receiver::OscMapping;
use crate::osc_sender::SpatialChannels;
use crate::zones::Zone;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

fn default_true() -> bool {
    true
}

/// Scope d'une cue Tracking : quelles catégories le recall touche.
/// Les catégories objet (channels/positions) sont restreintes par
/// `track_indices` quand il est non vide.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub struct CueScope {
    #[serde(default = "default_true")]
    pub moves: bool,
    #[serde(default = "default_true")]
    pub channels: bool,
    #[serde(default = "default_true")]
    pub positions: bool,
    #[serde(default = "default_true")]
    pub zones: bool,
    #[serde(default = "default_true")]
    pub global_graph: bool,
    #[serde(default = "default_true")]
    pub signal_graph: bool,
    #[serde(default = "default_true")]
    pub macros: bool,
    #[serde(default = "default_true")]
    pub osc_mappings: bool,
}

/// Scope non précisé = tout appliquer — mêmes défauts que le serde
/// (`default_true`) : une cue Tracking sans scope explicite se comporte
/// comme Full côté catégories (merge/no-kill en plus).
impl Default for CueScope {
    fn default() -> Self {
        Self {
            moves: true,
            channels: true,
            positions: true,
            zones: true,
            global_graph: true,
            signal_graph: true,
            macros: true,
            osc_mappings: true,
        }
    }
}

/// Mode d'une cue : Full = snapshot complet ; Tracking = n'applique que
/// les catégories cochées (cue incrémentale — les moves non listés
/// tournent encore, canaux/positions mergés jamais clear-all).
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub enum CueMode {
    #[default]
    Full,
    Tracking,
}

/// Version courante du schéma Cue. Cues sans le champ = legacy (0).
pub const CUE_SCHEMA_VERSION: u32 = 1;

/// Cue - snapshot complet d'un moment du spectacle
/// Contient le graphe + les macros + les tracks ciblées + le fade
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Cue {
    pub id: String,
    /// Version du schéma — le backend rejette les cues d'une version future.
    #[serde(default)]
    #[ts(optional)]
    #[ts(type = "number | null")]
    pub schema_version: Option<u32>,
    pub name: String,
    pub description: String,
    /// Sub-graph du move principal (contrat `GraphJson` — legacy accepté,
    /// version rejetée si > courante au recall).
    pub graph: GraphJson,
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

    // ─── Phase 3 : champs étendus ───
    /// Graph global (post-processing) au moment du store.
    /// Si présent, sera hot-swappé lors du recall.
    #[serde(default)]
    pub global_graph: Option<GraphJson>,

    /// Graph de modulation global (domaine signal → deltas de macros) au
    /// moment du store. Si présent, recompilé + swappé lors du recall.
    #[serde(default)]
    pub signal_graph: Option<GraphJson>,

    /// IDs des moves actifs au moment du store.
    /// Lors du recall : désactive les moves non listés, active ceux listés.
    #[serde(default)]
    pub active_move_ids: Vec<String>,

    /// Profondeurs par track (pour PerTrackDepth node)
    #[serde(default)]
    pub per_track_depths: Vec<f64>,

    /// Positions manuelles (drag 3D) — object_index → [x, y, z]
    #[serde(default)]
    pub manual_positions: HashMap<usize, [f64; 3]>,

    /// Snapshot des macros spatiales étendues (radius_scale, height_offset)
    #[serde(default)]
    pub spatial_macros: Option<SpatialMacroSnapshot>,

    // ─── Phase 4 : état runtime capturé au store ───
    /// Canaux spatiaux étendus par objet (P1) — object_index → SpatialChannels.
    /// None (cue ancien) = ne pas toucher à l'état courant ; Some (même vide)
    /// = restaurer exactement (clear + re-set).
    #[serde(default)]
    pub object_channels: Option<HashMap<usize, SpatialChannels>>,

    /// Règles de modulation cinématique (P2)
    #[serde(default)]
    pub channel_modulations: Option<Vec<ChannelModulation>>,

    /// Mappings OSC IN (P3)
    #[serde(default)]
    pub osc_mappings: Option<Vec<OscMapping>>,

    /// Zones d'effets spatiaux (P4)
    #[serde(default)]
    pub zones: Option<Vec<Zone>>,

    // ─── Phase 5 : snapshots des moves (cue recall côté serveur) ───
    /// Snapshot complet de chaque move actif au moment du store — assez pour
    /// que `recall_cue` puisse les recréer seul (sub-graph, tracks, loop…).
    /// Champ absent (ancien cue) = recall ne touche pas aux moves.
    #[serde(default)]
    pub moves: Vec<MoveSnapshot>,

    /// Mode de la cue (Full par défaut — anciens cues = Full).
    #[serde(default)]
    pub mode: CueMode,

    /// Portée d'une cue Tracking — ignorée en mode Full.
    #[serde(default)]
    pub scope: CueScope,

    /// Attente avant exécution (secondes) — jouée par le frontend avant
    /// d'appeler le recall.
    #[serde(default)]
    pub pre_wait: f64,

    /// Follow : auto-GO de la cue suivante ce nombre de secondes après
    /// l'exécution (None = pas de follow).
    #[serde(default)]
    pub follow: Option<f64>,

    /// Timecode de déclenchement (secondes) — la chasse TC rappelle la
    /// cue quand le TC la franchit.
    #[serde(default)]
    pub timecode: Option<f64>,
}

/// Snapshot d'un move actif — capturé par `store_cue`, rejoué par `recall_cue`.
/// Contient tout ce qu'il faut pour recréer le worker (graph_json → compile →
/// play_compiled → register_move dans le MergeRuntime).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MoveSnapshot {
    /// Id du movement (clé dans la map des moves actifs)
    #[serde(default)]
    pub id: String,
    /// Nom affiché
    pub name: String,
    /// Sub-graph JSON (nodes/edges) — recompilé au recall
    #[serde(default)]
    pub graph_json: GraphJson,
    /// Graph de modulation per-move (domaine signal) — recompilé au recall
    /// si présent (`update_signal_graph` hot-swap la `SignalFn`).
    #[serde(default)]
    pub signal_graph: Option<GraphJson>,
    /// OSC ids ciblés par le move
    #[serde(default)]
    pub osc_ids: Vec<u32>,
    /// Indices des tracks dans la liste globale (mapping merge → osc_ids)
    #[serde(default)]
    pub track_indices: Vec<usize>,
    /// Move en preview (pas de sortie OSC)
    #[serde(default)]
    pub is_preview: bool,
    /// Origin (isobarycentre des tracks) au moment de l'activation
    #[serde(default)]
    pub origin: Option<[f64; 3]>,
    /// Durée du move (secondes) — pour le loop
    #[serde(default = "default_move_duration")]
    pub duration: f64,
    /// Loop mode : "loop" | "oneshot"
    #[serde(default = "default_move_loop_mode")]
    pub loop_mode: String,
    /// Direction : "forward" | "backward" | "ping_pong"
    #[serde(default = "default_move_direction")]
    pub direction: String,
    /// État d'exécution (track depths, phase offsets, audio mods) — restauré
    /// au recall. `unknown` côté TS : le frontend ne le lit pas.
    #[serde(default)]
    #[ts(type = "unknown")]
    pub animation_state: Option<crate::animation::AnimationState>,
    /// Enveloppe de fade du cycle worker (fade-in/out en début/fin de boucle)
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
}

fn default_move_duration() -> f64 {
    4.0
}

fn default_move_loop_mode() -> String {
    "loop".to_string()
}

fn default_move_direction() -> String {
    "forward".to_string()
}

/// Snapshot des macros spatiales étendues
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SpatialMacroSnapshot {
    pub radius_scale: f64,
    pub height_offset: f64,
}

/// Snapshot des macros au moment du store
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
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

fn default_fade() -> f64 {
    0.5
}

/// Cue List Manager - gestion des cues (snapshots de playback)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CuelistManager {
    pub cues: Vec<Cue>,
}

impl CuelistManager {
    pub fn new() -> Self {
        CuelistManager { cues: Vec::new() }
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
            Err(format!("Index {index} out of bounds"))
        }
    }

    /// Supprime un cue par ID
    pub fn remove_by_id(&mut self, id: &str) -> Result<(), String> {
        if let Some(pos) = self.cues.iter().position(|c| c.id == id) {
            self.cues.remove(pos);
            Ok(())
        } else {
            Err(format!("Cue with id {id} not found"))
        }
    }

    /// Met à jour un cue
    pub fn update(&mut self, index: usize, cue: Cue) -> Result<(), String> {
        if index < self.cues.len() {
            self.cues[index] = cue;
            Ok(())
        } else {
            Err(format!("Index {index} out of bounds"))
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
#[allow(clippy::field_reassign_with_default)]
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
            schema_version: None,
            name: "Test Cue".to_string(),
            description: "Test".to_string(),
            graph: serde_json::from_value(serde_json::json!({})).unwrap(),
            timestamp: 0.0,
            macros: None,
            track_indices: vec![],
            fade_duration: 0.5,
            cue_number: None,
            global_graph: None,
            signal_graph: None,
            active_move_ids: vec![],
            per_track_depths: vec![],
            manual_positions: HashMap::new(),
            spatial_macros: None,
            object_channels: None,
            channel_modulations: None,
            osc_mappings: None,
            zones: None,
            moves: vec![],
            ..Default::default()
        };
        manager.add(cue);
        assert_eq!(manager.len(), 1);
    }

    #[test]
    fn test_remove_cue() {
        let mut manager = CuelistManager::new();
        let cue = Cue {
            id: "cue1".to_string(),
            schema_version: None,
            name: "Test Cue".to_string(),
            description: "Test".to_string(),
            graph: serde_json::from_value(serde_json::json!({})).unwrap(),
            timestamp: 0.0,
            macros: None,
            track_indices: vec![],
            fade_duration: 0.5,
            cue_number: None,
            global_graph: None,
            signal_graph: None,
            active_move_ids: vec![],
            per_track_depths: vec![],
            manual_positions: HashMap::new(),
            spatial_macros: None,
            object_channels: None,
            channel_modulations: None,
            osc_mappings: None,
            zones: None,
            moves: vec![],
            ..Default::default()
        };
        manager.add(cue);
        manager.remove(0).unwrap();
        assert!(manager.is_empty());
    }

    #[test]
    fn test_cue_extended_fields_serialization() {
        let mut manual_pos = HashMap::new();
        manual_pos.insert(0, [1.0, 2.0, 3.0]);
        manual_pos.insert(2, [-1.0, 0.0, 0.5]);

        let cue = Cue {
            id: "cue-ext".to_string(),
            schema_version: None,
            name: "Extended Cue".to_string(),
            description: "Test with Phase 3 fields".to_string(),
            graph: serde_json::from_value(serde_json::json!({"nodes": []})).unwrap(),
            timestamp: 12345.0,
            macros: Some(MacroSnapshot {
                speed: 1.5,
                scale: 2.0,
                shift_x: 0.1,
                shift_y: 0.2,
                shift_z: 0.3,
                yaw: 0.0,
                pitch: 0.0,
                roll: 0.0,
            }),
            track_indices: vec![0, 1, 2],
            fade_duration: 1.0,
            cue_number: Some("1.1".to_string()),
            global_graph: Some(
                serde_json::from_value(
                    serde_json::json!({"nodes": [{"id": "g1", "type": "RadiusScale"}]}),
                )
                .unwrap(),
            ),
            signal_graph: None,
            active_move_ids: vec!["move-a".to_string(), "move-b".to_string()],
            per_track_depths: vec![0.5, 1.0, 1.5],
            manual_positions: manual_pos,
            spatial_macros: Some(SpatialMacroSnapshot {
                radius_scale: 1.2,
                height_offset: -0.3,
            }),
            object_channels: None,
            channel_modulations: None,
            osc_mappings: None,
            zones: None,
            moves: vec![],
            ..Default::default()
        };

        // Sérialiser
        let json = serde_json::to_string(&cue).unwrap();
        assert!(json.contains("global_graph"));
        assert!(json.contains("active_move_ids"));
        assert!(json.contains("per_track_depths"));
        assert!(json.contains("manual_positions"));
        assert!(json.contains("spatial_macros"));

        // Desérialiser
        let decoded: Cue = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.id, "cue-ext");
        assert_eq!(decoded.active_move_ids.len(), 2);
        assert_eq!(decoded.per_track_depths, vec![0.5, 1.0, 1.5]);
        assert_eq!(decoded.manual_positions.get(&0), Some(&[1.0, 2.0, 3.0]));
        assert!(decoded.spatial_macros.is_some());
        assert!(decoded.global_graph.is_some());
    }

    #[test]
    fn test_cue_phase4_fields_roundtrip() {
        use crate::osc_receiver::{MappingDestination, ObjectRef, Transform};
        use crate::osc_sender::SpatialChannel;
        use crate::zones::ZoneShape;

        let mut chs = SpatialChannels::default();
        chs.gain = Some(0.8);
        let mut object_channels = HashMap::new();
        object_channels.insert(2usize, chs);

        let mut zone_channels = SpatialChannels::default();
        zone_channels.set(SpatialChannel::Spread, 1.0);

        let cue = Cue {
            id: "p4".to_string(),
            schema_version: None,
            name: "Phase4".to_string(),
            description: String::new(),
            graph: serde_json::from_value(serde_json::json!({})).unwrap(),
            timestamp: 0.0,
            macros: None,
            track_indices: vec![],
            fade_duration: 0.5,
            cue_number: None,
            global_graph: None,
            signal_graph: None,
            active_move_ids: vec![],
            per_track_depths: vec![],
            manual_positions: HashMap::new(),
            spatial_macros: None,
            object_channels: Some(object_channels),
            channel_modulations: Some(vec![ChannelModulation::new(
                crate::kinematics::KinematicSource::Speed,
                SpatialChannel::Spread,
                0.5,
            )]),
            osc_mappings: Some(vec![OscMapping {
                address: "/track/*/gain".to_string(),
                destination: MappingDestination::Channel {
                    channel: SpatialChannel::Gain,
                    object: ObjectRef::Wildcard("*".to_string()),
                },
                transform: Transform::default(),
                enabled: true,
            }]),
            zones: Some(vec![Zone {
                shape: ZoneShape::Sphere {
                    center: [0.0; 3],
                    radius: 2.0,
                },
                falloff: 0.5,
                channels: zone_channels,
                objects: None,
                enabled: true,
            }]),
            moves: vec![],
            ..Default::default()
        };

        let json = serde_json::to_string(&cue).unwrap();
        let decoded: Cue = serde_json::from_str(&json).unwrap();
        assert_eq!(
            decoded
                .object_channels
                .as_ref()
                .and_then(|m| m.get(&2))
                .and_then(|c| c.gain),
            Some(0.8)
        );
        assert_eq!(decoded.channel_modulations.as_ref().unwrap().len(), 1);
        assert_eq!(decoded.osc_mappings.as_ref().unwrap().len(), 1);
        assert_eq!(decoded.zones.as_ref().unwrap().len(), 1);
    }

    #[test]
    fn test_cue_backward_compatibility() {
        // Un cue sérialisé sans les nouveaux champs (version antérieure)
        // doit pouvoir être desérialisé avec les valeurs par défaut.
        let old_json = r#"{
            "id": "old-cue",
            "name": "Old Cue",
            "description": "Pre-Phase-3 cue",
            "graph": {},
            "timestamp": 100.0,
            "macros": null,
            "track_indices": [],
            "fade_duration": 0.5,
            "cue_number": null
        }"#;

        let cue: Cue = serde_json::from_str(old_json).unwrap();
        assert_eq!(cue.id, "old-cue");
        assert!(cue.global_graph.is_none());
        assert!(cue.active_move_ids.is_empty());
        assert!(cue.per_track_depths.is_empty());
        assert!(cue.manual_positions.is_empty());
        assert!(cue.spatial_macros.is_none());
        // Phase 4 : champs absents → None (le recall ne touche pas à l'état)
        assert!(cue.object_channels.is_none());
        assert!(cue.channel_modulations.is_none());
        assert!(cue.osc_mappings.is_none());
        assert!(cue.zones.is_none());
    }

    #[test]
    fn test_remove_by_id() {
        let mut manager = CuelistManager::new();
        let cue = Cue {
            id: "cue1".to_string(),
            schema_version: None,
            name: "Test Cue".to_string(),
            description: "Test".to_string(),
            graph: serde_json::from_value(serde_json::json!({})).unwrap(),
            timestamp: 0.0,
            macros: None,
            track_indices: vec![],
            fade_duration: 0.5,
            cue_number: None,
            global_graph: None,
            signal_graph: None,
            active_move_ids: vec![],
            per_track_depths: vec![],
            manual_positions: HashMap::new(),
            spatial_macros: None,
            object_channels: None,
            channel_modulations: None,
            osc_mappings: None,
            zones: None,
            moves: vec![],
            ..Default::default()
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
            schema_version: None,
            name: "Test Cue".to_string(),
            description: "Test".to_string(),
            graph: serde_json::from_value(serde_json::json!({})).unwrap(),
            timestamp: 0.0,
            macros: None,
            track_indices: vec![],
            fade_duration: 0.5,
            cue_number: None,
            global_graph: None,
            signal_graph: None,
            active_move_ids: vec![],
            per_track_depths: vec![],
            manual_positions: HashMap::new(),
            spatial_macros: None,
            object_channels: None,
            channel_modulations: None,
            osc_mappings: None,
            zones: None,
            moves: vec![],
            ..Default::default()
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
            schema_version: None,
            name: "Test Cue".to_string(),
            description: "Test".to_string(),
            graph: serde_json::from_value(serde_json::json!({})).unwrap(),
            timestamp: 0.0,
            macros: None,
            track_indices: vec![],
            fade_duration: 0.5,
            cue_number: None,
            global_graph: None,
            signal_graph: None,
            active_move_ids: vec![],
            per_track_depths: vec![],
            manual_positions: HashMap::new(),
            spatial_macros: None,
            object_channels: None,
            channel_modulations: None,
            osc_mappings: None,
            zones: None,
            moves: vec![],
            ..Default::default()
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
            schema_version: None,
            name: "Test Cue".to_string(),
            description: "Test".to_string(),
            graph: serde_json::from_value(serde_json::json!({})).unwrap(),
            timestamp: 0.0,
            macros: None,
            track_indices: vec![],
            fade_duration: 0.5,
            cue_number: None,
            global_graph: None,
            signal_graph: None,
            active_move_ids: vec![],
            per_track_depths: vec![],
            manual_positions: HashMap::new(),
            spatial_macros: None,
            object_channels: None,
            channel_modulations: None,
            osc_mappings: None,
            zones: None,
            moves: vec![],
            ..Default::default()
        };
        manager.add(cue);

        let updated = Cue {
            id: "cue1".to_string(),
            schema_version: None,
            name: "Updated Cue".to_string(),
            description: "Updated".to_string(),
            graph: serde_json::from_value(serde_json::json!({})).unwrap(),
            timestamp: 1.0,
            macros: None,
            track_indices: vec![],
            fade_duration: 0.5,
            cue_number: None,
            global_graph: None,
            signal_graph: None,
            active_move_ids: vec![],
            per_track_depths: vec![],
            manual_positions: HashMap::new(),
            spatial_macros: None,
            object_channels: None,
            channel_modulations: None,
            osc_mappings: None,
            zones: None,
            moves: vec![],
            ..Default::default()
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
            schema_version: None,
            name: "Test Cue".to_string(),
            description: "Test".to_string(),
            graph: serde_json::from_value(serde_json::json!({})).unwrap(),
            timestamp: 0.0,
            macros: None,
            track_indices: vec![],
            fade_duration: 0.5,
            cue_number: None,
            global_graph: None,
            signal_graph: None,
            active_move_ids: vec![],
            per_track_depths: vec![],
            manual_positions: HashMap::new(),
            spatial_macros: None,
            object_channels: None,
            channel_modulations: None,
            osc_mappings: None,
            zones: None,
            moves: vec![],
            ..Default::default()
        };
        manager.add(cue);
        manager.clear();
        assert!(manager.is_empty());
    }
}
