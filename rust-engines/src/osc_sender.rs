use nalgebra::Vector3;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::HashMap;
use std::str::FromStr;
use ts_rs::TS;

/// Canaux spatiaux étendus — au-delà de la position (modèle ToscA).
/// Chaque canal Option<f64> : None = non envoyé (pas de trafic OSC inutile).
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
pub struct SpatialChannels {
    /// Gain de la source (dB ou normalisé selon profil)
    pub gain: Option<f64>,
    /// Spread/largeur de source, normalisé 0-1 (converti par profil)
    pub spread: Option<f64>,
    /// Distance explicite (override — les profils polaires l'ont déjà dans AED)
    pub distance: Option<f64>,
    /// Presence (IRCAM Spat, dB)
    pub presence: Option<f64>,
    /// Orientation de la source (degrés)
    pub yaw: Option<f64>,
    /// Aperture (IRCAM Spat, degrés)
    pub aperture: Option<f64>,
    /// Send LFE (dB)
    pub lfe: Option<f64>,
}

impl SpatialChannels {
    /// Retourne true si aucun canal n'est défini
    pub fn is_empty(&self) -> bool {
        self.gain.is_none()
            && self.spread.is_none()
            && self.distance.is_none()
            && self.presence.is_none()
            && self.yaw.is_none()
            && self.aperture.is_none()
            && self.lfe.is_none()
    }

    /// Définit un canal
    pub fn set(&mut self, channel: SpatialChannel, value: f64) {
        match channel {
            SpatialChannel::Gain => self.gain = Some(value),
            SpatialChannel::Spread => self.spread = Some(value),
            SpatialChannel::Distance => self.distance = Some(value),
            SpatialChannel::Presence => self.presence = Some(value),
            SpatialChannel::Yaw => self.yaw = Some(value),
            SpatialChannel::Aperture => self.aperture = Some(value),
            SpatialChannel::Lfe => self.lfe = Some(value),
        }
    }

    /// Surcharge les canaux définis dans `other` (les Some d'other
    /// remplacent les valeurs de self ; les None d'other sont ignorés).
    /// Utilisé pour que les canaux modulés (cinématique) aient priorité
    /// sur les canaux statiques.
    pub fn overlay(&mut self, other: &SpatialChannels) {
        if other.gain.is_some() {
            self.gain = other.gain;
        }
        if other.spread.is_some() {
            self.spread = other.spread;
        }
        if other.distance.is_some() {
            self.distance = other.distance;
        }
        if other.presence.is_some() {
            self.presence = other.presence;
        }
        if other.yaw.is_some() {
            self.yaw = other.yaw;
        }
        if other.aperture.is_some() {
            self.aperture = other.aperture;
        }
        if other.lfe.is_some() {
            self.lfe = other.lfe;
        }
    }

    /// Lit un canal (None si non défini)
    pub fn get(&self, channel: SpatialChannel) -> Option<f64> {
        match channel {
            SpatialChannel::Gain => self.gain,
            SpatialChannel::Spread => self.spread,
            SpatialChannel::Distance => self.distance,
            SpatialChannel::Presence => self.presence,
            SpatialChannel::Yaw => self.yaw,
            SpatialChannel::Aperture => self.aperture,
            SpatialChannel::Lfe => self.lfe,
        }
    }

    /// Itère sur les canaux définis (Some uniquement)
    pub fn iter(&self) -> impl Iterator<Item = (SpatialChannel, f64)> + '_ {
        [
            (SpatialChannel::Gain, self.gain),
            (SpatialChannel::Spread, self.spread),
            (SpatialChannel::Distance, self.distance),
            (SpatialChannel::Presence, self.presence),
            (SpatialChannel::Yaw, self.yaw),
            (SpatialChannel::Aperture, self.aperture),
            (SpatialChannel::Lfe, self.lfe),
        ]
        .into_iter()
        .filter_map(|(ch, v)| v.map(|v| (ch, v)))
    }

    /// Efface un canal
    pub fn clear(&mut self, channel: SpatialChannel) {
        match channel {
            SpatialChannel::Gain => self.gain = None,
            SpatialChannel::Spread => self.spread = None,
            SpatialChannel::Distance => self.distance = None,
            SpatialChannel::Presence => self.presence = None,
            SpatialChannel::Yaw => self.yaw = None,
            SpatialChannel::Aperture => self.aperture = None,
            SpatialChannel::Lfe => self.lfe = None,
        }
    }
}

