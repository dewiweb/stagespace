use rosc::{decoder::decode_udp, OscPacket, OscType};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

/// Mapping OSC → handler
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OscMapping {
    pub address: String,
    pub handler: String,
    pub transform: Option<String>,
}

/// OSC Receiver - réception OSC avec mapping configurable
///
/// `start()` ouvre un socket UDP sur `0.0.0.0:port` et lance un thread de lecture.
/// `stop()` l'arrête proprement. `last_values` expose la dernière valeur reçue
/// par handler, consultable par l'application hôte.
#[derive(Debug)]
pub struct OscReceiver {
    pub port: u16,
    pub mappings: HashMap<String, OscMapping>,
    pub is_running: bool,
    pub last_values: Arc<Mutex<HashMap<String, Vec<f64>>>>,
    shutdown: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl OscReceiver {
    pub fn new(port: u16) -> Self {
        OscReceiver {
            port,
            mappings: HashMap::new(),
            is_running: false,
            last_values: Arc::new(Mutex::new(HashMap::new())),
            shutdown: Arc::new(AtomicBool::new(false)),
            handle: None,
        }
    }

    /// Ajoute un mapping OSC → handler
    pub fn add_mapping(&mut self, address: String, handler: String, transform: Option<String>) {
        let mapping = OscMapping {
            address: address.clone(),
            handler,
            transform,
        };
        self.mappings.insert(address, mapping);
    }

    /// Supprime un mapping
    pub fn remove_mapping(&mut self, address: &str) {
        self.mappings.remove(address);
    }

    /// Retourne le handler pour une adresse OSC
    pub fn get_handler(&self, address: &str) -> Option<&OscMapping> {
        self.mappings.get(address)
    }

    /// Liste tous les mappings
    pub fn list_mappings(&self) -> Vec<OscMapping> {
        self.mappings.values().cloned().collect()
    }

    /// Clear tous les mappings
    pub fn clear_mappings(&mut self) {
        self.mappings.clear();
    }

    /// Démarre le serveur OSC
    pub fn start(&mut self) -> Result<(), String> {
        if self.is_running {
            return Err("OSC receiver is already running".to_string());
        }

        let socket = UdpSocket::bind(("0.0.0.0", self.port))
            .map_err(|e| format!("Failed to bind UDP socket on port {}: {}", self.port, e))?;

        socket
            .set_read_timeout(Some(Duration::from_millis(100)))
            .map_err(|e| format!("Failed to set socket timeout: {}", e))?;

        let port = self.port;
        let mappings = self.mappings.clone();
        let shutdown = self.shutdown.clone();
        let last_values = self.last_values.clone();
        let handle = thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while !shutdown.load(Ordering::SeqCst) {
                match socket.recv_from(&mut buf) {
                    Ok((len, _)) => {
                        if let Ok((_, packet)) = decode_udp(&buf[..len]) {
                            // Inline packet handling to avoid recursion issues
                            match packet {
                                OscPacket::Message(msg) => {
                                    if let Some(mapping) = mappings.get(&msg.addr) {
                                        let values: Vec<f64> = msg
                                            .args
                                            .iter()
                                            .filter_map(|arg| match arg {
                                                OscType::Float(v) => Some(*v as f64),
                                                OscType::Double(v) => Some(*v),
                                                OscType::Int(v) => Some(*v as f64),
                                                OscType::Long(v) => Some(*v as f64),
                                                _ => None,
                                            })
                                            .collect();

                                        if let Ok(mut lv) = last_values.lock() {
                                            lv.insert(mapping.handler.clone(), values.clone());
                                        }

                                        eprintln!(
                                            "OSC IN: {} -> handler '{}' (values: {:?})",
                                            mapping.address, mapping.handler, values
                                        );
                                    }
                                }
                                OscPacket::Bundle(bundle) => {
                                    for packet in bundle.content {
                                        if let OscPacket::Message(msg) = packet {
                                            if let Some(mapping) = mappings.get(&msg.addr) {
                                                let values: Vec<f64> = msg
                                                    .args
                                                    .iter()
                                                    .filter_map(|arg| match arg {
                                                        OscType::Float(v) => Some(*v as f64),
                                                        OscType::Double(v) => Some(*v),
                                                        OscType::Int(v) => Some(*v as f64),
                                                        OscType::Long(v) => Some(*v as f64),
                                                        _ => None,
                                                    })
                                                    .collect();

                                                if let Ok(mut lv) = last_values.lock() {
                                                    lv.insert(mapping.handler.clone(), values.clone());
                                                }

                                                eprintln!(
                                                    "OSC IN: {} -> handler '{}' (values: {:?})",
                                                    mapping.address, mapping.handler, values
                                                );
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                    {
                        // Timeout de 100ms atteint, on relit le drapeau d'arrêt
                        continue;
                    }
                    Err(_) => break,
                }
            }
            // Fermeture implicite du socket quand la closure est relâchée
            drop(socket);
            eprintln!("OSC receiver thread stopped on port {}", port);
        });

        self.handle = Some(handle);
        self.is_running = true;
        Ok(())
    }

    /// Arrête le serveur OSC
    pub fn stop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            // Le socket a un timeout de 100ms, donc le thread s'arrête rapidement
            let _ = handle.join();
        }
        self.is_running = false;
    }

    /// Retourne la dernière valeur reçue pour un handler
    pub fn get_last_value(&self, handler: &str) -> Option<Vec<f64>> {
        self.last_values.lock().ok()?.get(handler).cloned()
    }

    /// Retourne toutes les dernières valeurs
    pub fn get_all_values(&self) -> HashMap<String, Vec<f64>> {
        self.last_values.lock().map(|lv| lv.clone()).unwrap_or_default()
    }
}

impl Default for OscReceiver {
    fn default() -> Self {
        Self::new(8001)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_osc_receiver_new() {
        let receiver = OscReceiver::new(8001);
        assert_eq!(receiver.port, 8001);
        assert!(!receiver.is_running);
    }

    #[test]
    fn test_add_mapping() {
        let mut receiver = OscReceiver::new(8001);
        receiver.add_mapping(
            "/midi/clock".to_string(),
            "bpm_clock".to_string(),
            None,
        );
        assert_eq!(receiver.mappings.len(), 1);
    }

    #[test]
    fn test_remove_mapping() {
        let mut receiver = OscReceiver::new(8001);
        receiver.add_mapping(
            "/midi/clock".to_string(),
            "bpm_clock".to_string(),
            None,
        );
        receiver.remove_mapping("/midi/clock");
        assert_eq!(receiver.mappings.len(), 0);
    }

    #[test]
    fn test_get_handler() {
        let mut receiver = OscReceiver::new(8001);
        receiver.add_mapping(
            "/midi/clock".to_string(),
            "bpm_clock".to_string(),
            None,
        );
        let handler = receiver.get_handler("/midi/clock");
        assert!(handler.is_some());
        assert_eq!(handler.unwrap().handler, "bpm_clock");
    }

    #[test]
    fn test_list_mappings() {
        let mut receiver = OscReceiver::new(8001);
        receiver.add_mapping(
            "/midi/clock".to_string(),
            "bpm_clock".to_string(),
            None,
        );
        receiver.add_mapping(
            "/stagespace/bpm".to_string(),
            "bpm_set".to_string(),
            None,
        );
        let mappings = receiver.list_mappings();
        assert_eq!(mappings.len(), 2);
    }

    #[test]
    fn test_clear_mappings() {
        let mut receiver = OscReceiver::new(8001);
        receiver.add_mapping(
            "/midi/clock".to_string(),
            "bpm_clock".to_string(),
            None,
        );
        receiver.clear_mappings();
        assert_eq!(receiver.mappings.len(), 0);
    }

    #[test]
    fn test_get_last_value() {
        let receiver = OscReceiver::new(8001);
        assert!(receiver.get_last_value("test").is_none());
    }

    #[test]
    fn test_get_all_values() {
        let receiver = OscReceiver::new(8001);
        let values = receiver.get_all_values();
        assert_eq!(values.len(), 0);
    }
}
