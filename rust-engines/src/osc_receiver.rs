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

/// Profondeur max d'imbrication des bundles OSC — au-delà, le packet est
/// droppé (protection contre les bundles récursifs malveillants).
const MAX_BUNDLE_DEPTH: usize = 8;

/// Nombre max de clés de feedback (`last_values`) — borne mémoire : les clés
/// incluent l'index d'objet résolu, donc un mapping wildcard recevant des ids
/// arbitraires (/track/*/gain) pourrait faire croître la map sans limite.
const MAX_FEEDBACK_KEYS: usize = 4096;

// ─── Transform ──────────────────────────────────────────────────────────────

/// Transformation appliquée à chaque valeur OSC entrante.
/// Ordre : deadzone → `v * scale + offset` → clamp [min, max] → lissage.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Transform {
    pub scale: f64,
    pub offset: f64,
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// Lissage one-pole [0, 1) — 0 = brut, 0.9 = très lissé (état par mapping)
    pub smooth: f64,
    /// Deadzone sur la valeur brute : |v| < deadzone → 0 (joysticks, pads)
    pub deadzone: f64,
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            scale: 1.0,
            offset: 0.0,
            min: None,
            max: None,
            smooth: 0.0,
            deadzone: 0.0,
        }
    }
}

impl Transform {
    /// deadzone → affine → clamp (le lissage est appliqué par le receiver,
    /// qui détient l'état par mapping)
    pub fn apply(&self, v: f64) -> f64 {
        let mut v = v;
        if v.abs() < self.deadzone {
            v = 0.0;
        }
        let v = v * self.scale + self.offset;
        match (self.min, self.max) {
            (Some(min), Some(max)) => v.clamp(min, max),
            (Some(min), None) => v.max(min),
            (None, Some(max)) => v.min(max),
            (None, None) => v,
        }
    }

    fn validate(&self) -> Result<(), String> {
        if !(0.0..1.0).contains(&self.smooth) {
            return Err(format!("smooth must be in [0, 1), got {}", self.smooth));
        }
        if self.deadzone < 0.0 {
            return Err(format!("deadzone must be >= 0, got {}", self.deadzone));
        }
        if let (Some(min), Some(max)) = (self.min, self.max) {
            if min > max {
                return Err(format!("min ({min}) > max ({max})"));
            }
        }
        Ok(())
    }
}

// ─── Destinations ───────────────────────────────────────────────────────────

/// Référence à un objet cible : index fixe ou segment wildcard de l'adresse.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export)]
pub enum ObjectRef {
    /// Index fixe dans la liste des objets (même convention que set-channel)
    Index(usize),
    /// `"*"` = premier wildcard de l'adresse, `"*1"` = deuxième, etc.
    /// Le segment capturé est parsé comme usize.
    Wildcard(String),
}

impl ObjectRef {
    fn wildcard_index(&self) -> Option<usize> {
        match self {
            ObjectRef::Index(_) => None,
            ObjectRef::Wildcard(w) => Some(w.trim_start_matches('*').parse().unwrap_or(0)),
        }
    }

    /// Résout l'index d'objet à partir des segments capturés par les wildcards.
    /// Retourne None si le segment capturé n'est pas un entier.
    pub fn resolve(&self, captures: &[String]) -> Option<usize> {
        match self {
            ObjectRef::Index(i) => Some(*i),
            ObjectRef::Wildcard(_) => captures.get(self.wildcard_index()?)?.parse::<usize>().ok(),
        }
    }
}

/// Macros spatiales du MergeRuntime pilotables par OSC IN.
/// (`speed` est exclu — il est per-move, pas global.)
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MacroTarget {
    Scale,
    ShiftX,
    ShiftY,
    ShiftZ,
    Yaw,
    Pitch,
    Roll,
    RadiusScale,
    HeightOffset,
}

impl FromStr for MacroTarget {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "scale" => Ok(MacroTarget::Scale),
            "shift_x" | "shiftx" => Ok(MacroTarget::ShiftX),
            "shift_y" | "shifty" => Ok(MacroTarget::ShiftY),
            "shift_z" | "shiftz" => Ok(MacroTarget::ShiftZ),
            "yaw" => Ok(MacroTarget::Yaw),
            "pitch" => Ok(MacroTarget::Pitch),
            "roll" => Ok(MacroTarget::Roll),
            "radius_scale" | "radiusscale" | "radius" => Ok(MacroTarget::RadiusScale),
            "height_offset" | "heightoffset" | "height" => Ok(MacroTarget::HeightOffset),
            _ => Err(format!(
                "Unknown macro target: {s} (scale|shift_x|shift_y|shift_z|yaw|pitch|roll|radius_scale|height_offset)"
            )),
        }
    }
}

impl MacroTarget {
    /// Écrit la valeur dans l'atomic correspondant (lock-free)
    fn apply(&self, macros: &MacroState, v: f64) {
        let field = match self {
            MacroTarget::Scale => &macros.scale,
            MacroTarget::ShiftX => &macros.shift_x,
            MacroTarget::ShiftY => &macros.shift_y,
            MacroTarget::ShiftZ => &macros.shift_z,
            MacroTarget::Yaw => &macros.yaw,
            MacroTarget::Pitch => &macros.pitch,
            MacroTarget::Roll => &macros.roll,
            MacroTarget::RadiusScale => &macros.radius_scale,
            MacroTarget::HeightOffset => &macros.height_offset,
        };
        field.store(v.to_bits(), Ordering::Relaxed);
    }

    fn name(&self) -> &'static str {
        match self {
            MacroTarget::Scale => "scale",
            MacroTarget::ShiftX => "shift_x",
            MacroTarget::ShiftY => "shift_y",
            MacroTarget::ShiftZ => "shift_z",
            MacroTarget::Yaw => "yaw",
            MacroTarget::Pitch => "pitch",
            MacroTarget::Roll => "roll",
            MacroTarget::RadiusScale => "radius_scale",
            MacroTarget::HeightOffset => "height_offset",
        }
    }
}

/// Destination d'un mapping OSC IN.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum MappingDestination {
    /// Stockage passif — valeur lisible via get_last_value / get_all_values
    /// (polling par le frontend ou injection manuelle dans le graphe)
    Handler { name: String },
    /// Macro spatiale globale du MergeRuntime (scale, shift_*, yaw, pitch,
    /// roll, radius_scale, height_offset)
    Macro { name: MacroTarget },
    /// Canal spatial étendu d'un objet (gain, spread, distance, presence,
    /// yaw, aperture, lfe)
    Channel {
        channel: SpatialChannel,
        object: ObjectRef,
    },
    /// Position manuelle d'un objet — nécessite au moins 3 valeurs (x, y, z)
    Position { object: ObjectRef },
}

