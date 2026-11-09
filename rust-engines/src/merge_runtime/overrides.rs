//! Overrides opérateur + canaux spatiaux + zones — extrait de mod.rs (Phase 4).
//! track/manual positions, park, object_channels, modulations, zones, graph_effects.

use super::*;

impl MergeRuntime {
    /// Définit les positions des tracks .hol (pour Barycenter)
    pub fn set_track_positions(&self, positions: HashMap<u32, [f64; 3]>) {
        *self
            .track_positions
            .write()
            .unwrap_or_else(|e| e.into_inner()) = Arc::new(positions);
    }

    /// Définit l'origine d'UNE track — merge dans la map existante
    /// (contrairement à set_track_positions qui remplace tout : un set
    /// unitaire par OSC ne doit pas effacer les autres origines).
    pub fn set_track_position(&self, track: u32, pos: [f64; 3]) {
        let mut map = (**self
            .track_positions
            .read()
            .unwrap_or_else(|e| e.into_inner()))
        .clone();
        map.insert(track, pos);
        *self
            .track_positions
            .write()
            .unwrap_or_else(|e| e.into_inner()) = Arc::new(map);
    }

    /// Positions d'origine des tracks — pour panic hors-.hol : les
    /// origines posées par /stagespace/trackpos ou l'import .hol sont
    /// la vérité, pas un (0,0,0) en dur.
    pub fn track_positions(&self) -> HashMap<u32, [f64; 3]> {
        (**self
            .track_positions
            .read()
            .unwrap_or_else(|e| e.into_inner()))
        .clone()
    }