/// Identifiant d'un canal spatial étendu
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[ts(export)]
pub enum SpatialChannel {
    Gain,
    Spread,
    Distance,
    Presence,
    Yaw,
    Aperture,
    Lfe,
}

impl FromStr for SpatialChannel {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "gain" => Ok(SpatialChannel::Gain),
            "spread" | "width" => Ok(SpatialChannel::Spread),
            "distance" | "dist" => Ok(SpatialChannel::Distance),
            "presence" => Ok(SpatialChannel::Presence),
            "yaw" | "orientation" => Ok(SpatialChannel::Yaw),
            "aperture" => Ok(SpatialChannel::Aperture),
            "lfe" => Ok(SpatialChannel::Lfe),
            _ => Err(format!("Unknown spatial channel: {s}")),
        }
    }
}

/// Profils OSC disponibles
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OscProfile {
    IEMMultiEncoder,
    Holophonix,
    IRCAMSpat,
    GenericCartesian,
    GenericPolar,
    ADMOSC,
}

impl FromStr for OscProfile {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "iem" | "iem_multi_encoder" | "iemmultiencoder" => Ok(OscProfile::IEMMultiEncoder),
            "holophonix" => Ok(OscProfile::Holophonix),
            "ircam" | "ircam_spat" | "ircamspat" => Ok(OscProfile::IRCAMSpat),
            "generic" | "generic_cartesian" | "genericcartesian" => {
                Ok(OscProfile::GenericCartesian)
            }
            "generic_polar" | "genericpolar" => Ok(OscProfile::GenericPolar),
            "adm" | "adm_osc" | "admosc" => Ok(OscProfile::ADMOSC),
            _ => Err(format!("Unknown OSC profile: {s}")),
        }
    }
}

impl OscProfile {
    pub fn default_port(&self) -> u16 {
        match self {
            OscProfile::IEMMultiEncoder => 9000,
            OscProfile::Holophonix => 8000,
            OscProfile::IRCAMSpat => 8000,
            OscProfile::GenericCartesian => 7000,
            OscProfile::GenericPolar => 7001,
            OscProfile::ADMOSC => 8001,
        }
    }

    /// Matrice de capacités : adresse OSC d'un canal étendu selon le profil.
    ///
    /// Retourne `Some(adresse)` si le profil supporte le canal, `None` sinon.
    /// Matrice conservatrice : seuls les canaux confirmés sont mappés
    /// (extensible sans casser l'API).
    fn channel_address(&self, osc_id: u32, channel: SpatialChannel) -> Option<String> {
        match (self, channel) {
            (OscProfile::IRCAMSpat, SpatialChannel::Gain) => Some(format!("/source/{osc_id}/gain")),
            (OscProfile::IRCAMSpat, SpatialChannel::Spread) => {
                Some(format!("/source/{osc_id}/spread"))
            }
            (OscProfile::IRCAMSpat, SpatialChannel::Distance) => {
                Some(format!("/source/{osc_id}/distance"))
            }
            (OscProfile::IRCAMSpat, SpatialChannel::Presence) => {
                Some(format!("/source/{osc_id}/presence"))
            }
            (OscProfile::IRCAMSpat, SpatialChannel::Yaw) => Some(format!("/source/{osc_id}/yaw")),
            (OscProfile::IRCAMSpat, SpatialChannel::Aperture) => {
                Some(format!("/source/{osc_id}/aperture"))
            }
            (OscProfile::IRCAMSpat, SpatialChannel::Lfe) => Some(format!("/source/{osc_id}/lfe")),
            (OscProfile::Holophonix, SpatialChannel::Gain) => Some(format!("/track/{osc_id}/gain")),
            (OscProfile::ADMOSC, SpatialChannel::Gain) => Some(format!("/adm/obj/{osc_id}/gain")),
            (OscProfile::ADMOSC, SpatialChannel::Spread) => {
                Some(format!("/adm/obj/{osc_id}/width"))
            }
            (OscProfile::ADMOSC, SpatialChannel::Distance) => {
                Some(format!("/adm/obj/{osc_id}/dist"))
            }
            (OscProfile::GenericCartesian | OscProfile::GenericPolar, SpatialChannel::Gain) => {
                Some(format!("/object/{osc_id}/gain"))
            }
            (OscProfile::GenericCartesian | OscProfile::GenericPolar, SpatialChannel::Spread) => {
                Some(format!("/object/{osc_id}/spread"))
            }
            (OscProfile::GenericCartesian | OscProfile::GenericPolar, SpatialChannel::Distance) => {
                Some(format!("/object/{osc_id}/distance"))
            }
            (OscProfile::GenericCartesian | OscProfile::GenericPolar, SpatialChannel::Yaw) => {
                Some(format!("/object/{osc_id}/yaw"))
            }
            _ => None,
        }
    }
}

