//! Réception PSN/RTTrP (PosiStageNet) — tracking industrie.
//!
//! Écoute multicast (défaut 236.0.0.1:56565), parse les paquets RTTrPL,
//! extrait les positions par tracker_id et les injecte en positions
//! manuelles (`set_manual_position`) — le flux suivi est lissé par la
//! couche cinématique du merge. Utilisé par BlackTrax, Zactrack,
//! Follow-Me, StagePrecision.
//!
//! Format RTTrP (little-endian) :
//!   header  : sig u16 (0x6756=RTTrPL) · version u16 · packet_id u8 ·
//!             packet_format u8 · size u16 · context u32
//!   data    : séquence de chunks { id u16, size u16, data[size] }
//!   tracker : chunk dont l'id est le tracker_id ; contient des
//!             sous-chunks { 0x0000 pos(3×f32) · 0x0001 speed ·
//!             0x0002 ori · 0x0003 accel · 0x0004 trgtpos ·
//!             0x0005 status · 0x0006 timestamp u64 }

use std::collections::HashMap;
use std::net::{Ipv4Addr, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::JoinHandle;
use std::time::Instant;

/// Signature RTTrP (description) / RTTrPL (données live).
const SIG_RTTRP: u16 = 0x6755;
const SIG_RTTRPL: u16 = 0x6756;

const CHUNK_POS: u16 = 0x0000;

/// Parse un datagramme RTTrP → positions (tracker_id → [x, y, z]).
/// Retourne une liste vide pour les paquets non-RTTrPL ou malformés.
pub fn parse_psn_packet(data: &[u8]) -> Vec<(u32, [f64; 3])> {
    let mut out = Vec::new();
    if data.len() < 12 {
        return out;
    }
    let sig = u16::from_le_bytes([data[0], data[1]]);
    if sig != SIG_RTTRP && sig != SIG_RTTRPL {
        return out;
    }
    // Le payload commence après le header (12 octets).
    let mut pos = 12usize;
    // Les chunks de niveau 1 sont les trackers (id = tracker_id).
    while pos + 4 <= data.len() {
        let chunk_id = u16::from_le_bytes([data[pos], data[pos + 1]]);
        let chunk_size = u16::from_le_bytes([data[pos + 2], data[pos + 3]]) as usize;
        pos += 4;
        if pos + chunk_size > data.len() {
            break;
        }
        let chunk_data = &data[pos..pos + chunk_size];
        // Sous-chunks du tracker — cherche la position (0x0000).
        let mut sub = 0usize;
        while sub + 4 <= chunk_data.len() {
            let sub_id = u16::from_le_bytes([chunk_data[sub], chunk_data[sub + 1]]);
            let sub_size =
                u16::from_le_bytes([chunk_data[sub + 2], chunk_data[sub + 3]]) as usize;
            sub += 4;
            if sub + sub_size > chunk_data.len() {
                break;
            }
            let payload = &chunk_data[sub..sub + sub_size];
            if sub_id == CHUNK_POS && payload.len() >= 12 {
                let x = f32::from_le_bytes([payload[0], payload[1], payload[2], payload[3]]);
                let y = f32::from_le_bytes([payload[4], payload[5], payload[6], payload[7]]);
                let z =
                    f32::from_le_bytes([payload[8], payload[9], payload[10], payload[11]]);
                if x.is_finite() && y.is_finite() && z.is_finite() {
                    out.push((chunk_id as u32, [x as f64, y as f64, z as f64]));
                }
            }
            sub += sub_size;
        }
        pos += chunk_size;
    }
    out
}

/// Récepteur PSN — thread d'écoute multicast + injection en positions
/// manuelles via un callback. Health exposé (`last_packet_age_ms`) pour
/// le bandeau de santé des flux.
pub struct PsnReceiver {
    running: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
    /// Timestamp (millis depuis epoch Instant approximé) du dernier
    /// paquet reçu — santé du flux.
    last_packet_ms: Arc<AtomicU64>,
    epoch: Instant,
    /// Map tracker_id → object_index.
    tracker_map: Arc<RwLock<HashMap<u32, usize>>>,
}

impl PsnReceiver {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            thread: Mutex::new(None),
            last_packet_ms: Arc::new(AtomicU64::new(0)),
            epoch: Instant::now(),
            tracker_map: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Démarre l'écoute multicast sur `group:port`. `on_position` reçoit
    /// (object_index, [x,y,z]) après mapping tracker→objet.
    pub fn start(
        &self,
        group: &str,
        port: u16,
        on_position: impl Fn(usize, [f64; 3]) + Send + 'static,
    ) -> Result<(), String> {
        if self.running.load(Ordering::SeqCst) {
            self.stop();
        }
        let socket = UdpSocket::bind(format!("0.0.0.0:{port}"))
            .map_err(|e| format!("PSN bind failed: {e}"))?;
        let group_addr: Ipv4Addr = group
            .parse()
            .map_err(|e| format!("PSN group invalid: {e}"))?;
        socket
            .join_multicast_v4(&group_addr, &Ipv4Addr::UNSPECIFIED)
            .map_err(|e| format!("PSN join multicast failed: {e}"))?;
        socket
            .set_read_timeout(Some(std::time::Duration::from_millis(500)))
            .map_err(|e| format!("PSN timeout: {e}"))?;

        self.running.store(true, Ordering::SeqCst);
        let running = self.running.clone();
        let last_packet_ms = self.last_packet_ms.clone();
        let epoch = self.epoch;
        let tracker_map = self.tracker_map.clone();
        let handle = std::thread::spawn(move || {
            let mut buf = [0u8; 65535];
            while running.load(Ordering::SeqCst) {
                match socket.recv_from(&mut buf) {
                    Ok((n, _src)) => {
                        last_packet_ms.store(
                            epoch.elapsed().as_millis() as u64,
                            Ordering::SeqCst,
                        );
                        let map = tracker_map
                            .read()
                            .unwrap_or_else(|e| e.into_inner())
                            .clone();
                        for (tracker_id, pos) in parse_psn_packet(&buf[..n]) {
                            if let Some(&obj) = map.get(&tracker_id) {
                                on_position(obj, pos);
                            }
                        }
                    }
                    Err(ref e)
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            || e.kind() == std::io::ErrorKind::TimedOut =>
                    {
                        continue;
                    }
                    Err(_) => break,
                }
            }
        });
        *self.thread.lock().unwrap_or_else(|e| e.into_inner()) = Some(handle);
        Ok(())
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(h) = self
            .thread
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            let _ = h.join();
        }
    }

    /// Configure le mapping tracker_id → object_index.
    pub fn set_tracker_map(&self, map: HashMap<u32, usize>) {
        *self
            .tracker_map
            .write()
            .unwrap_or_else(|e| e.into_inner()) = map;
    }

    /// Âge en ms du dernier paquet reçu (None = jamais reçu).
    pub fn last_packet_age_ms(&self) -> Option<u64> {
        let last = self.last_packet_ms.load(Ordering::SeqCst);
        if last == 0 {
            return None;
        }
        Some(self.epoch.elapsed().as_millis() as u64 - last)
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
}

impl Drop for PsnReceiver {
    fn drop(&mut self) {
        self.stop();
    }
}