    /// Définit une position manuelle pour un objet (pour ManualPosition)
    pub fn set_manual_position(&self, obj_index: usize, pos: [f64; 3]) {
        self.manual_positions
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(obj_index, pos);
        // Une reprise manuelle fraîche remplace un hold éventuel.
        self.held_objects
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&obj_index);
    }

    /// Position manuelle d'un objet (None = pas de reprise manuelle) —
    /// sert au soundcheck pour restaurer la position avant le ping.
    pub fn manual_position(&self, obj_index: usize) -> Option<[f64; 3]> {
        self.manual_positions
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(&obj_index)
            .copied()
    }

    /// Toutes les positions manuelles — le frontend synchronise son cache
    /// depuis cette vérité backend (OSC /position, hold, tape, attention…
    /// n'atteignent jamais le store frontend autrement).
    pub fn manual_positions(&self) -> HashMap<usize, [f64; 3]> {
        self.manual_positions
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Efface la position manuelle pour un objet
    pub fn clear_manual_position(&self, obj_index: usize) {
        self.manual_positions
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&obj_index);
        self.held_objects
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&obj_index);
    }

    /// Efface toutes les positions manuelles
    pub fn clear_all_manual_positions(&self) {
        self.manual_positions
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.held_objects
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }

    /// Définit un canal spatial étendu pour un objet (gain, spread, distance,
    /// presence, yaw, aperture, lfe — envoyé en OSC en plus de la position)
    pub fn set_object_channel(
        &self,
        obj_index: usize,
        channel: crate::osc_sender::SpatialChannel,
        value: f64,
    ) {
        self.object_channels
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .entry(obj_index)
            .or_default()
            .set(channel, value);
    }

    /// Efface un canal spatial pour un objet (None = tous les canaux de l'objet)
    pub fn clear_object_channel(
        &self,
        obj_index: usize,
        channel: Option<crate::osc_sender::SpatialChannel>,
    ) {
        let mut channels = self
            .object_channels
            .write()
            .unwrap_or_else(|e| e.into_inner());
        match channel {
            Some(ch) => {
                if let Some(entry) = channels.get_mut(&obj_index) {
                    entry.clear(ch);
                    if entry.is_empty() {
                        channels.remove(&obj_index);
                    }
                }
            }
            None => {
                channels.remove(&obj_index);
            }
        }
    }

    /// Efface tous les canaux spatiaux de tous les objets
    /// Parke/déparke un objet — les recalls de cues ne touchent pas ses
    /// canaux (reprise manuelle prioritaire, sémantique Park des consoles).
    pub fn park_object(&self, obj: usize) {
        self.parked_objects
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(obj);
    }

    pub fn unpark_object(&self, obj: usize) {
        self.parked_objects
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&obj);
    }

    pub fn parked_objects(&self) -> HashSet<usize> {
        self.parked_objects
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Efface le park d'un objet (panic / nouveau show).
    pub fn clear_parked(&self) {
        self.parked_objects
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }

    pub fn clear_all_object_channels(&self) {
        self.object_channels
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }

    /// Récupère les canaux spatiaux actuels (pour debug/persistance)
    pub fn object_channels(&self) -> HashMap<usize, SpatialChannels> {
        self.object_channels
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Ajoute une règle de modulation cinématique (source → canal spatial).
    /// Retourne l'index de la règle (pour suppression).
    /// Copy-on-write : le merge thread ne voit qu'un snapshot Arc par frame.
    /// Nombre max de règles de modulation cinématique (audit I12) — chaque
    /// règle coûte une mesure par objet par frame ; au-delà le runtime est
    /// mal configuré, pas en train de faire de l'art.
    pub const MAX_MODULATIONS: usize = 64;

    pub fn add_modulation(&self, rule: ChannelModulation) -> Result<usize, String> {
        let mut guard = self
            .channel_modulations
            .write()
            .unwrap_or_else(|e| e.into_inner());
        if guard.len() >= Self::MAX_MODULATIONS {
            return Err(format!(
                "channel modulations capped at {} (current: {})",
                Self::MAX_MODULATIONS,
                guard.len()
            ));
        }
        let mut rules = (**guard).clone();
        rules.push(rule);
        let index = rules.len() - 1;
        *guard = Arc::new(rules);
        Ok(index)
    }

    /// Supprime une règle de modulation par index
    pub fn remove_modulation(&self, index: usize) -> bool {
        let mut guard = self
            .channel_modulations
            .write()
            .unwrap_or_else(|e| e.into_inner());
        if index < guard.len() {
            let mut rules = (**guard).clone();
            rules.remove(index);
            *guard = Arc::new(rules);
            true
        } else {
            false
        }
    }

    /// Efface toutes les règles de modulation
    pub fn clear_modulations(&self) {
        *self
            .channel_modulations
            .write()
            .unwrap_or_else(|e| e.into_inner()) = Arc::new(Vec::new());
    }

    /// Récupère les règles de modulation actives (pour debug/persistance)
    pub fn modulations(&self) -> Vec<ChannelModulation> {
        let guard = self
            .channel_modulations
            .read()
            .unwrap_or_else(|e| e.into_inner());
        (**guard).clone()
    }

    /// Définit le lissage cinématique [0, 1) — 0 = brut, 0.9 = très lissé
    pub fn set_kinematic_smoothing(&self, smoothing: f64) {
        // NaN ferait paniquer clamp ici et plus bas (défense en profondeur :
        // l'IPC valide déjà, mais CLI/tests passent par ce setter).
        if !smoothing.is_finite() {
            return;
        }
        *self
            .kinematic_smoothing
            .write()
            .unwrap_or_else(|e| e.into_inner()) = smoothing.clamp(0.0, 0.99);
    }

    /// Nombre max de zones d'effet (audit I12) — chaque zone évalue une
    /// influence par objet par frame.
    pub const MAX_ZONES: usize = 64;

    /// Ajoute une zone d'effet spatial. Retourne l'index de la zone.
    /// Copy-on-write : snapshot Arc par frame dans le merge thread.
    pub fn add_zone(&self, zone: crate::zones::Zone) -> Result<usize, String> {
        let mut guard = self.zones.write().unwrap_or_else(|e| e.into_inner());
        if guard.len() >= Self::MAX_ZONES {
            return Err(format!(
                "zones capped at {} (current: {})",
                Self::MAX_ZONES,
                guard.len()
            ));
        }
        let mut zones = (**guard).clone();
        zones.push(zone);
        let index = zones.len() - 1;
        *guard = Arc::new(zones);
        Ok(index)
    }

    /// Supprime une zone par index
    pub fn remove_zone(&self, index: usize) -> bool {
        let mut guard = self.zones.write().unwrap_or_else(|e| e.into_inner());
        if index < guard.len() {
            let mut zones = (**guard).clone();
            zones.remove(index);
            *guard = Arc::new(zones);
            true
        } else {
            false
        }
    }

    /// Remplace la zone à `index` — édition en place : l'index est préservé
    /// (aucun remove+add, la position dans la liste ne bouge pas et les
    /// autres zones ne dérivent pas). Même pattern copy-on-write que
    /// remove_zone — snapshot Arc par frame dans le merge thread.
    pub fn update_zone(&self, index: usize, zone: crate::zones::Zone) -> bool {
        let mut guard = self.zones.write().unwrap_or_else(|e| e.into_inner());
        if index < guard.len() {
            let mut zones = (**guard).clone();
            zones[index] = zone;
            *guard = Arc::new(zones);
            true
        } else {
            false
        }
    }

    /// Efface toutes les zones
    pub fn clear_zones(&self) {
        *self.zones.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(Vec::new());
    }

    /// Récupère les zones actives (pour debug/persistance)
    pub fn zones(&self) -> Vec<crate::zones::Zone> {
        let guard = self.zones.read().unwrap_or_else(|e| e.into_inner());
        (**guard).clone()
    }

    /// Remplace les effets déclarés dans le graph global (nodes `Zone` /
    /// `Velocity`). Appelé à chaque `update_global_graph` — les effets
    /// suivent le cycle de vie du graph, donc persistent via les slots/cues.
    /// Les effets manuels (add_zone/add_modulation) ne sont pas touchés.
    pub fn set_graph_effects(
        &self,
        zones: Vec<crate::zones::Zone>,
        modulations: Vec<ChannelModulation>,
        move_ref: Option<String>,
    ) {
        *self.graph_zones.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(zones);
        *self
            .graph_modulations
            .write()
            .unwrap_or_else(|e| e.into_inner()) = Arc::new(modulations);
        *self.move_ref_id.write().unwrap_or_else(|e| e.into_inner()) = move_ref;
    }

    /// Récupère les effets déclarés par le graph global (pour debug/listing)
    pub fn graph_effects(&self) -> (Vec<crate::zones::Zone>, Vec<ChannelModulation>) {
        let z = self.graph_zones.read().unwrap_or_else(|e| e.into_inner());
        let m = self
            .graph_modulations
            .read()
            .unwrap_or_else(|e| e.into_inner());
        ((**z).clone(), (**m).clone())
    }
}