impl MappingDestination {
    /// Clé sous laquelle la dernière valeur reçue est stockée dans last_values
    /// (feedback UI / polling). Inclut l'index résolu quand il est disponible.
    fn feedback_key(&self, captures: &[String]) -> String {
        let obj = |o: &ObjectRef| match o {
            ObjectRef::Index(i) => i.to_string(),
            ObjectRef::Wildcard(w) => o
                .resolve(captures)
                .map(|i| i.to_string())
                .unwrap_or_else(|| w.clone()),
        };
        match self {
            MappingDestination::Handler { name } => name.clone(),
            MappingDestination::Macro { name } => format!("macro:{}", name.name()),
            MappingDestination::Channel { channel, object } => {
                format!("channel:{channel:?}:{}", obj(object))
            }
            MappingDestination::Position { object } => format!("position:{}", obj(object)),
        }
    }
}

/// Mapping OSC → destination avec transform.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OscMapping {
    /// Adresse OSC — `*` matche exactement un segment (capturé pour
    /// [`ObjectRef::Wildcard`])
    pub address: String,
    pub destination: MappingDestination,
    #[serde(default)]
    pub transform: Transform,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

// ─── Targets ────────────────────────────────────────────────────────────────

/// Canaux spatiaux partagés (object_index → SpatialChannels)
pub type SharedChannels = Arc<RwLock<HashMap<usize, SpatialChannels>>>;
/// Positions manuelles partagées (object_index → [x, y, z])
pub type SharedPositions = Arc<RwLock<HashMap<usize, [f64; 3]>>>;

/// Points de sortie du routing OSC IN — Arcs partagés avec le MergeRuntime.
/// Le receiver écrit directement dedans depuis son thread ; le merge thread
/// les lit normalement — aucun lock supplémentaire dans son chemin temps réel.
#[derive(Clone, Default)]
pub struct OscInTargets {
    pub macros: Option<Arc<MacroState>>,
    pub object_channels: Option<SharedChannels>,
    pub manual_positions: Option<SharedPositions>,
}

impl std::fmt::Debug for OscInTargets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OscInTargets")
            .field("macros", &self.macros.is_some())
            .field("object_channels", &self.object_channels.is_some())
            .field("manual_positions", &self.manual_positions.is_some())
            .finish()
    }
}

/// Statistiques du pipeline OSC IN (pour monitoring live)
#[derive(Debug, Default)]
pub struct OscInStats {
    pub packets_received: AtomicU64,
    pub messages_matched: AtomicU64,
    pub values_routed: AtomicU64,
    pub messages_dropped: AtomicU64,
    /// Datagrams UDP reçus mais indécodables (malformés / non-OSC) —
    /// avant : silencieusement ignorés.
    pub decode_errors: AtomicU64,
}

/// Snapshot sérialisable des stats
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OscInStatsSnapshot {
    #[ts(type = "number")]
    pub packets_received: u64,
    #[ts(type = "number")]
    pub messages_matched: u64,
    #[ts(type = "number")]
    pub values_routed: u64,
    #[ts(type = "number")]
    pub messages_dropped: u64,
    #[ts(type = "number")]
    pub decode_errors: u64,
}

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
    /// 4 dernières adresses ayant envoyé une commande `/stagespace/` —
    /// reçoivent ack + feedback de cue.
    controllers: Arc<Mutex<Vec<std::net::SocketAddr>>>,
    /// Socket de réponse (try_clone du socket de réception) — posé au
    /// démarrage du thread pour envoyer ack/feedback aux contrôleurs.
    reply_socket: Arc<Mutex<Option<Arc<UdpSocket>>>>,
    /// FPS pour la conversion `HH:MM:SS:FF` → secondes (24/25/30,
    /// non-drop ; défaut 25). Configurable depuis le slice OSC.
    timecode_fps: Arc<AtomicU64>,
}

/// Commande show-control reçue via `/stagespace/*` — transmise telle
/// quelle au frontend qui la dispatche vers les mêmes fonctions que
/// les raccourcis clavier (backend = routeur seulement).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "command", content = "value")]
pub enum ShowCommand {
    /// `/stagespace/go` — GO setlist (comme Enter).
    Go,
    /// `/stagespace/cue/next` — prochaine cue armée (Shift+Enter).
    CueNext,
    /// `/stagespace/cue/prev` — cue précédente (Backspace).
    CuePrev,
    /// `/stagespace/cue/recall <n> [fade]` — n = cue_number (string ou
    /// nombre, fallback index 1-based) ; fade optionnel en secondes
    /// (écrase le fade_duration stocké — la console choisit son fondu).
    CueRecall(String, Option<f64>),
    /// `/stagespace/slot <n>` — joue le slot n (index 1-based, busking).
    Slot(usize),
    /// `/stagespace/slot/stop <n>` — coupe le slot n avec son fade_out.
    SlotStop(usize),
    /// `/stagespace/solo <n>` — coupe tous les autres slots et joue n.
    Solo(usize),
    /// `/stagespace/arm` — arme l'émission OSC (fin du dry-run).
    Arm,
    /// `/stagespace/disarm` — dry-run : le merge tourne, rien ne part.
    Disarm,
    /// `/stagespace/status` — renvoie immédiatement le feedback cue
    /// courant/suivant au demandeur (initialisation console/companion).
    Status,
    /// `/stagespace/park <obj>` — l'objet n'est plus touché par les cues.
    Park(usize),
    /// `/stagespace/unpark <obj>`.
    Unpark(usize),
    /// `/stagespace/panic` — Esc panic.
    Panic,
    /// `/stagespace/stop` — stop tous les moves.
    Stop,
    /// `/stagespace/timecode <seconds | "HH:MM:SS:FF">` — secondes.
    Timecode(f64),
}

type ShowSink = Box<dyn Fn(ShowCommand, std::net::SocketAddr) + Send>;

const MAX_CONTROLLERS: usize = 4;

