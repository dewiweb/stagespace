//! OSC IN mapping — réception OSC avec routing configurable style libmapper.
//!
//! Un [`OscMapping`] associe une adresse entrante (avec wildcards `*` par segment)
//! à une [`MappingDestination`] : handler passif, macro spatiale, canal spatial
//! d'un objet, ou position manuelle. Chaque mapping applique une [`Transform`]
//! (deadzone → scale/offset → clamp → lissage) avant le routage.
//!
//! Le routing écrit directement dans les Arcs partagés du MergeRuntime
//! ([`OscInTargets`]) — aucun lock n'est ajouté au chemin temps réel du merge.

use rosc::{decoder::decode_udp, encoder::encode, OscMessage, OscPacket, OscType};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::UdpSocket;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use ts_rs::TS;

use crate::engines::MAX_OBJECTS;
use crate::osc_sender::{SpatialChannel, SpatialChannels};
use crate::runtime::MacroState;

mod pipeline;
mod show_control;
#[cfg(test)]
mod show_control_tests;
#[cfg(test)]
mod tests;
mod types;

pub use pipeline::encode_position_feedback;
use pipeline::*;
pub(crate) use show_control::parse_show_command;
pub use show_control::ShowCommand;
pub(crate) use show_control::ShowSink;
pub(crate) use show_control::MAX_CONTROLLERS;
pub use types::*;
pub(crate) use types::{MAX_BUNDLE_DEPTH, MAX_FEEDBACK_KEYS};

// ─── Receiver ───────────────────────────────────────────────────────────────

/// État partagé entre l'API du receiver et son thread socket.
#[derive(Clone)]
struct Shared {
    mappings: Arc<RwLock<HashMap<String, OscMapping>>>,
    last_values: Arc<Mutex<HashMap<String, Vec<f64>>>>,
    /// Dernière valeur reçue par adresse OSC brute — lu par les nodes
    /// `OSCInput` du graphe (indépendant des mappings : une adresse peut
    /// alimenter le graphe sans être routée vers une destination).
    last_by_address: Arc<Mutex<HashMap<String, Vec<f64>>>>,
    /// Dernier message OSC reçu hors `/stagespace/` (addr, args, instant) —
    /// capture pour le "learn" : brancher un fader en bougeant une fois.
    last_rx: Arc<Mutex<Option<LastRx>>>,
    smooth_state: Arc<Mutex<HashMap<String, Vec<f64>>>>,
    targets: Arc<RwLock<OscInTargets>>,
    in_enabled: Arc<AtomicBool>,
    suppress_until: Arc<Mutex<Option<Instant>>>,
    stats: Arc<OscInStats>,
    /// Index d'objet max accepté par le routing (borne anti-fuite mémoire sur
    /// les mappings wildcard : /track/*/gain avec un id arbitraire remplirait
    /// object_channels/manual_positions indéfiniment — et ces maps sont
    /// clonées à chaque frame de merge).
    max_objects: Arc<AtomicU64>,
    /// true tant que le thread socket tourne — passé à false par le thread
    /// lui-même à sa sortie (shutdown OU erreur fatale recv). Contrairement
    /// au champ `is_running`, ce flag reflète la mort spontanée du thread.
    thread_running: Arc<AtomicBool>,
    /// Sink show-control : la couche Tauri y branche un callback qui
    /// émet `show-control` vers le frontend (le backend ne fait que
    /// router — les actions vivent côté UI, comme les raccourcis).
    show_sink: Arc<Mutex<Option<ShowSink>>>,
    /// Dernier `/stagespace/*` reçu — voyant "console connectée" côté UI.
    last_show_rx: Arc<Mutex<Option<Instant>>>,
    /// 4 dernières adresses ayant envoyé une commande `/stagespace/` —
    /// reçoivent ack + feedback de cue.
    controllers: Arc<Mutex<Vec<std::net::SocketAddr>>>,
    /// Media sync out — cible dédiée (lumière/vidéo desk : ne peut pas
    /// être un "controller" puisqu'il n'envoie jamais rien) + préfixe
    /// d'adresse. `send_show_feedback` émet `{prefix}/cue <num>` dessus.
    media_sync: Arc<Mutex<Option<(std::net::SocketAddr, String)>>>,

    /// Socket de réponse (try_clone du socket de réception) — posé au
    /// démarrage du thread pour envoyer ack/feedback aux contrôleurs.
    reply_socket: Arc<Mutex<Option<Arc<UdpSocket>>>>,
    /// FPS pour la conversion `HH:MM:SS:FF` → secondes (24/25/30,
    /// non-drop ; défaut 25). Configurable depuis le slice OSC.
    timecode_fps: Arc<AtomicU64>,
}