/// OSC Sender - envoi OSC avec différents profils
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OscSender {
    pub profile: OscProfile,
    pub host: String,
    pub port: u16,
    pub object_offset: u32,
    pub label: String,
    pub speed: f64,
    pub scale: f64,
    pub shift: Vector3<f64>,
    pub turbulence: f64,
    /// Cache des adresses OSC formatées : clé (tag profil, osc_id, canal ou -1
    /// pour la position). L'alloc `format!()` se fait une fois par
    /// (profil, id) au lieu d'une fois par objet par frame à 60fps.
    /// RefCell est sûr ici : OscSender n'est jamais partagé en `&self` entre
    /// threads (toujours derrière un Mutex dans Runtime/MergeRuntime).
    /// Invalide automatiquement sur changement de profil ou d'object_offset
    /// (déjà inclus dans la clé).
    #[serde(skip)]
    addr_cache: RefCell<HashMap<(u8, u32, i8), String>>,
}

impl OscSender {
    pub fn new(profile: OscProfile, host: String, port: u16) -> Self {
        OscSender {
            profile,
            host,
            port,
            object_offset: 0,
            label: String::new(),
            speed: 1.0,
            scale: 1.0,
            shift: Vector3::new(0.0, 0.0, 0.0),
            turbulence: 0.0,
            addr_cache: RefCell::new(HashMap::new()),
        }
    }

    /// Retourne le nom du profil OSC
    pub fn profile_name(&self) -> &str {
        match self.profile {
            OscProfile::IEMMultiEncoder => "iem",
            OscProfile::Holophonix => "holophonix",
            OscProfile::IRCAMSpat => "ircam",
            OscProfile::GenericCartesian => "generic",
            OscProfile::GenericPolar => "generic_polar",
            OscProfile::ADMOSC => "adm",
        }
    }

    /// Retourne l'adresse de destination (host:port)
    pub fn destination(&self) -> (String, u16) {
        (self.host.clone(), self.port)
    }

    /// Tag discriminant du profil — composante de la clé de cache d'adresses
    /// (invalide automatiquement le cache si le profil change)
    fn profile_tag(&self) -> u8 {
        match self.profile {
            OscProfile::IEMMultiEncoder => 0,
            OscProfile::Holophonix => 1,
            OscProfile::IRCAMSpat => 2,
            OscProfile::GenericCartesian => 3,
            OscProfile::GenericPolar => 4,
            OscProfile::ADMOSC => 5,
        }
    }

    /// Adresse de position d'un objet — résultat mis en cache (l'allocation
    /// `format!()` ne se fait qu'une fois par (profil, osc_id) au lieu d'une
    /// fois par objet par frame). `osc_id` inclut déjà `object_offset`.
    fn position_address(&self, osc_id: u32) -> String {
        let key = (self.profile_tag(), osc_id, -1i8);
        if let Some(addr) = self.addr_cache.borrow().get(&key) {
            return addr.clone();
        }
        let addr = match &self.profile {
            OscProfile::IEMMultiEncoder => format!("/MultiEncoder/{osc_id}/aed"),
            OscProfile::Holophonix => format!("/track/{osc_id}/xyz"),
            OscProfile::IRCAMSpat => format!("/source/{osc_id}/xyz"),
            OscProfile::GenericCartesian => format!("/object/{osc_id}/xyz"),
            OscProfile::GenericPolar => format!("/object/{osc_id}"),
            OscProfile::ADMOSC => format!("/adm/source/{osc_id}/aed"),
        };
        self.addr_cache.borrow_mut().insert(key, addr.clone());
        addr
    }

