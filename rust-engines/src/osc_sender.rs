use nalgebra::Vector3;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// Canaux spatiaux étendus — au-delà de la position (modèle ToscA).
/// Chaque canal Option<f64> : None = non envoyé (pas de trafic OSC inutile).
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
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
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
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
    /// Retourne `Some((adresse, valeur_convertie))` si le profil supporte le
    /// canal, `None` sinon. Matrice conservatrice : seuls les canaux confirmés
    /// sont mappés (extensible sans casser l'API).
    ///
    /// - `spread` est stocké normalisé 0-1, converti en 0-100 pour IRCAM Spat.
    /// - `gain`, `presence`, `lfe` sont en dB pour les profils qui les supportent.
    fn channel_message(
        &self,
        osc_id: u32,
        channel: SpatialChannel,
        value: f64,
    ) -> Option<(String, f64)> {
        match self {
            OscProfile::IRCAMSpat => match channel {
                SpatialChannel::Gain => Some((format!("/source/{osc_id}/gain"), value)),
                SpatialChannel::Spread => Some((format!("/source/{osc_id}/spread"), value * 100.0)),
                SpatialChannel::Distance => Some((format!("/source/{osc_id}/distance"), value)),
                SpatialChannel::Presence => Some((format!("/source/{osc_id}/presence"), value)),
                SpatialChannel::Yaw => Some((format!("/source/{osc_id}/yaw"), value)),
                SpatialChannel::Aperture => Some((format!("/source/{osc_id}/aperture"), value)),
                SpatialChannel::Lfe => Some((format!("/source/{osc_id}/lfe"), value)),
            },
            OscProfile::Holophonix => match channel {
                SpatialChannel::Gain => Some((format!("/track/{osc_id}/gain"), value)),
                _ => None,
            },
            OscProfile::ADMOSC => match channel {
                SpatialChannel::Gain => Some((format!("/adm/obj/{osc_id}/gain"), value)),
                SpatialChannel::Spread => Some((format!("/adm/obj/{osc_id}/width"), value)),
                SpatialChannel::Distance => Some((format!("/adm/obj/{osc_id}/dist"), value)),
                _ => None,
            },
            OscProfile::GenericCartesian | OscProfile::GenericPolar => match channel {
                SpatialChannel::Gain => Some((format!("/object/{osc_id}/gain"), value)),
                SpatialChannel::Spread => Some((format!("/object/{osc_id}/spread"), value)),
                SpatialChannel::Distance => Some((format!("/object/{osc_id}/distance"), value)),
                SpatialChannel::Yaw => Some((format!("/object/{osc_id}/yaw"), value)),
                _ => None,
            },
            OscProfile::IEMMultiEncoder => None,
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

    /// Convertit une position cartésienne en format selon le profil
    pub fn format_position(&self, object_id: u32, position: Vector3<f64>) -> (String, Vec<f64>) {
        let osc_id = object_id + self.object_offset;

        // Appliquer les macros (speed est appliquée par le runtime sur t, pas ici)
        let mut pos = position;
        pos.x = pos.x * self.scale + self.shift.x;
        pos.y = pos.y * self.scale + self.shift.y;
        pos.z = pos.z * self.scale + self.shift.z;

        // Appliquer turbulence — bruit déterministe basé sur le temps et l'objet
        if self.turbulence > 0.0 {
            use crate::rng::SimpleRng;
            // Seed déterministe: combine object_id et un hash du temps
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
                // IEM MultiEncoder (Ambisonics) - Polar coordinates
                let azimuth = pos.y.atan2(pos.x).to_degrees();
                let distance = (pos.x.powi(2) + pos.y.powi(2)).sqrt();
                let elevation = if distance > 0.0 {
                    pos.z.atan2(distance).to_degrees()
                } else {
                    0.0
                };
                let distance_norm = distance.min(1.0);

                (
                    format!("/MultiEncoder/{osc_id}/aed"),
                    vec![azimuth, elevation, distance_norm],
                )
            }
            OscProfile::Holophonix => {
                // Holophonix - Cartesian coordinates
                (format!("/track/{osc_id}/xyz"), vec![pos.x, pos.y, pos.z])
            }
            OscProfile::IRCAMSpat => {
                // IRCAM Spat - Cartesian coordinates
                (format!("/source/{osc_id}/xyz"), vec![pos.x, pos.y, pos.z])
            }
            OscProfile::GenericCartesian => {
                // Generic Cartesian
                (format!("/object/{osc_id}/xyz"), vec![pos.x, pos.y, pos.z])
            }
            OscProfile::GenericPolar => {
                // Generic Polar - envoi en 3 messages séparés
                let azimuth = pos.y.atan2(pos.x).to_degrees();
                let distance = (pos.x.powi(2) + pos.y.powi(2)).sqrt();
                let elevation = if distance > 0.0 {
                    pos.z.atan2(distance).to_degrees()
                } else {
                    0.0
                };
                let distance_norm = distance.min(1.0);

                // Pour GenericPolar, on retourne l'adresse base + les 3 valeurs
                (
                    format!("/object/{osc_id}"),
                    vec![azimuth, elevation, distance_norm],
                )
            }
            OscProfile::ADMOSC => {
                // ADM-OSC - Ambisonics panning with spherical coordinates
                let azimuth = pos.y.atan2(pos.x).to_degrees();
                let distance = (pos.x.powi(2) + pos.y.powi(2)).sqrt();
                let elevation = if distance > 0.0 {
                    pos.z.atan2(distance).to_degrees()
                } else {
                    0.0
                };
                let distance_norm = distance.min(1.0);

                (
                    format!("/adm/source/{osc_id}/aed"),
                    vec![azimuth, elevation, distance_norm],
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
                if let Some((addr, converted)) = self.profile.channel_message(osc_id, channel, v) {
                    messages.push((addr, vec![converted]));
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
}