/// Parse un message `/stagespace/*` (args bruts — strings préservées).
/// `fps` = frames/s pour la forme string `HH:MM:SS:FF` du timecode.
fn parse_show_command(addr: &str, args: &[OscType], fps: f64) -> Option<ShowCommand> {
    let tail = addr.strip_prefix("/stagespace/")?;
    match tail {
        "go" => Some(ShowCommand::Go),
        "cue/next" => Some(ShowCommand::CueNext),
        "cue/prev" => Some(ShowCommand::CuePrev),
        "cue/recall" => {
            let id = args.first().and_then(|a| match a {
                OscType::String(s) => Some(s.clone()),
                OscType::Int(i) => Some(i.to_string()),
                OscType::Long(i) => Some(i.to_string()),
                OscType::Float(f) => Some(format!("{f}")),
                OscType::Double(f) => Some(format!("{f}")),
                _ => None,
            })?;
            let fade = args.get(1).and_then(|a| match a {
                OscType::Float(v) => Some(*v as f64),
                OscType::Int(v) => Some(*v as f64),
                _ => None,
            });
            Some(ShowCommand::CueRecall(id, fade))
        }
        "park" => args
            .first()
            .and_then(|a| match a {
                OscType::Float(v) => Some(*v as usize),
                OscType::Int(v) => Some((*v).max(0) as usize),
                OscType::String(s) => s.parse::<usize>().ok(),
                _ => None,
            })
            .map(ShowCommand::Park),
        "unpark" => args
            .first()
            .and_then(|a| match a {
                OscType::Float(v) => Some(*v as usize),
                OscType::Int(v) => Some((*v).max(0) as usize),
                OscType::String(s) => s.parse::<usize>().ok(),
                _ => None,
            })
            .map(ShowCommand::Unpark),
        "slot" | "slot/stop" | "solo" => {
            let n = args.first().and_then(|a| match a {
                OscType::Float(v) => Some(*v as usize),
                OscType::Int(v) => Some((*v).max(0) as usize),
                OscType::String(s) => s.parse::<usize>().ok(),
                _ => None,
            });
            match (tail, n) {
                ("slot", Some(n)) => Some(ShowCommand::Slot(n)),
                ("slot/stop", Some(n)) => Some(ShowCommand::SlotStop(n)),
                ("solo", Some(n)) => Some(ShowCommand::Solo(n)),
                _ => None,
            }
        }
        "arm" => Some(ShowCommand::Arm),
        "disarm" => Some(ShowCommand::Disarm),
        "status" => Some(ShowCommand::Status),
        "panic" => Some(ShowCommand::Panic),
        "stop" => Some(ShowCommand::Stop),
        "timecode" => {
            let tc = args.first().and_then(|a| match a {
                OscType::Float(f) => Some(*f as f64),
                OscType::Double(f) => Some(*f),
                OscType::Int(i) => Some(*i as f64),
                OscType::Long(i) => Some(*i as f64),
                OscType::String(s) => parse_timecode_string(s, fps),
                _ => None,
            })?;
            Some(ShowCommand::Timecode(tc))
        }
        _ => None,
    }
}

/// `HH:MM:SS:FF` → secondes (non-drop : FF = frames à `fps` fps).
fn parse_timecode_string(s: &str, fps: f64) -> Option<f64> {
    if fps <= 0.0 {
        return None;
    }
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 4 {
        return None;
    }
    let h: f64 = parts[0].trim().parse().ok()?;
    let m: f64 = parts[1].trim().parse().ok()?;
    let sec: f64 = parts[2].trim().parse().ok()?;
    let fr: f64 = parts[3].trim().parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + sec + fr / fps)
}

