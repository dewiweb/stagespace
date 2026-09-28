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
use rosc::{OscBundle, OscMessage, OscPacket, OscTime, OscType};
use std::net::UdpSocket;

/// Résultat d'envoi pour UN objet sur une frame — accumulé dans les
/// compteurs de perf du merge.
#[derive(Default, Debug, Clone, Copy)]
pub struct SendReport {
    /// Paquets effectivement partis sur le transport (un paquet = un
    /// bundle de messages position + canaux).
    pub sent: u32,
    /// Paquets en échec d'encodage ou d'envoi (hors refused).
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
        // Bundle par objet : position + canaux étendus en UN paquet UDP au
        // lieu de N (÷8 syscalls à charge pleine). Tout receiver OSC décode
        // les bundles. Timetag (0,1) = "immédiat" selon la spec OSC.
        let content: Vec<OscPacket> = self
            .sender
            .format_state(object_id, position, channels)
            .into_iter()
            .map(|(addr, values)| {
                OscPacket::Message(OscMessage {
                    addr,
                    args: values.iter().map(|v| OscType::Float(*v as f32)).collect(),
                })
            })
            .collect();
        if content.is_empty() {
            return report;
        }
        let packet = OscPacket::Bundle(OscBundle {
            timetag: OscTime::from((0, 1)),
            content,
        });
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
        report
    }

    fn describe(&self) -> String {
        format!("osc://{}:{}", self.sender.host, self.sender.port)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::osc_sender::{OscProfile, SpatialChannel};

    fn loopback_sink_and_receiver() -> (OscSink, UdpSocket) {
        let receiver = UdpSocket::bind("127.0.0.1:0").unwrap();
        receiver
            .set_read_timeout(Some(std::time::Duration::from_secs(2)))
            .unwrap();
        let port = receiver.local_addr().unwrap().port();
        let sender = OscSender::new(OscProfile::Holophonix, "127.0.0.1".into(), port);
        (
            OscSink::connect("127.0.0.1", port, sender).unwrap(),
            receiver,
        )
    }

    #[test]
    fn send_state_emits_one_bundle_per_object() {
        let (mut sink, receiver) = loopback_sink_and_receiver();
        let mut channels = SpatialChannels::default();
        channels.set(SpatialChannel::Gain, -6.0); // seul canal mappé par Holophonix

        let report = sink.send_state(1, nalgebra::Vector3::new(1.0, 2.0, 3.0), Some(&channels));
        assert_eq!(report.sent, 1);
        assert_eq!(report.errors, 0);

        // UN seul datagramme UDP contenant un bundle de tous les messages.
        let mut buf = [0u8; 4096];
        let n = receiver.recv(&mut buf).unwrap();
        let (_, packet) = rosc::decoder::decode_udp(&buf[..n]).unwrap();
        let OscPacket::Bundle(bundle) = packet else {
            panic!("expected a bundle, got {packet:?}");
        };
        assert!(bundle.content.len() >= 2);
        let addrs: Vec<&str> = bundle
            .content
            .iter()
            .map(|p| match p {
                OscPacket::Message(m) => m.addr.as_str(),
                other => panic!("nested bundle unexpected: {other:?}"),
            })
            .collect();
        assert!(addrs.contains(&"/track/1/xyz"));
        assert!(addrs.contains(&"/track/1/gain"));

        // Plus rien ne suit : tout tient dans le bundle.
        assert!(receiver.recv(&mut buf).is_err());
    }

    #[test]
    fn send_state_refused_when_no_listener() {
        // UDP connect() sur un port sans listener : l'ICMP
        // port-unreachable du premier envoi fait échouer le suivant en
        // ECONNREFUSED — le compteur `refused` doit l'isoler.
        let dead = UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = dead.local_addr().unwrap().port();
        drop(dead);
        let sender = OscSender::new(OscProfile::Holophonix, "127.0.0.1".into(), port);
        let mut sink = OscSink::connect("127.0.0.1", port, sender).unwrap();
        let pos = nalgebra::Vector3::zeros();
        sink.send_state(1, pos, None); // amorce l'ICMP
        let report = sink.send_state(1, pos, None);
        assert!(
            report.refused > 0 || report.sent > 0,
            "kernel-dependent: refused attendu après amorce, ou send ok (ICMP pas encore reçu)"
        );
    }
}