pub struct OscReceiver {
    pub port: u16,
    pub is_running: bool,
    shared: Shared,
    shutdown: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl OscReceiver {
    pub fn new(port: u16) -> Self {
        OscReceiver {
            port,
            is_running: false,
            shared: Shared {
                mappings: Arc::new(RwLock::new(HashMap::new())),
                last_values: Arc::new(Mutex::new(HashMap::new())),
                last_by_address: Arc::new(Mutex::new(HashMap::new())),
                last_rx: Arc::new(Mutex::new(None)),
                smooth_state: Arc::new(Mutex::new(HashMap::new())),
                targets: Arc::new(RwLock::new(OscInTargets::default())),
                in_enabled: Arc::new(AtomicBool::new(true)),
                suppress_until: Arc::new(Mutex::new(None)),
                stats: Arc::new(OscInStats::default()),
                max_objects: Arc::new(AtomicU64::new(MAX_OBJECTS as u64)),
                thread_running: Arc::new(AtomicBool::new(false)),
                show_sink: Arc::new(Mutex::new(None)),
                last_show_rx: Arc::new(Mutex::new(None)),
                controllers: Arc::new(Mutex::new(Vec::new())),
                reply_socket: Arc::new(Mutex::new(None)),
                media_sync: Arc::new(Mutex::new(None)),
                timecode_fps: Arc::new(AtomicU64::new(25.0f64.to_bits())),
            },
            shutdown: Arc::new(AtomicBool::new(false)),
            handle: None,
        }
    }

    /// Connecte les destinations aux Arcs du MergeRuntime
    /// (macros, object_channels, manual_positions)
    pub fn set_targets(&self, targets: OscInTargets) {
        *self
            .shared
            .targets
            .write()
            .unwrap_or_else(|e| e.into_inner()) = targets;
    }

    /// Récupère les targets actuels (pour migration de port)
    pub fn targets(&self) -> OscInTargets {
        self.shared
            .targets
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Ajoute un mapping OSC → destination.
    /// Valide l'adresse, la transform et la cohérence wildcard/object.
    /// Cap à 256 (audit I12) : le dispatch est O(mappings) par message —
    /// au-delà c'est une mauvaise config, pas un usage réel.
    pub const MAX_MAPPINGS: usize = 256;

    pub fn add_mapping(&self, mapping: OscMapping) -> Result<(), String> {
        validate_mapping(&mapping)?;
        let mut mappings = self
            .shared
            .mappings
            .write()
            .unwrap_or_else(|e| e.into_inner());
        if !mappings.contains_key(&mapping.address) && mappings.len() >= Self::MAX_MAPPINGS {
            return Err(format!(
                "OSC mappings capped at {} (current: {})",
                Self::MAX_MAPPINGS,
                mappings.len()
            ));
        }
        mappings.insert(mapping.address.clone(), mapping);
        Ok(())
    }

    /// Branche le sink show-control — appelé depuis le thread socket à
    /// chaque commande `/stagespace/*` reçue (avec l'adresse source).
    pub fn set_show_sink(
        &self,
        sink: impl Fn(ShowCommand, std::net::SocketAddr) + Send + Sync + 'static,
    ) {
        *self
            .shared
            .show_sink
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(sink));
    }

    /// Migre l'état show-control vers un nouveau receiver — à appeler
    /// lors d'un rebuild (ex. changement de port). Sans ça, le sink,
    /// les contrôleurs, la cible media-sync, le fps TC et le dernier RX
    /// sont perdus : la surface `/stagespace/*` meurt en silence —
    /// les commandes restent ACKées mais ne sont plus jamais dispatchées.
    /// Les Arcs sont adoptés : même état, aucune ré-inscription à faire.
    pub fn migrate_show_control_to(&self, new_receiver: &mut OscReceiver) {
        new_receiver.shared.show_sink = self.shared.show_sink.clone();
        new_receiver.shared.controllers = self.shared.controllers.clone();
        new_receiver.shared.media_sync = self.shared.media_sync.clone();
        new_receiver.shared.timecode_fps = self.shared.timecode_fps.clone();
        new_receiver.shared.last_show_rx = self.shared.last_show_rx.clone();
        // Learn capture (revue F5) : une adresse apprise doit survivre au
        // rebind — sinon l'opérateur perd sa source en cours d'apprentissage.
        new_receiver.shared.last_rx = self.shared.last_rx.clone();
    }

    /// FPS utilisé pour la forme string `HH:MM:SS:FF` du timecode
    /// (non-drop ; défaut 25).
    pub fn set_timecode_fps(&self, fps: f64) {
        self.shared
            .timecode_fps
            .store(fps.to_bits(), Ordering::Relaxed);
    }

    /// Feedback cue vers les contrôleurs récents : envoie
    /// `/stagespace/cue/current <number|"" > <name>` et
    /// `/stagespace/cue/next <number|""> <name>` (args string).
    /// Media sync out — configure la cible dédiée (desk lumière/vidéo)
    /// et le préfixe d'adresse OSC. None = désactivé.
    pub fn set_media_sync(&self, target: Option<std::net::SocketAddr>, prefix: String) {
        *self
            .shared
            .media_sync
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = target.map(|t| (t, prefix));
    }

    pub fn send_show_feedback(
        &self,
        current: Option<(String, String)>,
        next: Option<(String, String)>,
    ) {
        let controllers = self
            .shared
            .controllers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        // La cible media-sync (desk lumière/vidéo) n'envoie jamais rien —
        // elle ne figure donc jamais dans `controllers`. Sans ce check
        // combiné, un media-sync sans controller n'aurait jamais reçu
        // un seul trigger.
        let media = self
            .shared
            .media_sync
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if controllers.is_empty() && media.is_none() {
            return;
        }
        let socket = self
            .shared
            .reply_socket
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .cloned();
        let Some(socket) = socket else { return };
        let current_media = current.clone();
        for (addr_path, cue) in [
            ("/stagespace/cue/current", current),
            ("/stagespace/cue/next", next),
        ] {
            let (num, name) = cue
                .as_ref()
                .map(|(n, name)| (n.clone(), name.clone()))
                .unwrap_or_else(|| (String::new(), String::new()));
            let msg = OscPacket::Message(OscMessage {
                addr: addr_path.to_string(),
                args: vec![OscType::String(num), OscType::String(name)],
            });
            if let Ok(bytes) = encode(&msg) {
                for c in &controllers {
                    let _ = socket.send_to(&bytes, c);
                }
            }
        }
        // Media sync out — le trigger cue vers la cible dédiée
        // (lumière/vidéo) : `{prefix}/cue <num> <name>`.
        if let (Some((target, prefix)), Some((num, name))) = (media, current_media) {
            let msg = OscPacket::Message(OscMessage {
                addr: format!("{prefix}/cue"),
                args: vec![OscType::String(num), OscType::String(name)],
            });
            if let Ok(bytes) = encode(&msg) {
                let _ = socket.send_to(&bytes, target);
            }
        }
    }

    /// NACK ciblé : `/stagespace/nack <reason>` vers l'expéditeur d'une
    /// commande rejetée (busy/not-found) — l'ack confirme la réception,
    /// le nack signale que rien n'a été exécuté.
    /// Handle du socket de réponse — le show-sink backend peut écrire au
    /// demandeur sans webview (feedback positions).
    pub fn reply_socket_handle(&self) -> Arc<Mutex<Option<Arc<UdpSocket>>>> {
        self.shared.reply_socket.clone()
    }

    pub fn send_show_nack(&self, addr: std::net::SocketAddr, reason: &str) {
        let socket = self
            .shared
            .reply_socket
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .cloned();
        let Some(socket) = socket else { return };
        let msg = OscPacket::Message(OscMessage {
            addr: "/stagespace/nack".to_string(),
            args: vec![OscType::String(reason.to_string())],
        });
        if let Ok(bytes) = encode(&msg) {
            let _ = socket.send_to(&bytes, addr);
        }
    }

    /// Âge en secondes de la dernière commande `/stagespace/*` reçue —
    /// None si jamais aucune. Voyant "console connectée" pour l'UI.
    pub fn last_show_cmd_age(&self) -> Option<f64> {
        self.shared
            .last_show_rx
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .map(|t| t.elapsed().as_secs_f64())
    }

    /// Dernier message utilisateur reçu (addr, args, âge en secondes) —
    /// None si rien reçu depuis le démarrage.
    pub fn last_received(&self) -> Option<(String, Vec<f64>, f64)> {
        self.shared
            .last_rx
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|(a, v, t)| (a.clone(), v.clone(), t.elapsed().as_secs_f64()))
    }