/// OSC Receiver — réception OSC avec mapping configurable style libmapper.
///
/// `start()` ouvre un socket UDP sur `0.0.0.0:port` et lance un thread de lecture.
/// `stop()` l'arrête proprement. Les mappings sont modifiables à chaud (RwLock
/// partagé) — pas besoin de redémarrer. `handle_message()` expose le pipeline
/// de routing directement (injection de test sans UDP).
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
                controllers: Arc::new(Mutex::new(Vec::new())),
                reply_socket: Arc::new(Mutex::new(None)),
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
    pub fn set_show_sink(&self, sink: impl Fn(ShowCommand, std::net::SocketAddr) + Send + 'static) {
        *self
            .shared
            .show_sink
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(Box::new(sink));
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
        if controllers.is_empty() {
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
    }

    /// NACK ciblé : `/stagespace/nack <reason>` vers l'expéditeur d'une
    /// commande rejetée (busy/not-found) — l'ack confirme la réception,
    /// le nack signale que rien n'a été exécuté.
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

/// Match une adresse contre un pattern. `*` matche exactement un segment
/// non vide. Retourne les segments capturés par les wildcards (dans l'ordre).
///
/// Itérateurs directement sur `split` — zéro allocation pour les mappings
/// qui ne matchent pas (audit I14 : auparavant 2 Vec<&str> + Vec<String>
/// alloués PAR mapping PAR message, dont ~tous non-matchants).
fn match_address(pattern: &str, addr: &str) -> Option<Vec<String>> {
    let mut captures = Vec::new();
    let mut p = pattern.split('/').filter(|s| !s.is_empty());
    let mut a = addr.split('/').filter(|s| !s.is_empty());
    loop {
        match (p.next(), a.next()) {
            (None, None) => return Some(captures),
            (Some("*"), Some(seg)) => captures.push(seg.to_string()),
            (Some(ps), Some(as_)) if ps == as_ => {}
            _ => return None,
        }
    }
}

fn is_suppressed(suppress_until: &Mutex<Option<Instant>>) -> bool {
    suppress_until
        .lock()
        .map(|g| g.is_some_and(|t| Instant::now() < t))
        .unwrap_or(false)
}

fn validate_mapping(mapping: &OscMapping) -> Result<(), String> {
    if !mapping.address.starts_with('/') {
        return Err(format!(
            "OSC address must start with '/', got '{}'",
            mapping.address
        ));
    }
    mapping.transform.validate()?;

    // Cohérence wildcard ↔ ObjectRef : l'index wildcard demandé doit exister
    // dans le pattern d'adresse
    let n_wildcards = mapping.address.split('/').filter(|s| *s == "*").count();
    let check_object = |o: &ObjectRef| -> Result<(), String> {
        if let ObjectRef::Wildcard(w) = o {
            let suffix = w.trim_start_matches('*');
            let idx = if suffix.is_empty() {
                0
            } else {
                suffix.parse::<usize>().map_err(|_| {
                    format!("Invalid wildcard object ref '{w}' (expected '*' or '*N')")
                })?
            };
            if idx >= n_wildcards {
                return Err(format!(
                    "Object ref '{w}' needs wildcard #{idx} but address '{}' only has {n_wildcards}",
                    mapping.address
                ));
            }
        }
        Ok(())
    };
    match &mapping.destination {
        MappingDestination::Channel { object, .. } | MappingDestination::Position { object } => {
            check_object(object)?
        }
        _ => {}
    }
    Ok(())
}

fn extract_args(args: &[OscType]) -> Vec<f64> {
    args.iter()
        .filter_map(|arg| match arg {
            OscType::Float(v) => Some(*v as f64),
            OscType::Double(v) => Some(*v),
            OscType::Int(v) => Some(*v as f64),
            OscType::Long(v) => Some(*v as f64),
            _ => None,
        })
        .collect()
}

fn handle_packet(packet: OscPacket, shared: &Shared, depth: usize, src: std::net::SocketAddr) {
    match packet {
        OscPacket::Message(msg) => {
            // Show-control : intercepté AVANT les mappings utilisateurs
            // et AVANT la suppression (un recall ne doit pas avaler un
            // `/stagespace/panic` reçu pendant sa fenêtre anti-loop).
            if msg.addr.starts_with("/stagespace/") {
                handle_show_command(&msg, src, shared);
                return;
            }
            dispatch_message(&msg.addr, extract_args(&msg.args), shared);
        }
        OscPacket::Bundle(bundle) => {
            if depth >= MAX_BUNDLE_DEPTH {
                // Bundle trop profond — droppé et compté (anti-récursion
                // infinie sur packets malveillants)
                shared
                    .stats
                    .messages_dropped
                    .fetch_add(1, Ordering::Relaxed);
                return;
            }
            for packet in bundle.content {
                handle_packet(packet, shared, depth + 1, src);
            }
        }
    }
}

/// `/stagespace/*` : mémorise le contrôleur (max 4), ack immédiat,
/// callback sink avec la commande parsée. Inconnu → 1 log par adresse.
fn handle_show_command(msg: &OscMessage, src: std::net::SocketAddr, shared: &Shared) {
    shared
        .stats
        .packets_received
        .fetch_add(1, Ordering::Relaxed);
    {
        let mut c = shared.controllers.lock().unwrap_or_else(|e| e.into_inner());
        c.retain(|a| *a != src);
        c.insert(0, src);
        c.truncate(MAX_CONTROLLERS);
    }
    // Ack immédiat : /stagespace/ack <address>
    let socket = shared
        .reply_socket
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .cloned();
    if let Some(socket) = socket {
        let ack = OscPacket::Message(OscMessage {
            addr: "/stagespace/ack".to_string(),
            args: vec![OscType::String(msg.addr.clone())],
        });
        if let Ok(bytes) = encode(&ack) {
            let _ = socket.send_to(&bytes, src);
        }
    }
    let fps = f64::from_bits(shared.timecode_fps.load(Ordering::Relaxed));
    match parse_show_command(&msg.addr, &msg.args, fps) {
        Some(cmd) => {
            if let Some(sink) = shared
                .show_sink
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
            {
                sink(cmd, src);
            }
        }
        None => {
            // Inconnu → ignoré, 1 log par adresse (pas de spam par paquet).
            static WARNED: std::sync::OnceLock<
                std::sync::Mutex<std::collections::HashSet<String>>,
            > = std::sync::OnceLock::new();
            let mut w = WARNED
                .get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if w.insert(msg.addr.clone()) {
                crate::logging::log_osc_error(&format!(
                    "Unknown show-control address '{}' — ignored",
                    msg.addr
                ));
            }
        }
    }
}

/// Pipeline complet : enable/suppression → match → transform+smooth →
/// feedback (last_values) → routage vers la destination.
fn dispatch_message(addr: &str, args: Vec<f64>, shared: &Shared) {
    shared
        .stats
        .packets_received
        .fetch_add(1, Ordering::Relaxed);

    if !shared.in_enabled.load(Ordering::SeqCst) || is_suppressed(&shared.suppress_until) {
        shared
            .stats
            .messages_dropped
            .fetch_add(1, Ordering::Relaxed);
        return;
    }

    let max_objects = shared.max_objects.load(Ordering::Relaxed) as usize;

    // Cache par adresse brute pour les nodes OSCInput — écrit avant le
    // matching des mappings : une adresse alimente le graphe même sans
    // mapping configuré. Même borne mémoire que le feedback.
    {
        let mut lv = shared
            .last_by_address
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if lv.len() < MAX_FEEDBACK_KEYS || lv.contains_key(addr) {
            lv.insert(addr.to_string(), args.clone());
            // Capture learn : le dernier message utilisateur reçu.
            *shared.last_rx.lock().unwrap_or_else(|e| e.into_inner()) =
                Some((addr.to_string(), args.clone(), Instant::now()) as LastRx);
        }
    }

    // Itération sous read lock — pas de clone de la map par message.
    // Pas de risque de deadlock : rien dans la boucle n'acquiert
    // mappings.write() (add_mapping ne tient aucun autre lock).
    let mappings_guard = shared.mappings.read().unwrap_or_else(|e| e.into_inner());

    for mapping in mappings_guard.values() {
        // enabled d'abord : un mapping désactivé ne paie même pas le match.
        if !mapping.enabled {
            continue;
        }
        let Some(captures) = match_address(&mapping.address, addr) else {
            continue;
        };
        shared
            .stats
            .messages_matched
            .fetch_add(1, Ordering::Relaxed);

        // deadzone → affine → clamp
        let mut values: Vec<f64> = args.iter().map(|&v| mapping.transform.apply(v)).collect();

        // Lissage one-pole (état conservé par adresse de mapping)
        if mapping.transform.smooth > 0.0 {
            let alpha = mapping.transform.smooth;
            let mut ss = shared
                .smooth_state
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            let state = ss.entry(mapping.address.clone()).or_default();
            if state.len() != values.len() {
                *state = values.clone();
            } else {
                for (i, v) in values.iter_mut().enumerate() {
                    state[i] = alpha * state[i] + (1.0 - alpha) * *v;
                    *v = state[i];
                }
            }
        }

        // Feedback — la valeur transformée est visible via get_last_value.
        // Borné à MAX_FEEDBACK_KEYS : les clés incluant l'index résolu, un
        // wildcard storm ne doit pas faire croître la map sans limite.
        {
            let key = mapping.destination.feedback_key(&captures);
            let mut lv = shared.last_values.lock().unwrap_or_else(|e| e.into_inner());
            if lv.len() < MAX_FEEDBACK_KEYS || lv.contains_key(&key) {
                lv.insert(key, values.clone());
            }
        }

        // Routage vers la destination active
        let routed = {
            let targets = shared.targets.read().unwrap_or_else(|e| e.into_inner());
            route_destination(
                &mapping.destination,
                &values,
                &captures,
                &targets,
                max_objects,
            )
        };
        if routed {
            shared.stats.values_routed.fetch_add(1, Ordering::Relaxed);
        }
    }
}

fn route_destination(
    destination: &MappingDestination,
    values: &[f64],
    captures: &[String],
    targets: &OscInTargets,
    max_objects: usize,
) -> bool {
    match destination {
        MappingDestination::Handler { .. } => {
            // Passif — déjà stocké dans last_values
            true
        }
        MappingDestination::Macro { name } => match (&targets.macros, values.first()) {
            (Some(macros), Some(&v)) => {
                name.apply(macros, v);
                true
            }
            _ => false,
        },
        MappingDestination::Channel { channel, object } => {
            match (
                &targets.object_channels,
                object.resolve(captures),
                values.first(),
            ) {
                // Index borné : un id arbitraire via wildcard ne doit pas
                // allouer une entrée dans la map (croissance illimitée +
                // clone par frame de merge)
                (Some(channels), Some(obj), Some(&v)) if obj < max_objects => {
                    channels
                        .write()
                        .unwrap_or_else(|e| e.into_inner())
                        .entry(obj)
                        .or_default()
                        .set(*channel, v);
                    true
                }
                _ => false,
            }
        }
        MappingDestination::Position { object } => {
            match (&targets.manual_positions, object.resolve(captures)) {
                (Some(positions), Some(obj)) if values.len() >= 3 && obj < max_objects => {
                    positions
                        .write()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(obj, [values[0], values[1], values[2]]);
                    true
                }
                _ => false,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recv() -> OscReceiver {
        OscReceiver::new(8001)
    }

    fn channel_mapping(addr: &str, ch: SpatialChannel, obj: ObjectRef) -> OscMapping {
        OscMapping {
            address: addr.to_string(),
            destination: MappingDestination::Channel {
                channel: ch,
                object: obj,
            },
            transform: Transform::default(),
            enabled: true,
        }
    }

    // ── match_address ──

    #[test]
    fn test_match_exact() {
        let c = match_address("/track/1/x", "/track/1/x").unwrap();
        assert!(c.is_empty());
        assert!(match_address("/track/1/x", "/track/2/x").is_none());
        assert!(match_address("/track/1/x", "/track/1").is_none());
    }

    #[test]
    fn test_match_wildcard() {
        let c = match_address("/track/*/gain", "/track/7/gain").unwrap();
        assert_eq!(c, vec!["7".to_string()]);
        let c = match_address("/*/*/x", "/a/b/x").unwrap();
        assert_eq!(c, vec!["a".to_string(), "b".to_string()]);
        assert!(match_address("/track/*/gain", "/track/1/freq").is_none());
    }

    // ── Transform ──

    #[test]
    fn test_transform_affine_clamp() {
        let t = Transform {
            scale: 2.0,
            offset: 1.0,
            min: Some(0.0),
            max: Some(5.0),
            ..Default::default()
        };
        assert_eq!(t.apply(1.0), 3.0);
        assert_eq!(t.apply(10.0), 5.0);
        assert_eq!(t.apply(-10.0), 0.0);
    }

    #[test]
    fn test_transform_deadzone() {
        let t = Transform {
            deadzone: 0.1,
            ..Default::default()
        };
        assert_eq!(t.apply(0.05), 0.0);
        assert_eq!(t.apply(-0.05), 0.0);
        assert_eq!(t.apply(0.5), 0.5);
    }

    // ── Validation ──

    #[test]
    fn test_add_mapping_validation() {
        let r = recv();
        // Adresse invalide
        let mut m = channel_mapping("track/1", SpatialChannel::Gain, ObjectRef::Index(0));
        assert!(r.add_mapping(m.clone()).is_err());
        // Wildcard object sans wildcard dans l'adresse
        m = channel_mapping(
            "/track/gain",
            SpatialChannel::Gain,
            ObjectRef::Wildcard("*".into()),
        );
        assert!(r.add_mapping(m).is_err());
        // Wildcard index trop grand
        m = channel_mapping(
            "/track/*/gain",
            SpatialChannel::Gain,
            ObjectRef::Wildcard("*1".into()),
        );
        assert!(r.add_mapping(m).is_err());
        // Smooth hors [0,1)
        m = channel_mapping("/x", SpatialChannel::Gain, ObjectRef::Index(0));
        m.transform.smooth = 1.5;
        assert!(r.add_mapping(m).is_err());
        // min > max
        m = channel_mapping("/x", SpatialChannel::Gain, ObjectRef::Index(0));
        m.transform.min = Some(2.0);
        m.transform.max = Some(1.0);
        assert!(r.add_mapping(m).is_err());
    }

    // ── Handler (passif) ──

    #[test]
    fn test_handler_mapping_stores_value() {
        let r = recv();
        r.add_handler_mapping("/fader/1", "fader1").unwrap();
        r.handle_message("/fader/1", vec![0.5]);
        assert_eq!(r.get_last_value("fader1"), Some(vec![0.5]));
        assert_eq!(r.get_last_value("/fader/1"), None); // key = handler name
    }

    // ── Routage macro ──

    #[test]
    fn test_macro_routing() {
        let r = recv();
        let macros = Arc::new(MacroState::new());
        r.set_targets(OscInTargets {
            macros: Some(macros.clone()),
            ..Default::default()
        });
        r.add_mapping(OscMapping {
            address: "/ctl/scale".into(),
            destination: MappingDestination::Macro {
                name: MacroTarget::Scale,
            },
            transform: Transform {
                scale: 2.0,
                ..Default::default()
            },
            enabled: true,
        })
        .unwrap();
        r.handle_message("/ctl/scale", vec![0.75]);
        assert_eq!(f64::from_bits(macros.scale.load(Ordering::Relaxed)), 1.5);
        assert_eq!(r.get_last_value("macro:scale"), Some(vec![1.5]));
    }

    // ── Routage channel + wildcard ──

    #[test]
    fn test_channel_routing_wildcard() {
        let r = recv();
        let channels: Arc<RwLock<HashMap<usize, SpatialChannels>>> =
            Arc::new(RwLock::new(HashMap::new()));
        r.set_targets(OscInTargets {
            object_channels: Some(channels.clone()),
            ..Default::default()
        });
        r.add_mapping(channel_mapping(
            "/track/*/gain",
            SpatialChannel::Gain,
            ObjectRef::Wildcard("*".into()),
        ))
        .unwrap();
        r.handle_message("/track/3/gain", vec![0.8]);
        let chs = channels.read().unwrap();
        assert_eq!(chs.get(&3).and_then(|c| c.gain), Some(0.8));
    }

    #[test]
    fn test_channel_routing_non_numeric_wildcard_dropped() {
        let r = recv();
        let channels: Arc<RwLock<HashMap<usize, SpatialChannels>>> =
            Arc::new(RwLock::new(HashMap::new()));
        r.set_targets(OscInTargets {
            object_channels: Some(channels.clone()),
            ..Default::default()
        });
        r.add_mapping(channel_mapping(
            "/track/*/gain",
            SpatialChannel::Gain,
            ObjectRef::Wildcard("*".into()),
        ))
        .unwrap();
        r.handle_message("/track/abc/gain", vec![0.8]);
        assert!(channels.read().unwrap().is_empty());
        // Le feedback est quand même stocké (clé = wildcard brut)
        assert_eq!(r.get_last_value("channel:Gain:*"), Some(vec![0.8]));
    }

    // ── Routage position ──

    #[test]
    fn test_position_routing() {
        let r = recv();
        let positions: Arc<RwLock<HashMap<usize, [f64; 3]>>> =
            Arc::new(RwLock::new(HashMap::new()));
        r.set_targets(OscInTargets {
            manual_positions: Some(positions.clone()),
            ..Default::default()
        });
        r.add_mapping(OscMapping {
            address: "/spacemouse/pos".into(),
            destination: MappingDestination::Position {
                object: ObjectRef::Index(2),
            },
            transform: Transform::default(),
            enabled: true,
        })
        .unwrap();
        r.handle_message("/spacemouse/pos", vec![1.0, 2.0, 3.0]);
        assert_eq!(positions.read().unwrap().get(&2), Some(&[1.0, 2.0, 3.0]));
        // Pas assez de valeurs → pas de routage
        r.handle_message("/spacemouse/pos", vec![9.0]);
        assert_eq!(positions.read().unwrap().get(&2), Some(&[1.0, 2.0, 3.0]));
    }

    // ── Enable / suppression ──

    #[test]
    fn test_disabled_mapping_not_routed() {
        let r = recv();
        r.add_mapping(OscMapping {
            address: "/x".into(),
            destination: MappingDestination::Handler { name: "h".into() },
            transform: Transform::default(),
            enabled: false,
        })
        .unwrap();
        r.handle_message("/x", vec![1.0]);
        assert!(r.get_last_value("h").is_none());
    }

    #[test]
    fn test_in_disabled_drops_all() {
        let r = recv();
        r.add_handler_mapping("/x", "h").unwrap();
        r.set_in_enabled(false);
        r.handle_message("/x", vec![1.0]);
        assert!(r.get_last_value("h").is_none());
        assert_eq!(r.stats().messages_dropped, 1);
        r.set_in_enabled(true);
        r.handle_message("/x", vec![2.0]);
        assert_eq!(r.get_last_value("h"), Some(vec![2.0]));
    }

    #[test]
    fn test_suppress_window() {
        let r = recv();
        r.add_handler_mapping("/x", "h").unwrap();
        r.suppress_ms(100);
        assert!(r.is_suppressed());
        r.handle_message("/x", vec![1.0]);
        assert!(r.get_last_value("h").is_none());
        std::thread::sleep(Duration::from_millis(120));
        r.handle_message("/x", vec![2.0]);
        assert_eq!(r.get_last_value("h"), Some(vec![2.0]));
    }

    // ── Lissage ──

    #[test]
    fn test_smoothing_converges() {
        let r = recv();
        r.add_mapping(OscMapping {
            address: "/jitter".into(),
            destination: MappingDestination::Handler { name: "j".into() },
            transform: Transform {
                smooth: 0.5,
                ..Default::default()
            },
            enabled: true,
        })
        .unwrap();
        r.handle_message("/jitter", vec![0.0]);
        r.handle_message("/jitter", vec![1.0]);
        // État initialisé à 0, puis 0.5*0 + 0.5*1 = 0.5
        assert_eq!(r.get_last_value("j"), Some(vec![0.5]));
        r.handle_message("/jitter", vec![1.0]);
        // 0.5*0.5 + 0.5*1 = 0.75
        assert_eq!(r.get_last_value("j"), Some(vec![0.75]));
    }

    // ── Hot-reload pendant run ──

    #[test]
    fn test_mappings_shared_for_hot_reload() {
        let r = recv();
        r.add_handler_mapping("/a", "ha").unwrap();
        // Simule ce que fait le thread socket : handle_message lit
        // les mappings live — pas de clone figé au start()
        r.handle_message("/a", vec![1.0]);
        assert_eq!(r.get_last_value("ha"), Some(vec![1.0]));
        r.remove_mapping("/a");
        r.add_handler_mapping("/b", "hb").unwrap();
        r.handle_message("/a", vec![2.0]);
        r.handle_message("/b", vec![3.0]);
        assert_eq!(r.get_last_value("ha"), Some(vec![1.0])); // inchangé
        assert_eq!(r.get_last_value("hb"), Some(vec![3.0]));
    }

    // ── Stats ──

    #[test]
    fn test_stats() {
        let r = recv();
        r.add_handler_mapping("/x", "h").unwrap();
        r.handle_message("/x", vec![1.0]);
        r.handle_message("/unmapped", vec![1.0]);
        let s = r.stats();
        assert_eq!(s.packets_received, 2);
        assert_eq!(s.messages_matched, 1);
        assert_eq!(s.values_routed, 1);
    }

    // ── CRUD legacy ──

    #[test]
    fn test_osc_receiver_new() {
        let receiver = OscReceiver::new(8001);
        assert_eq!(receiver.port, 8001);
        assert!(!receiver.is_running);
        assert!(receiver.in_enabled());
    }

    #[test]
    fn test_list_and_clear_mappings() {
        let r = recv();
        r.add_handler_mapping("/a", "ha").unwrap();
        r.add_handler_mapping("/b", "hb").unwrap();
        assert_eq!(r.list_mappings().len(), 2);
        r.clear_mappings();
        assert_eq!(r.list_mappings().len(), 0);
    }

    #[test]
    fn test_get_all_values() {
        let r = recv();
        assert_eq!(r.get_all_values().len(), 0);
        r.add_handler_mapping("/x", "h").unwrap();
        r.handle_message("/x", vec![1.0, 2.0]);
        let all = r.get_all_values();
        assert_eq!(all.get("h"), Some(&vec![1.0, 2.0]));
    }

    // ── Borne sur les index d'objet (anti wildcard-storm) ──

    #[test]
    fn test_out_of_range_object_index_rejected() {
        let r = recv();
        let channels: Arc<RwLock<HashMap<usize, SpatialChannels>>> =
            Arc::new(RwLock::new(HashMap::new()));
        let positions: Arc<RwLock<HashMap<usize, [f64; 3]>>> =
            Arc::new(RwLock::new(HashMap::new()));
        r.set_targets(OscInTargets {
            object_channels: Some(channels.clone()),
            manual_positions: Some(positions.clone()),
            ..Default::default()
        });
        r.add_mapping(channel_mapping(
            "/track/*/gain",
            SpatialChannel::Gain,
            ObjectRef::Wildcard("*".into()),
        ))
        .unwrap();
        r.add_mapping(OscMapping {
            address: "/obj/*/pos".into(),
            destination: MappingDestination::Position {
                object: ObjectRef::Wildcard("*".into()),
            },
            transform: Transform::default(),
            enabled: true,
        })
        .unwrap();

        // Index >= MAX_OBJECTS (1024) → rejeté, les maps ne grossissent pas
        r.handle_message("/track/5000/gain", vec![0.8]);
        r.handle_message("/obj/99999/pos", vec![1.0, 2.0, 3.0]);
        assert!(channels.read().unwrap().is_empty());
        assert!(positions.read().unwrap().is_empty());
        assert_eq!(r.stats().values_routed, 0);

        // Index valide → routé
        r.handle_message("/track/3/gain", vec![0.8]);
        r.handle_message("/obj/7/pos", vec![1.0, 2.0, 3.0]);
        assert_eq!(
            channels.read().unwrap().get(&3).and_then(|c| c.gain),
            Some(0.8)
        );
        assert_eq!(positions.read().unwrap().get(&7), Some(&[1.0, 2.0, 3.0]));
        assert_eq!(r.stats().values_routed, 2);
    }

    #[test]
    fn test_max_objects_configurable() {
        let r = recv();
        assert_eq!(r.max_objects(), MAX_OBJECTS);
        let channels: Arc<RwLock<HashMap<usize, SpatialChannels>>> =
            Arc::new(RwLock::new(HashMap::new()));
        r.set_targets(OscInTargets {
            object_channels: Some(channels.clone()),
            ..Default::default()
        });
        r.add_mapping(channel_mapping(
            "/track/*/gain",
            SpatialChannel::Gain,
            ObjectRef::Wildcard("*".into()),
        ))
        .unwrap();
        r.set_max_objects(8);
        assert_eq!(r.max_objects(), 8);
        r.handle_message("/track/9/gain", vec![0.5]);
        assert!(channels.read().unwrap().is_empty());
        r.handle_message("/track/7/gain", vec![0.5]);
        assert_eq!(
            channels.read().unwrap().get(&7).and_then(|c| c.gain),
            Some(0.5)
        );
    }

    // ── Borne mémoire sur le feedback ──

    #[test]
    fn test_last_values_capped() {
        let r = recv();
        r.add_handler_mapping("/x", "h").unwrap();
        {
            let mut lv = r.shared.last_values.lock().unwrap();
            // Pré-remplit à la cap, en gardant "h" pour tester l'update
            lv.insert("h".to_string(), vec![0.0]);
            for i in 0..MAX_FEEDBACK_KEYS - 1 {
                lv.insert(format!("k{i}"), vec![0.0]);
            }
        }
        // Clé existante mise à jour malgré la cap atteinte
        r.handle_message("/x", vec![1.0]);
        assert_eq!(r.get_last_value("h"), Some(vec![1.0]));
        assert_eq!(r.get_all_values().len(), MAX_FEEDBACK_KEYS);
        // Nouvelle clé rejetée au-delà de la cap
        r.add_handler_mapping("/y", "h2").unwrap();
        r.handle_message("/y", vec![2.0]);
        assert!(r.get_last_value("h2").is_none());
        assert_eq!(r.get_all_values().len(), MAX_FEEDBACK_KEYS);
    }

    // ── Bundle depth limit ──

    fn nested_bundle(depth: usize, leaf: OscPacket) -> OscPacket {
        let mut p = leaf;
        for _ in 0..depth {
            p = OscPacket::Bundle(rosc::OscBundle {
                timetag: rosc::OscTime {
                    seconds: 0,
                    fractional: 1,
                },
                content: vec![p],
            });
        }
        p
    }

    #[test]
    fn test_bundle_depth_limit() {
        let r = recv();
        r.add_handler_mapping("/x", "h").unwrap();
        let shared = r.shared.clone();

        // Bundle de 2 niveaux → le message interne est dispatché
        let ok = nested_bundle(
            2,
            OscPacket::Message(rosc::OscMessage {
                addr: "/x".to_string(),
                args: vec![OscType::Float(0.5)],
            }),
        );
        handle_packet(ok, &shared, 0, "127.0.0.1:1".parse().unwrap());
        assert_eq!(r.get_last_value("h"), Some(vec![0.5]));

        // Bundle imbriqué > MAX_BUNDLE_DEPTH → droppé, pas de stack overflow
        let deep = nested_bundle(
            MAX_BUNDLE_DEPTH + 4,
            OscPacket::Message(rosc::OscMessage {
                addr: "/x".to_string(),
                args: vec![OscType::Float(9.9)],
            }),
        );
        handle_packet(deep, &shared, 0, "127.0.0.1:1".parse().unwrap());
        assert_eq!(r.get_last_value("h"), Some(vec![0.5])); // inchangé
        assert!(r.stats().messages_dropped >= 1);
    }

    // ── Vrai socket UDP (couverture réelle du pipeline recv) ──

    fn send_udp(addr: &str, args: Vec<OscType>, port: u16) {
        let sock = UdpSocket::bind("127.0.0.1:0").unwrap();
        let pkt = OscPacket::Message(rosc::OscMessage {
            addr: addr.to_string(),
            args,
        });
        let bytes = rosc::encoder::encode(&pkt).unwrap();
        sock.send_to(&bytes, ("127.0.0.1", port)).unwrap();
    }

    fn wait_until(cond: impl Fn() -> bool) -> bool {
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if cond() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        false
    }

    #[test]
    fn test_real_socket_udp_routing() {
        let mut r = OscReceiver::new(0); // port éphémère
        r.add_handler_mapping("/test/fader", "f").unwrap();
        let macros = Arc::new(MacroState::new());
        let channels: Arc<RwLock<HashMap<usize, SpatialChannels>>> =
            Arc::new(RwLock::new(HashMap::new()));
        r.set_targets(OscInTargets {
            macros: Some(macros.clone()),
            object_channels: Some(channels.clone()),
            ..Default::default()
        });
        r.add_mapping(OscMapping {
            address: "/ctl/scale".into(),
            destination: MappingDestination::Macro {
                name: MacroTarget::Scale,
            },
            transform: Transform::default(),
            enabled: true,
        })
        .unwrap();
        r.add_mapping(channel_mapping(
            "/track/*/gain",
            SpatialChannel::Gain,
            ObjectRef::Wildcard("*".into()),
        ))
        .unwrap();

        r.start().unwrap();
        assert!(r.is_alive());
        let port = r.port;
        assert_ne!(port, 0, "port éphémère non résolu");

        send_udp("/test/fader", vec![OscType::Float(0.5)], port);
        send_udp("/ctl/scale", vec![OscType::Float(1.5)], port);
        send_udp("/track/3/gain", vec![OscType::Float(0.8)], port);

        assert!(wait_until(|| r.get_last_value("f").is_some()));
        assert_eq!(r.get_last_value("f"), Some(vec![0.5]));

        assert!(wait_until(|| {
            f64::from_bits(macros.scale.load(Ordering::Relaxed)) == 1.5
        }));
        // 0.8 n'est pas représentable en f32 — la valeur routée est
        // 0.8f32 as f64 ≈ 0.8000000119, jamais égale à 0.8f64 exactement.
        assert!(wait_until(|| {
            channels
                .read()
                .unwrap()
                .get(&3)
                .and_then(|c| c.gain)
                .is_some_and(|g| (g - 0.8).abs() < 1e-6)
        }));

        let s = r.stats();
        assert!(s.packets_received >= 3);
        assert_eq!(s.decode_errors, 0);
        r.stop();
        assert!(!r.is_alive());
    }

    #[test]
    fn test_double_start_error_and_restart() {
        let mut r = OscReceiver::new(0);
        r.start().unwrap();
        assert!(r.is_running);
        assert!(r.is_alive());
        // Double-start → erreur explicite
        assert!(r.start().is_err());
        r.stop();
        assert!(!r.is_running);
        assert!(!r.is_alive());
        // Restart propre après stop
        r.start().unwrap();
        assert!(r.is_running);
        assert!(r.is_alive());
        r.stop();
    }

    #[test]
    fn test_decode_errors_counted() {
        let mut r = OscReceiver::new(0);
        r.start().unwrap();
        let sock = UdpSocket::bind("127.0.0.1:0").unwrap();
        // Datagram non-OSC → erreur de décodage comptée (pas de drop silencieux)
        sock.send_to(b"definitely not an osc packet", ("127.0.0.1", r.port))
            .unwrap();
        assert!(wait_until(|| r.stats().decode_errors >= 1));
        r.stop();
    }
}

#[cfg(test)]
mod show_control_tests {
    use super::*;
    use std::sync::mpsc;

    /// Construit un receiver + récupère les commandes via un channel
    /// branché au show_sink.
    fn make() -> (
        OscReceiver,
        mpsc::Receiver<(ShowCommand, std::net::SocketAddr)>,
    ) {
        let r = OscReceiver::new(0);
        let (tx, rx) = mpsc::channel();
        r.set_show_sink(move |cmd, addr| {
            let _ = tx.send((cmd, addr));
        });
        (r, rx)
    }

    fn msg(addr: &str, args: Vec<OscType>) -> OscPacket {
        OscPacket::Message(OscMessage {
            addr: addr.to_string(),
            args,
        })
    }

    #[test]
    fn parses_every_command() {
        let fps = 25.0;
        let cases: Vec<(&str, Vec<OscType>, ShowCommand)> = vec![
            ("/stagespace/go", vec![], ShowCommand::Go),
            ("/stagespace/cue/next", vec![], ShowCommand::CueNext),
            ("/stagespace/cue/prev", vec![], ShowCommand::CuePrev),
            (
                "/stagespace/cue/recall",
                vec![OscType::Int(3)],
                ShowCommand::CueRecall("3".into(), None),
            ),
            (
                "/stagespace/cue/recall",
                vec![OscType::String("2".into()), OscType::Float(1.5)],
                ShowCommand::CueRecall("2".into(), Some(1.5)),
            ),
            (
                "/stagespace/slot",
                vec![OscType::Int(3)],
                ShowCommand::Slot(3),
            ),
            (
                "/stagespace/slot/stop",
                vec![OscType::Int(3)],
                ShowCommand::SlotStop(3),
            ),
            (
                "/stagespace/solo",
                vec![OscType::String("2".into())],
                ShowCommand::Solo(2),
            ),
            ("/stagespace/arm", vec![], ShowCommand::Arm),
            ("/stagespace/disarm", vec![], ShowCommand::Disarm),
            ("/stagespace/status", vec![], ShowCommand::Status),
            ("/stagespace/panic", vec![], ShowCommand::Panic),
            ("/stagespace/stop", vec![], ShowCommand::Stop),
            (
                "/stagespace/park",
                vec![OscType::Int(3)],
                ShowCommand::Park(3),
            ),
            (
                "/stagespace/park",
                vec![OscType::String("7".into())],
                ShowCommand::Park(7),
            ),
            (
                "/stagespace/unpark",
                vec![OscType::Int(3)],
                ShowCommand::Unpark(3),
            ),
            (
                "/stagespace/timecode",
                vec![OscType::Float(12.5)],
                ShowCommand::Timecode(12.5),
            ),
            (
                "/stagespace/timecode",
                vec![OscType::String("00:00:01:10".into())],
                ShowCommand::Timecode(1.0 + 10.0 / 25.0),
            ),
        ];
        for (addr, args, expected) in cases {
            let got = parse_show_command(addr, &args, fps)
                .unwrap_or_else(|| panic!("{addr} should parse"));
            assert_eq!(
                std::mem::discriminant(&got),
                std::mem::discriminant(&expected),
                "{addr}"
            );
            if let (ShowCommand::Timecode(a), ShowCommand::Timecode(b)) = (&got, &expected) {
                assert!((a - b).abs() < 1e-9, "{addr}: {a} != {b}");
            }
        }
        // Inconnue → None.
        assert!(parse_show_command("/stagespace/bogus", &[], fps).is_none());
        assert!(parse_show_command("/other/go", &[], fps).is_none());
    }

    #[test]
    fn stagespace_prefix_never_reaches_mappings() {
        let (r, rx) = make();
        let src: std::net::SocketAddr = "127.0.0.1:9999".parse().unwrap();
        let shared = r.shared.clone();
        // Un mapping greedy qui aurait capturé l'adresse.
        handle_packet(msg("/stagespace/go", vec![]), &shared, 0, src);
        let (cmd, _src) = rx.try_recv().expect("command should arrive");
        assert!(matches!(cmd, ShowCommand::Go));
        // Rien dans last_by_address ni dans les valeurs routées.
        assert!(!shared
            .last_by_address
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key("/stagespace/go"));
    }

    #[test]
    fn bundle_and_suppress_still_reach_show_control() {
        let (r, rx) = make();
        let src: std::net::SocketAddr = "127.0.0.1:9998".parse().unwrap();
        r.suppress_ms(100_000);
        let bundle = OscPacket::Bundle(rosc::OscBundle {
            timetag: (0, 0).into(),
            content: vec![
                msg("/stagespace/panic", vec![]),
                msg("/stagespace/cue/recall", vec![OscType::Int(2)]),
            ],
        });
        handle_packet(bundle, &r.shared, 0, src);
        assert!(matches!(rx.try_recv().unwrap().0, ShowCommand::Panic));
        assert!(matches!(rx.try_recv().unwrap().0, ShowCommand::CueRecall(ref s, _) if s == "2"));
    }

    #[test]
    fn ack_goes_back_to_sender() {
        // Pair de sockets : receiver sur port 0, client envoie et lit l'ack.
        let mut r = OscReceiver::new(0);
        r.start().unwrap();
        let client = UdpSocket::bind("127.0.0.1:0").unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let pkt = encode(&msg("/stagespace/panic", vec![])).unwrap();
        client.send_to(&pkt, ("127.0.0.1", r.port)).unwrap();
        let mut buf = [0u8; 2048];
        let (len, _) = client.recv_from(&mut buf).expect("ack expected");
        let (_, packet) = decode_udp(&buf[..len]).unwrap();
        match packet {
            OscPacket::Message(m) => {
                assert_eq!(m.addr, "/stagespace/ack");
                assert_eq!(m.args, vec![OscType::String("/stagespace/panic".into())]);
            }
            _ => panic!("expected message"),
        }
        r.stop();
    }
}