    /// Adresse d'un canal étendu — `None` si le profil ne supporte pas le
    /// canal (matrice de capacités, voir [`OscProfile::channel_address`]).
    /// Mise en cache comme [`Self::position_address`].
    fn channel_address_cached(&self, osc_id: u32, channel: SpatialChannel) -> Option<String> {
        let key = (self.profile_tag(), osc_id, channel as i8);
        if let Some(addr) = self.addr_cache.borrow().get(&key) {
            return Some(addr.clone());
        }
        let addr = self.profile.channel_address(osc_id, channel);
        if let Some(ref a) = addr {
            self.addr_cache.borrow_mut().insert(key, a.clone());
        }
        addr
    }

    /// Conversion de valeur d'un canal selon le profil :
    /// `spread` est stocké normalisé 0-1 → converti en 0-100 pour IRCAM Spat.
    /// Identité pour tous les autres canaux/profils.
    fn channel_convert(&self, channel: SpatialChannel, value: f64) -> f64 {
        match (&self.profile, channel) {
            (&OscProfile::IRCAMSpat, SpatialChannel::Spread) => value * 100.0,
            _ => value,
        }
    }

    /// Convertit une position cartésienne en format selon le profil
    pub fn format_position(&self, object_id: u32, position: Vector3<f64>) -> (String, Vec<f64>) {
        let osc_id = object_id + self.object_offset;

        // Appliquer les macros (speed est appliquée par le runtime sur t, pas ici)
        let mut pos = position;
        pos.x = pos.x * self.scale + self.shift.x;
        pos.y = pos.y * self.scale + self.shift.y;
        pos.z = pos.z * self.scale + self.shift.z;

        // Appliquer turbulence — offset statique déterministe par objet.
        // NOTE : la seed dépend UNIQUEMENT de object_id — le bruit est figé
        // dans le temps (offset spatial constant par objet, pas une animation
        // de bruit). Rendre la turbulence temporelle demanderait un paramètre
        // `t` dans la signature de format_position.
        if self.turbulence > 0.0 {
            use crate::rng::SimpleRng;
            // Seed déterministe : fonction de object_id uniquement
            let t_hash = (object_id as u64).wrapping_mul(0x9E3779B97F4A7C15);
            let mut rng = SimpleRng::new(t_hash);
            // Bruit gaussien multiplié par l'amplitude de turbulence
            let noise_x = rng.randn() * self.turbulence;
            let noise_y = rng.randn() * self.turbulence;
            let noise_z = rng.randn() * self.turbulence;
            pos.x += noise_x;
            pos.y += noise_y;
            pos.z += noise_z;
        }

        match &self.profile {
            OscProfile::IEMMultiEncoder => {
                // IEM MultiEncoder (Ambisonics) - Polar coordinates.
                // Convention interne : azim 0 = front (+Y), >0 vers +X →
                // atan2(x, y) et non atan2(y, x) (qui mesurait depuis +X).
                let azimuth = pos.x.atan2(pos.y).to_degrees();
                let horizontal = (pos.x.powi(2) + pos.y.powi(2)).sqrt();
                let elevation = pos.z.atan2(horizontal).to_degrees();
                // Distance = norme 3D — une source sur l'axe Z avait dist=0
                // (2D) → elle s'effondrait sur l'auditeur.
                let distance = pos.norm();
                (
                    self.position_address(osc_id),
                    vec![azimuth, elevation, distance],
                )
            }
            OscProfile::Holophonix => {
                // Holophonix - Cartesian coordinates
                (self.position_address(osc_id), vec![pos.x, pos.y, pos.z])
            }
            OscProfile::IRCAMSpat => {
                // IRCAM Spat - Cartesian coordinates
                (self.position_address(osc_id), vec![pos.x, pos.y, pos.z])
            }
            OscProfile::GenericCartesian => {
                // Generic Cartesian
                (self.position_address(osc_id), vec![pos.x, pos.y, pos.z])
            }
            OscProfile::GenericPolar => {
                // Generic Polar — UN seul message à 3 valeurs (azimuth,
                // elevation, distance) sur l'adresse de base /object/{id}
                let azimuth = pos.x.atan2(pos.y).to_degrees();
                let horizontal = (pos.x.powi(2) + pos.y.powi(2)).sqrt();
                let elevation = pos.z.atan2(horizontal).to_degrees();
                let distance = pos.norm();
                (
                    self.position_address(osc_id),
                    vec![azimuth, elevation, distance],
                )
            }
            OscProfile::ADMOSC => {
                // ADM-OSC - Ambisonics panning with spherical coordinates
                let azimuth = pos.x.atan2(pos.y).to_degrees();
                let horizontal = (pos.x.powi(2) + pos.y.powi(2)).sqrt();
                let elevation = pos.z.atan2(horizontal).to_degrees();
                let distance = pos.norm();
                (
                    self.position_address(osc_id),
                    vec![azimuth, elevation, distance],
                )
            }
        }
    }