    /// Raccourci : mapping passif vers un handler (comportement legacy)
    pub fn add_handler_mapping(
        &self,
        address: impl Into<String>,
        handler: impl Into<String>,
    ) -> Result<(), String> {
        self.add_mapping(OscMapping {
            address: address.into(),
            destination: MappingDestination::Handler {
                name: handler.into(),
            },
            transform: Transform::default(),
            enabled: true,
        })
    }

    /// Supprime un mapping par son adresse pattern
    pub fn remove_mapping(&self, address: &str) -> bool {
        self.shared
            .mappings
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(address)
            .is_some()
    }

    /// Retourne un mapping par adresse pattern
    /// Active/désactive un mapping sans le supprimer — le mapping reste
    /// configuré mais ne paie même pas le match (audit I12). `false` si
    /// l'adresse n'existe pas.
    pub fn set_mapping_enabled(&self, address: &str, enabled: bool) -> bool {
        let mut mappings = self
            .shared
            .mappings
            .write()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(m) = mappings.get_mut(address) {
            m.enabled = enabled;
            true
        } else {
            false
        }
    }

    pub fn get_mapping(&self, address: &str) -> Option<OscMapping> {
        self.shared
            .mappings
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(address)
            .cloned()
    }

    /// Liste tous les mappings
    pub fn list_mappings(&self) -> Vec<OscMapping> {
        self.shared
            .mappings
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .cloned()
            .collect()
    }

