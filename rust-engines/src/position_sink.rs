//! Seam de sortie — abstraction du transport de positions.
//!
//! Le `MergeRuntime` ne connaît que le trait `PositionSink` : l'impl par
//! défaut est `OscSink` (rosc + UDP). D'autres renderers (MSC/MTC/PSN,
//! WebSocket, bridge propriétaire) peuvent être injectés via
//! `MergeRuntime::set_sink` sans toucher la boucle merge.
//!
//! Contrat : `send_state` est appelé par objet à chaque frame du merge
//! thread (~60Hz × N objets) — il doit être non-bloquant et ne jamais
//! paniquer ; les erreurs remontent via `SendReport` (le merge les
//! accumule dans le PerfMonitor).

use crate::osc_sender::{OscSender, SpatialChannels};
use rosc::{OscMessage, OscPacket, OscType};
use std::net::UdpSocket;

/// Résultat d'envoi pour UN objet sur une frame — accumulé dans les
/// compteurs de perf du merge.
#[derive(Default, Debug, Clone, Copy)]
pub struct SendReport {
    /// Messages effectivement partis sur le transport.
    pub sent: u32,
    /// Erreurs d'encodage ou d'envoi (hors refused).
    pub errors: u32,
    /// ECONNREFUSED (ICMP port-unreachable) — personne n'écoute :
    /// ce n'est pas du packet loss, c'est un renderer down.
    pub refused: u32,
}

/// Sortie des positions mergées. `Send` requis : le merge thread détient
/// le sink pendant la frame entière (Mutex côté MergeRuntime).
pub trait PositionSink: Send {
    /// Envoie l'état spatial complet d'un objet (position + canaux
    /// effectifs déjà calculés : statiques + modulations + zones).
    fn send_state(
        &mut self,
        object_id: u32,
        position: nalgebra::Vector3<f64>,
        channels: Option<&SpatialChannels>,
    ) -> SendReport;

    /// Description lisible de la destination (logs, UI, tests).
    fn describe(&self) -> String;
}

/// Impl OSC/UDP — encapsule l'OscSender (formatage par profil) et la
/// socket connectée. Équivalent fonctionnel de l'ancien `OscTarget`.
pub struct OscSink {
    pub sender: OscSender,
    pub socket: UdpSocket,
}

impl OscSink {
    /// Bind `0.0.0.0:0` + connect vers `host:port`.
    pub fn connect(host: &str, port: u16, sender: OscSender) -> std::io::Result<Self> {
        let socket = UdpSocket::bind("0.0.0.0:0")?;
        socket.connect((host, port))?;
        Ok(Self { sender, socket })
    }
}

impl PositionSink for OscSink {
    fn send_state(
        &mut self,
        object_id: u32,
        position: nalgebra::Vector3<f64>,
        channels: Option<&SpatialChannels>,
    ) -> SendReport {
        let mut report = SendReport::default();
        for (addr, values) in self.sender.format_state(object_id, position, channels) {
            let args: Vec<OscType> = values.iter().map(|v| OscType::Float(*v as f32)).collect();
            let packet = OscPacket::Message(OscMessage { addr, args });
            match rosc::encoder::encode(&packet) {
                Ok(bytes) => match self.socket.send(&bytes) {
                    Ok(_) => report.sent += 1,
                    Err(e) => {
                        report.errors += 1;
                        if e.kind() == std::io::ErrorKind::ConnectionRefused {
                            report.refused += 1;
                        }
                    }
                },
                Err(_) => report.errors += 1,
            }
        }
        report
    }

    fn describe(&self) -> String {
        format!("osc://{}:{}", self.sender.host, self.sender.port)
    }
}