    /// Formate les canaux étendus d'un objet en messages OSC.
    ///
    /// Ne produit des messages que pour les canaux `Some` et supportés par le
    /// profil (matrice de capacités). Retourne un vec vide si rien à envoyer.
    pub fn format_channels(
        &self,
        object_id: u32,
        channels: &SpatialChannels,
    ) -> Vec<(String, Vec<f64>)> {
        let osc_id = object_id + self.object_offset;
        let mut messages = Vec::new();
        let pairs: [(SpatialChannel, Option<f64>); 7] = [
            (SpatialChannel::Gain, channels.gain),
            (SpatialChannel::Spread, channels.spread),
            (SpatialChannel::Distance, channels.distance),
            (SpatialChannel::Presence, channels.presence),
            (SpatialChannel::Yaw, channels.yaw),
            (SpatialChannel::Aperture, channels.aperture),
            (SpatialChannel::Lfe, channels.lfe),
        ];
        for (channel, value) in pairs {
            if let Some(v) = value {
                if let Some(addr) = self.channel_address_cached(osc_id, channel) {
                    messages.push((addr, vec![self.channel_convert(channel, v)]));
                }
            }
        }
        messages
    }

    /// État spatial complet d'un objet : position + canaux étendus.
    ///
    /// Retourne la liste de tous les messages OSC à envoyer pour cet objet
    /// cette frame (position en premier, puis canaux).
    pub fn format_state(
        &self,
        object_id: u32,
        position: Vector3<f64>,
        channels: Option<&SpatialChannels>,
    ) -> Vec<(String, Vec<f64>)> {
        let mut messages = vec![self.format_position(object_id, position)];
        if let Some(ch) = channels {
            messages.extend(self.format_channels(object_id, ch));
        }
        messages
    }

    /// Définit l'offset d'objet
    pub fn set_object_offset(&mut self, offset: u32) {
        self.object_offset = offset;
    }

    /// Définit la vitesse de playback
    pub fn set_speed(&mut self, speed: f64) {
        self.speed = speed;
    }

    /// Définit l'échelle
    pub fn set_scale(&mut self, scale: f64) {
        self.scale = scale;
    }

    /// Définit le décalage
    pub fn set_shift(&mut self, shift: Vector3<f64>) {
        self.shift = shift;
    }

    /// Définit la turbulence
    pub fn set_turbulence(&mut self, turbulence: f64) {
        self.turbulence = turbulence;
    }
}