    /// Clear tous les mappings
    pub fn clear_mappings(&self) {
        self.shared
            .mappings
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }

    /// Active/désactive globalement l'OSC IN (master switch anti-loop)
    pub fn set_in_enabled(&self, enabled: bool) {
        self.shared.in_enabled.store(enabled, Ordering::SeqCst);
    }

    pub fn in_enabled(&self) -> bool {
        self.shared.in_enabled.load(Ordering::SeqCst)
    }

    /// Supprime l'OSC IN pendant `ms` millisecondes — les messages reçus
    /// pendant la fenêtre sont ignorés (anti-loop pendant recall/panic)
    pub fn suppress_ms(&self, ms: u64) {
        *self
            .shared
            .suppress_until
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(Instant::now() + Duration::from_millis(ms));
    }

    /// Vrai si l'OSC IN est actuellement dans une fenêtre de suppression
    pub fn is_suppressed(&self) -> bool {
        is_suppressed(&self.shared.suppress_until)
    }

    /// Démarre le serveur OSC
    pub fn start(&mut self) -> Result<(), String> {
        // Réconcilie l'état si le thread socket est mort en erreur fatale
        // (sans ça `is_running` resterait true et le receiver serait briqué —
        // impossible de redémarrer sans stop() explicite).
        if self.is_running && !self.shared.thread_running.load(Ordering::SeqCst) {
            if let Some(h) = self.handle.take() {
                let _ = h.join(); // thread déjà terminé — join immédiat
            }
            self.is_running = false;
        }
        if self.is_running {
            return Err("OSC receiver is already running".to_string());
        }

        let socket = UdpSocket::bind(("0.0.0.0", self.port))
            .map_err(|e| format!("Failed to bind UDP socket on port {}: {}", self.port, e))?;

        // Port éphémère (0) → expose le port réellement bindé
        if let Ok(addr) = socket.local_addr() {
            self.port = addr.port();
        }

        socket
            .set_read_timeout(Some(Duration::from_millis(100)))
            .map_err(|e| format!("Failed to set socket timeout: {e}"))?;

        // Clone pour les réponses show-control (ack + feedback cue).
        if let Ok(reply) = socket.try_clone() {
            *self
                .shared
                .reply_socket
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(reply));
        }

