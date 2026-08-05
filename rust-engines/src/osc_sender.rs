use nalgebra::Vector3;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

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
}