impl Default for OscSender {
    fn default() -> Self {
        Self::new(OscProfile::GenericCartesian, "127.0.0.1".to_string(), 7000)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_osc_sender_new() {
        let sender = OscSender::new(OscProfile::Holophonix, "127.0.0.1".to_string(), 8000);
        assert_eq!(sender.port, 8000);
        assert_eq!(sender.object_offset, 0);
    }

    #[test]
    fn test_format_position_holophonix() {
        let sender = OscSender::new(OscProfile::Holophonix, "127.0.0.1".to_string(), 8000);
        let pos = Vector3::new(0.5, 0.3, 0.2);
        let (address, values) = sender.format_position(1, pos);
        assert_eq!(address, "/track/1/xyz");
        assert_eq!(values.len(), 3);
    }

    #[test]
    fn test_format_position_iem() {
        let sender = OscSender::new(OscProfile::IEMMultiEncoder, "127.0.0.1".to_string(), 9000);
        let pos = Vector3::new(0.5, 0.3, 0.2);
        let (address, values) = sender.format_position(1, pos);
        assert_eq!(address, "/MultiEncoder/1/aed");
        assert_eq!(values.len(), 3); // azimuth, elevation, distance
    }

    /// Convention polaire : azim 0 = front (+Y), azim > 0 vers +X, distance
    /// brute (unités scène). Vérifie que les 3 profils AED suivent la même
    /// convention que le preview 3D et les profils cartésiens.
    #[test]
    fn test_polar_profiles_azimuth_convention() {
        for profile in [
            OscProfile::IEMMultiEncoder,
            OscProfile::GenericPolar,
            OscProfile::ADMOSC,
        ] {
            let sender = OscSender::new(profile, "127.0.0.1".to_string(), 9000);
            // Front (+Y) → azimuth 0
            let (_, front) = sender.format_position(1, Vector3::new(0.0, 1.0, 0.0));
            assert!(
                front[0].abs() < 1e-9,
                "azim front devrait être 0: {}",
                front[0]
            );
            // +X → azimuth +90
            let (_, right) = sender.format_position(1, Vector3::new(1.0, 0.0, 0.0));
            assert!(
                (right[0] - 90.0).abs() < 1e-9,
                "azim +X devrait être 90: {}",
                right[0]
            );
            // Distance brute : dist 2.5 → 2.5 (pas de clamp à 1.0)
            let (_, far) = sender.format_position(1, Vector3::new(0.0, 2.5, 0.0));
            assert!(
                (far[2] - 2.5).abs() < 1e-9,
                "distance devrait être brute: {}",
                far[2]
            );
        }
    }

    #[test]
    fn test_set_object_offset() {
        let mut sender = OscSender::new(OscProfile::Holophonix, "127.0.0.1".to_string(), 8000);
        sender.set_object_offset(10);
        assert_eq!(sender.object_offset, 10);
        let pos = Vector3::new(0.5, 0.3, 0.2);
        let (address, _) = sender.format_position(1, pos);
        assert_eq!(address, "/track/11/xyz");
    }

    #[test]
    fn test_set_scale() {
        let mut sender = OscSender::new(OscProfile::Holophonix, "127.0.0.1".to_string(), 8000);
        sender.set_scale(2.0);
        assert_eq!(sender.scale, 2.0);
    }

    #[test]
    fn test_profile_default_port() {
        assert_eq!(OscProfile::IEMMultiEncoder.default_port(), 9000);
        assert_eq!(OscProfile::Holophonix.default_port(), 8000);
        assert_eq!(OscProfile::GenericCartesian.default_port(), 7000);
    }

    #[test]
    fn test_profile_from_str() {
        assert_eq!(
            OscProfile::from_str("holophonix").unwrap(),
            OscProfile::Holophonix
        );
        assert_eq!(
            OscProfile::from_str("IEM").unwrap(),
            OscProfile::IEMMultiEncoder
        );
        assert_eq!(
            OscProfile::from_str("ircam").unwrap(),
            OscProfile::IRCAMSpat
        );
        assert_eq!(OscProfile::from_str("adm").unwrap(), OscProfile::ADMOSC);
        assert!(OscProfile::from_str("invalid").is_err());
    }

    #[test]
    fn test_format_position_adm() {
        let sender = OscSender::new(OscProfile::ADMOSC, "127.0.0.1".to_string(), 8001);
        let pos = Vector3::new(0.5, 0.3, 0.2);
        let (address, values) = sender.format_position(1, pos);
        assert_eq!(address, "/adm/source/1/aed");
        assert_eq!(values.len(), 3); // azimuth, elevation, distance
    }

    // ── Canaux spatiaux étendus ─────────────────────────────────────────

    #[test]
    fn test_spatial_channels_set_clear() {
        let mut ch = SpatialChannels::default();
        assert!(ch.is_empty());
        ch.set(SpatialChannel::Gain, -6.0);
        ch.set(SpatialChannel::Spread, 0.5);
        assert!(!ch.is_empty());
        assert_eq!(ch.gain, Some(-6.0));
        ch.clear(SpatialChannel::Gain);
        assert_eq!(ch.gain, None);
        assert_eq!(ch.spread, Some(0.5));
    }

    #[test]
    fn test_spatial_channel_from_str() {
        assert_eq!(
            SpatialChannel::from_str("gain").unwrap(),
            SpatialChannel::Gain
        );
        assert_eq!(
            SpatialChannel::from_str("spread").unwrap(),
            SpatialChannel::Spread
        );
        assert_eq!(
            SpatialChannel::from_str("width").unwrap(),
            SpatialChannel::Spread
        );
        assert_eq!(
            SpatialChannel::from_str("lfe").unwrap(),
            SpatialChannel::Lfe
        );
        assert!(SpatialChannel::from_str("bogus").is_err());
    }

    #[test]
    fn test_format_channels_ircam() {
        let sender = OscSender::new(OscProfile::IRCAMSpat, "127.0.0.1".to_string(), 8000);
        let mut ch = SpatialChannels::default();
        ch.set(SpatialChannel::Spread, 0.5);
        ch.set(SpatialChannel::Presence, -3.0);
        ch.set(SpatialChannel::Yaw, 45.0);
        let msgs = sender.format_channels(1, &ch);
        assert_eq!(msgs.len(), 3);
        // Spread normalisé 0-1 → 0-100 pour IRCAM
        let spread = msgs.iter().find(|(a, _)| a == "/source/1/spread").unwrap();
        assert_eq!(spread.1, vec![50.0]);
        assert!(msgs.iter().any(|(a, _)| a == "/source/1/presence"));
        assert!(msgs.iter().any(|(a, _)| a == "/source/1/yaw"));
    }

    #[test]
    fn test_format_channels_capability_matrix() {
        // IEM : position only, aucun canal
        let iem = OscSender::new(OscProfile::IEMMultiEncoder, "127.0.0.1".to_string(), 9000);
        let mut ch = SpatialChannels::default();
        ch.set(SpatialChannel::Gain, -6.0);
        assert!(iem.format_channels(1, &ch).is_empty());

        // Holophonix : gain uniquement
        let holo = OscSender::new(OscProfile::Holophonix, "127.0.0.1".to_string(), 8000);
        let mut ch2 = SpatialChannels::default();
        ch2.set(SpatialChannel::Gain, -6.0);
        ch2.set(SpatialChannel::Spread, 0.5);
        let msgs = holo.format_channels(1, &ch2);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].0, "/track/1/gain");