        let port = self.port;
        let shared = self.shared.clone();
        let shutdown = self.shutdown.clone();
        // Flag posé AVANT le spawn — sinon `is_alive()` peut voir false si le
        // test/appelant vérifie avant que le thread soit schedulé (race).
        shared.thread_running.store(true, Ordering::SeqCst);
        let handle = thread::spawn(move || {
            // Buffer = datagram UDP max (65535) — aucune troncature
            // silencieuse possible sur un packet OSC valide.
            let mut buf = vec![0u8; 65535];
            while !shutdown.load(Ordering::SeqCst) {
                match socket.recv_from(&mut buf) {
                    Ok((len, src)) => match decode_udp(&buf[..len]) {
                        Ok((_, packet)) => handle_packet(packet, &shared, 0, src),
                        Err(_) => {
                            // Packet malformé — compté, pas droppé en silence
                            shared.stats.decode_errors.fetch_add(1, Ordering::Relaxed);
                        }
                    },
                    Err(ref e)
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            || e.kind() == std::io::ErrorKind::TimedOut =>
                    {
                        // Timeout de 100ms atteint, on relit le drapeau d'arrêt
                        continue;
                    }
                    Err(e) => {
                        eprintln!("OSC receiver fatal recv error on port {port}: {e}");
                        break;
                    }
                }
            }
            // Marque le thread comme arrêté sur TOUTES les sorties (shutdown
            // ou erreur fatale) — sinon is_running resterait stale true.
            shared.thread_running.store(false, Ordering::SeqCst);
            // Libère le clone de réponse AVANT le socket : il garderait le
            // port bindé et bloquerait un restart sur le même port.
            *shared
                .reply_socket
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = None;
            drop(socket);
            eprintln!("OSC receiver thread stopped on port {port}");
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
        // Réarme le drapeau pour permettre un redémarrage
        self.shutdown.store(false, Ordering::SeqCst);
    }

    /// État réel du thread socket — false dès sa sortie, y compris après une
    /// erreur fatale recv (contrairement au champ `is_running`, qui n'est
    /// mis à jour que par start()/stop()).
    pub fn is_alive(&self) -> bool {
        self.shared.thread_running.load(Ordering::SeqCst)
    }

    /// Configure l'index d'objet max accepté par le routing (défaut :
    /// `engines::MAX_OBJECTS` = 1024). Les index résolus >= max sont rejetés —
    /// borne anti-fuite mémoire sur les mappings wildcard.
    pub fn set_max_objects(&self, max: usize) {
        self.shared.max_objects.store(max as u64, Ordering::Relaxed);
    }

    /// Borne courante sur les index d'objet routables
    pub fn max_objects(&self) -> usize {
        self.shared.max_objects.load(Ordering::Relaxed) as usize
    }

    /// Retourne la dernière valeur reçue pour une clé (handler name ou
    /// feedback key de destination : "macro:scale", "channel:Gain:3", …)
    pub fn get_last_value(&self, key: &str) -> Option<Vec<f64>> {
        self.shared.last_values.lock().ok()?.get(key).cloned()
    }

    /// Handle partagé sur le cache des dernières valeurs — utilisé par le
    /// compilateur pour brancher les nodes `OSCInput` sur les valeurs live.
    pub fn values_handle(&self) -> Arc<Mutex<HashMap<String, Vec<f64>>>> {
        self.shared.last_values.clone()
    }

    /// Handle partagé sur les dernières valeurs par adresse brute — à passer
    /// au compiler (`compile_with_audio_osc`) pour alimenter les OSCInput.
    pub fn address_values_handle(&self) -> Arc<Mutex<HashMap<String, Vec<f64>>>> {
        self.shared.last_by_address.clone()
    }

    /// Retourne toutes les dernières valeurs
    pub fn get_all_values(&self) -> HashMap<String, Vec<f64>> {
        self.shared
            .last_values
            .lock()
            .map(|lv| lv.clone())
            .unwrap_or_default()
    }

    /// Snapshot des statistiques du pipeline
    pub fn stats(&self) -> OscInStatsSnapshot {
        OscInStatsSnapshot {
            packets_received: self.shared.stats.packets_received.load(Ordering::Relaxed),
            messages_matched: self.shared.stats.messages_matched.load(Ordering::Relaxed),
            values_routed: self.shared.stats.values_routed.load(Ordering::Relaxed),
            messages_dropped: self.shared.stats.messages_dropped.load(Ordering::Relaxed),
            decode_errors: self.shared.stats.decode_errors.load(Ordering::Relaxed),
        }
    }

    /// Traite un message OSC entrant — même pipeline que le thread socket
    /// (transform → routage → feedback). Utilisable directement pour les
    /// tests ou l'injection manuelle.
    pub fn handle_message(&self, addr: &str, args: Vec<f64>) {
        dispatch_message(addr, args, &self.shared);
    }
}

impl Default for OscReceiver {
    fn default() -> Self {
        Self::new(8001)
    }
}

impl Drop for OscReceiver {
    /// Live-safety : stop()+join implicite si l'app oublie stop() —
    /// sinon le thread socket orphelin continue de recevoir/dispatcher.
    fn drop(&mut self) {
        self.stop();
    }
}

// ─── Pipeline interne ───────────────────────────────────────────────────────

type LastRx = (String, Vec<f64>, Instant);