        // ADM-OSC : gain + width + dist
        let adm = OscSender::new(OscProfile::ADMOSC, "127.0.0.1".to_string(), 8001);
        let mut ch3 = SpatialChannels::default();
        ch3.set(SpatialChannel::Gain, -6.0);
        ch3.set(SpatialChannel::Spread, 0.5);
        ch3.set(SpatialChannel::Presence, -3.0); // non supporté
        let msgs = adm.format_channels(1, &ch3);
        assert_eq!(msgs.len(), 2);
        assert!(msgs.iter().any(|(a, _)| a == "/adm/obj/1/gain"));
        assert!(msgs.iter().any(|(a, _)| a == "/adm/obj/1/width"));
    }

    #[test]
    fn test_format_state_position_plus_channels() {
        let sender = OscSender::new(OscProfile::IRCAMSpat, "127.0.0.1".to_string(), 8000);
        let pos = Vector3::new(0.5, 0.3, 0.2);
        let mut ch = SpatialChannels::default();
        ch.set(SpatialChannel::Gain, -6.0);

        let msgs = sender.format_state(1, pos, Some(&ch));
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].0, "/source/1/xyz");
        assert_eq!(msgs[1].0, "/source/1/gain");

        // Sans canaux : position seule
        let msgs_none = sender.format_state(1, pos, None);
        assert_eq!(msgs_none.len(), 1);
    }

    #[test]
    fn test_generic_polar_single_message() {
        // GenericPolar émet UN message à 3 valeurs (aed) sur l'adresse de base
        let sender = OscSender::new(OscProfile::GenericPolar, "127.0.0.1".to_string(), 7001);
        let (addr, values) = sender.format_position(2, Vector3::new(0.5, 0.0, 0.0));
        assert_eq!(addr, "/object/2");
        assert_eq!(values.len(), 3);
    }

    #[test]
    fn test_polar_distance_is_3d() {
        // P1.9 : la distance polaire est la norme 3D — une source sur l'axe
        // Z (0,0,2) → distance 2, pas 0 (le calcul 2D l'effondrait sur
        // l'auditeur). Verrouillé sur les 3 profils polaires.
        for profile in [
            OscProfile::GenericPolar,
            OscProfile::IEMMultiEncoder,
            OscProfile::ADMOSC,
        ] {
            let name = format!("{profile:?}");
            let sender = OscSender::new(profile, "127.0.0.1".to_string(), 7000);
            let (_, values) = sender.format_position(1, Vector3::new(0.0, 0.0, 2.0));
            let distance = values.last().copied().unwrap_or(-1.0);
            assert!(
                (distance - 2.0).abs() < 1e-9,
                "{name} : distance attendue 2.0, reçue {distance}"
            );
            // Elevation 90° pour une source pile au-dessus (ou -90 selon repère).
            let elevation = values[1];
            assert!(
                elevation.abs() > 89.9,
                "{name} : elevation attendue ≈±90°, reçue {elevation}"
            );
        }
    }

    #[test]
    fn test_turbulence_static_deterministic_per_object() {
        // La turbulence est un offset STATIQUE par objet (seed = object_id
        // uniquement, pas de temps) : deux appels identiques → même sortie,
        // deux objets différents → offsets différents.
        let mut sender = OscSender::new(OscProfile::Holophonix, "127.0.0.1".to_string(), 8000);
        sender.set_turbulence(0.1);
        let pos = Vector3::new(0.5, 0.3, 0.2);

        let a1 = sender.format_position(1, pos);
        let a2 = sender.format_position(1, pos);
        assert_eq!(a1.1, a2.1, "turbulence doit être figée dans le temps");

        let b = sender.format_position(2, pos);
        assert_ne!(a1.1, b.1, "offset différent par objet");

        // Turbulence 0 → aucune modification
        let mut clean = OscSender::new(OscProfile::Holophonix, "127.0.0.1".to_string(), 8000);
        clean.set_turbulence(0.0);
        let (_, v) = clean.format_position(1, pos);
        assert_eq!(v, vec![0.5, 0.3, 0.2]);
    }

    #[test]
    fn test_position_address_cached_and_consistent() {
        // Le cache d'adresses ne change pas les résultats, et les clés
        // incluent profil + object_offset (invalidation implicite).
        let mut sender = OscSender::new(OscProfile::Holophonix, "127.0.0.1".to_string(), 8000);
        let pos = Vector3::new(0.5, 0.3, 0.2);
        for _ in 0..3 {
            assert_eq!(sender.format_position(1, pos).0, "/track/1/xyz");
        }
        sender.set_object_offset(10);
        assert_eq!(sender.format_position(1, pos).0, "/track/11/xyz");
        sender.profile = OscProfile::IRCAMSpat;
        assert_eq!(sender.format_position(1, pos).0, "/source/11/xyz");
        // Les canaux passent par le même cache
        let mut ch = SpatialChannels::default();
        ch.set(SpatialChannel::Spread, 0.5); // → 50.0 pour IRCAM
        let msgs = sender.format_channels(1, &ch);
        assert!(msgs
            .iter()
            .any(|(a, v)| a == "/source/11/spread" && v == &vec![50.0]));
    }
}
