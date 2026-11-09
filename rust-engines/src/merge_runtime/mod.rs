//! MergeRuntime — thread unique qui merge les positions de tous les workers,
//! applique les macros spatiales (scale, rotation, shift, radius_scale, height_offset, depth),
//! et envoie l'OSC.
//!
//! Architecture hybride :
//! - Workers (Runtime existants) : évaluent f(t,i) en parallèle, écrivent dans PositionBuffer
//! - MergeRuntime (ce fichier) : lit tous les buffers, merge, post-process, OSC
//!
//! Le MergeRuntime ne gère PAS :
//! - speed (per-move, dans les workers)
//! - loop_mode, direction (per-move, dans les workers)
//! - phase_offset (per-move, dans les workers)
//! - fade in/out du cycle (per-move, dans les workers)
//!
//! Le MergeRuntime gère :
//! - Merge : résoudre les conflits quand plusieurs moves ciblent le même track
//! - Macros spatiales : scale, rotation, shift, radius_scale, height_offset (globales)
//! - Depth : per-track (appliqué post-merge)
//! - Origin : isobarycentre des tracks
//! - OSC output : une seule socket
//! - Callback : un seul event Tauri pour le 3D preview

mod helpers;
mod move_state;
#[cfg(test)]
mod tests;
mod loop_core;
mod transition;

pub use helpers::{default_post_process_fn, merge_positions, MoveEntry};
pub use move_state::{MergeStrategy, MoveState};

use crate::audio::AudioState;
use crate::kinematics::{apply_modulations, ChannelModulation, KinematicState};
use crate::osc_sender::{OscSender, SpatialChannels};
use crate::position_buffer::PositionBuffer;
use crate::runtime::{
    MacroState, PerfMonitor, PerfStats, PositionCallback, PostProcessContext, PostProcessFn,
};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

/// Callback de position partageable — `Arc` (pas `Box`) pour que le merge
/// thread puisse cloner le handle sous un lock très court puis appeler le
/// callback HORS du lock.
type SharedPositionCallback = Arc<dyn Fn(f64, Vec<(usize, nalgebra::Vector3<f64>)>) + Send + Sync>;

/// Canal vers le pump thread de preview — `SyncSender` borné : le merge
/// `try_send` et droppe la frame si le pump est occupé à sérialiser
/// (audit I10 — l'emit Tauri fait ~60 Ko/s de JSON par frame à 1024
/// objets ; hors du thread temps réel, le merge ne paie qu'un move).
type PreviewSender = std::sync::mpsc::SyncSender<(f64, Vec<(usize, nalgebra::Vector3<f64>)>)>;

/// Sink de sortie partagé avec le merge thread — `set_sink`/`set_osc_target`
/// en cours de route swappe le transport atomiquement sous un seul lock.
///
/// Avant, la socket était `try_clone`'d une fois au `start()` — un
/// `set_osc_target` en cours de route swapait le sender mais laissait la
/// socket figée → nouveau profil envoyé à l'ancienne destination.
type SharedSink = Arc<Mutex<Box<dyn crate::position_sink::PositionSink>>>;

/// Positions des tracks .hol partagées en copy-on-write : les writers
/// remplacent l'Arc interne, les readers clonent l'Arc (snapshot cheap).
type SharedTrackPositions = Arc<RwLock<Arc<HashMap<u32, [f64; 3]>>>>;

pub type TrajectorySamples = Vec<(f64, f64, f64, f64)>;

/// Chronomètre l'acquisition d'un lock du hot-path (attente de contention —
/// le temps passé SOUS le guard n'est pas compté). `$acq` doit évaluer au
/// guard/handle ; les nanosecondes d'attente sont cumulées dans `$wait`
/// (total par frame → `PerfStats.merge_lock_us`) et, quand le profiling par
/// site est activé (`STAGESPACE_LOCK_PROF=1`), dans `$sites` pour un dump
/// périodique sur stderr. Pour les `PositionBuffer` (lock interne), on
/// chronomètre l'appel entier — la copie sous lock est ~ns, donc la mesure
/// reste essentiellement de l'attente.
macro_rules! timed_lock {
    ($wait:ident, $sites:ident, $profiling:expr, $site:literal, $acq:expr) => {{
        let __lock_start = Instant::now();
        let __guard = $acq;
        let __ns = __lock_start.elapsed().as_nanos() as u64;
        $wait += __ns;
        if $profiling {
            *$sites.entry($site).or_insert(0) += __ns;
        }
        __guard
    }};
}

// macro_rules! n'est pas visible aux sous-modules par `use super::*` sans
// re-export — les impl blocks dans loop_core/… l'utilisent dans la boucle.
pub(crate) use timed_lock;

/// Nombre de frames de merge consécutives sans write du worker avant de
/// considérer le move zombie (worker mort/fini) et le retirer du merge.
/// ~0.5 s à 60 FPS.
const STALE_FRAME_LIMIT: u32 = 30;

/// Grace plus longue pour un move qui n'a JAMAIS écrit encore (worker
/// fraîchement spawné : compile + premier frame peuvent dépasser 0.5 s
/// sur machine chargée). Sans ça le merge retire un move avant même sa
/// première émission. ~5 s à 60 FPS.
const FRESH_STALE_FRAME_LIMIT: u32 = 300;

/// Seuil de retard (en frames) au-delà duquel on ré-ancre `frame_count`
/// sur le temps réel au lieu de burst des frames obsolètes.
const CATCHUP_FRAME_LIMIT: u128 = 30;

/// Runtime global qui merge les positions de tous les workers.
///
/// Une seule thread, une seule socket OSC. Lit les PositionBuffers de tous les
/// moves actifs, merge les positions, applique les macros spatiales, envoie l'OSC.
/// (scale, offset, yaw) — transform venue appliqué au payload OSC uniquement.
type VenueMap = ([f64; 3], [f64; 3], f64);
/// Frame de tape : (temps, positions canoniques par objet).
type TapeFrame = (f64, HashMap<usize, [f64; 3]>);
/// État du replay tape : (départ, frames, index courant).
type TapePlayState = (Instant, Vec<TapeFrame>, usize);

pub struct MergeRuntime {
    thread: Option<std::thread::JoinHandle<()>>,
    running: Arc<AtomicBool>,
    /// Master arm (« OSC LIVE ») — gate sur le chemin d'envoi du sink.
    osc_armed: Arc<AtomicBool>,
    /// Vrai si le merge thread est mort d'un panic contenu (catch_unwind).
    /// Observable : sans lui, un panic tuait le thread pendant que
    /// `running` restait true → blackout OSC silencieux.
    thread_died: Arc<AtomicBool>,
    /// Compteur de frames mergées — liveness observable du merge thread
    /// (incrémenté à chaque itération de la boucle, y compris idle).
    merge_frames: Arc<AtomicU64>,
    /// Total de positions non-finies (NaN/inf) droppées avant l'envoi OSC.
    dropped_positions: Arc<AtomicU64>,
    /// Buffers par move ID
    move_buffers: Arc<RwLock<HashMap<String, Arc<PositionBuffer>>>>,
    /// États des moves actifs
    active_moves: Arc<RwLock<HashMap<String, MoveState>>>,
    /// Macros spatiales (scale, rotation, shift, radius_scale, height_offset)
    /// PAS speed — speed reste per-move dans les workers
    macros: Arc<MacroState>,
    /// Audio state partagé (pour les audio mods qui agissent sur les macros spatiales)
    audio_state: Arc<Mutex<AudioState>>,
    /// Origin = isobarycentre des tracks
    origin: Arc<Mutex<nalgebra::Vector3<f64>>>,
    /// OSC ids globaux (tracks sélectionnées) — Arc<Vec> : snapshot par
    /// frame = clone d'Arc au lieu de copier le Vec.
    osc_ids: Arc<RwLock<Arc<Vec<u32>>>>,
    /// Profondeur par track (per-track depth) — snapshot Arc par frame
    track_depths: Arc<RwLock<Arc<Vec<f64>>>>,
    /// Stratégie de merge
    merge_strategy: Arc<RwLock<MergeStrategy>>,
    /// Performance monitor global
    perf: Arc<PerfMonitor>,
    /// Canal borné vers le pump thread qui invoque le callback de position
    /// (un seul event pour le 3D preview). La sérialisation JSON de l'emit
    /// Tauri se fait là-bas, pas sur le thread merge.
    position_callback: Arc<Mutex<Option<PreviewSender>>>,
    /// Sink de sortie (OSC par défaut, tout PositionSink injectable)
    sink: SharedSink,
    /// FPS cible
    fps: f64,
    /// Fonction de post-processing (graph global) — hot-swappable
    post_process_fn: Arc<RwLock<Arc<PostProcessFn>>>,
    /// Positions des tracks .hol (pour Barycenter) — track_id → [x, y, z]
    /// Arc<HashMap> : snapshot par frame = clone d'Arc.
    track_positions: SharedTrackPositions,
    /// Positions manuelles (pour ManualPosition) — object_index → [x, y, z]
    /// Type figé par `OscInTargets` (osc_receiver) — clone par frame.
    manual_positions: Arc<RwLock<HashMap<usize, [f64; 3]>>>,
    /// Canaux spatiaux étendus par objet (gain, spread, distance, presence,
    /// yaw, aperture, lfe) — object_index → SpatialChannels.
    /// Type figé par `OscInTargets` (osc_receiver).
    object_channels: Arc<RwLock<HashMap<usize, SpatialChannels>>>,
    /// Objets « parkés » — les recalls de cues (Full et Tracking) n'écrivent
    /// jamais leurs canaux : la reprise manuelle d'un opérateur a priorité
    /// sur la mémoire enregistrée (sémantique Park des consoles).
    parked_objects: Arc<RwLock<HashSet<usize>>>,
    /// End-mode par move (Revert | Hold) — posé au register_move, lu au
    /// retrait : Hold écrit la dernière position en manual_positions.
    move_end_modes: Arc<RwLock<HashMap<String, crate::EndMode>>>,
    /// Dernières positions monde émises par objet — source des ancres
    /// `AnchorMode::Current` au spawn du move suivant.
    last_out_positions: Arc<RwLock<HashMap<usize, [f64; 3]>>>,
    /// Derniers canaux spatiaux effectifs calculés par objet (statiques ⊕
    /// modulés ⊕ zones) — readback opérateur : rend l'effet des FX visible
    /// sans écouter le rendu (audit : les réglages semblaient inertes).
    last_effective_channels: Arc<RwLock<HashMap<usize, SpatialChannels>>>,
    /// Positions canoniques pré-post-process (merged ∪ manual — manual
    /// gagne, comme le post-process). Graine des anchors/freeze/throw :
    /// seed depuis last_out (post-macro) provoquerait un double-transform.
    last_canonical_positions: Arc<RwLock<HashMap<usize, [f64; 3]>>>,
    /// Objets dont la position manuelle vient d'un hold de fin de move
    /// (end_mode=Hold) — distingue "tenu par la mémoire" de "reprise
    /// opérateur" dans la source-de-contrôle.
    held_objects: Arc<RwLock<HashSet<usize>>>,
    /// Objets pilotés par flux PSN — posés par set_psn_config, lus pour
    /// la source-de-contrôle (PSN > manuel dans la priorité).
    psn_objects: Arc<RwLock<HashSet<usize>>>,
    /// Auto-venue : (scale, offset) appliqués UNIQUEMENT au payload OSC
    /// — l'espace interne reste canonique (anchors, zones, kinematics,
    /// last_out). None = passthrough.
    venue_map: Arc<RwLock<Option<VenueMap>>>,
    /// Vu-mètre perceptuel — calculé par frame depuis les vraies
    /// positions : vitesse angulaire perçue (legibility MAMA °/s),
    /// looming (vitesse radiale d'approche m/s), vection (cohérence
    /// rotationnelle du champ 0..1).
    perceptual: Arc<RwLock<PerceptualMetrics>>,
    /// Couche réalité-distance (Zahorik : distance perçue compressée
    /// ~×0.7) — exagération géométrique + couplage distance→canaux
    /// (gain 1/(1+a·r), presence e^(-air·r) air-EQ, distance=r DRR).
    /// None = désactivé.
    distance_reality: Arc<RwLock<Option<(f64, f64, f64)>>>,
    /// Objets "lancés" (grab & throw) : obj_index → vélocité m/s.
    /// Le frame loop intègre pos += v·dt avec amortissement ; quand
    /// |v| < eps l'objet devient une position manuelle au repos.
    thrown: Arc<RwLock<HashMap<usize, [f64; 3]>>>,
    /// Dynamique spatiale — le "compresseur spatial" : scalaire global
    /// appliqué au payload OSC (1.0 = neutre, <1 resserre le champ vers
    /// l'origine, >1 l'étend). Geste live, pas un setup.
    spatial_compression: Arc<RwLock<f64>>,
    /// Position stream tape — enregistre les positions émises à ~30Hz
    /// (t, {obj: pos}) pour replay vers un renderer externe (bounce
    /// binaural côté renderer — STAGESPACE ne rend pas l'audio).
    tape_recording: Arc<std::sync::atomic::AtomicBool>,
    pos_tape: Arc<RwLock<Vec<TapeFrame>>>,
    /// Replay : (start, entries, curseur) — injecté en positions
    /// manuelles par le frame loop au rythme réel.
    tape_play: Arc<RwLock<Option<TapePlayState>>>,

    /// Attention orchestration — objets figés par `attention_focus`
    /// (stase pour le change blindness : un seul objet bouge). Le set
    /// distingue les figés de la feature des positions manuelles de
    /// l'opérateur — clear ne touche que les nôtres.
    attention_frozen: Arc<RwLock<HashSet<usize>>>,
    /// Règles de modulation cinématique (source cinématique → canal spatial)
    /// — Arc<Vec> : snapshot par frame = clone d'Arc.
    channel_modulations: Arc<RwLock<Arc<Vec<ChannelModulation>>>>,
    /// Coefficient de lissage des mesures cinématiques [0, 1)
    kinematic_smoothing: Arc<RwLock<f64>>,
    /// Zones d'effets spatiaux (P4) — blend des canaux selon la position
    zones: Arc<RwLock<Arc<Vec<crate::zones::Zone>>>>,
    /// Zones déclarées dans le graph global (nodes `Zone`) — remplacées
    /// en bloc à chaque `update_global_graph`, évaluées avant les zones
    /// manuelles (qui gardent le dernier mot sur le blend).
    graph_zones: Arc<RwLock<Arc<Vec<crate::zones::Zone>>>>,
    /// Modulations déclarées dans le graph global (nodes `Velocity`) —
    /// évaluées avant les règles manuelles (priorité aux manuelles).
    graph_modulations: Arc<RwLock<Arc<Vec<ChannelModulation>>>>,
    /// Node `Barycenter` du graph global : l'origin passée au ctx est
    /// recalculée chaque frame = isobarycentre des `track_positions`
    /// (audit T2 — le node était un no-op silencieux).
    /// Node `MoveRef` avec `move_id` non vide : la chaîne post-process ne
    /// reçoit que les positions de ce move au lieu du merge complet
    /// (audit T2 — le param était décoratif).
    move_ref_id: Arc<RwLock<Option<String>>>,
    /// Moves retirés pour worker stale (audit C5) — le merge ne peut pas
    /// arrêter le worker lui-même (le `Runtime` vit dans la couche
    /// commands Tauri) ; il publie `(id, Arc<PositionBuffer>)` ici et le
    /// superviseur backend draine la file pour `runtime.stop()` +
    /// nettoyage `movements`. L'Arc permet au superviseur un test
    /// `ptr_eq` : si l'id a été réutilisé par un move plus récent, son
    /// buffer diffère → on ne tue pas le nouveau move. Sans ce mécanisme
    /// un worker zombie tournait à 100 % CPU indéfiniment.
    stale_kill_ids: StaleKillQueue,
    /// Graph de modulation compilé (domaine signal) — produit des DELTAS
    /// de macros par frame, appliqués de façon additive sur un clone
    /// effectif des macros (la base panel/OSC/cue n'est jamais écrasée).
    /// Mutex (pas RwLock) : `SignalFn` est `FnMut` — les nodes à état
    /// mutent à chaque eval. Hot-swappable via `update_signal_graph`.
    signal_fn: Arc<Mutex<crate::signal_compiler::SignalFn>>,
    /// Transition de recall en cours — arbre de layers (Live/Frozen/Blend)
    /// crossfadant tout l'output post-merge : post-process, macros,
    /// positions manuelles, depths, canaux, zones, modulations. `Live`
    /// hors transition = chemin à coût nul inchangé.
    output_layer: Arc<Mutex<transition::Layer>>,
    /// Dernières valeurs OSC reçues (`OscReceiver::address_values_handle`)
    /// — source des nodes `SignalOsc`. L'Arc interne est re-pointé via
    /// `set_osc_values_handle` quand le receiver est recréé (rebind port).
    /// Vide tant que le receiver n'est pas branché (les nodes lisent 0.0).
    osc_values: crate::signal_compiler::SignalOscSource,
}

/// Entrée de la file stale-kill (audit C5) : id du move + Arc du
/// PositionBuffer observé gelé — l'Arc sert de preuve d'identité
/// (`ptr_eq`) pour ne pas tuer un move réutilisant le même id.
pub type StaleKill = (String, Arc<PositionBuffer>);
/// File partagée merge → superviseur backend.
type StaleKillQueue = Arc<Mutex<Vec<StaleKill>>>;

/// Vu-mètre perceptuel — un objet qui dépasse ~5°/s de vitesse
/// angulaire devient flou (MAMA/localization blur) ; un objet qui
/// s'approche rapidement est l'accent émotionnel #1 (looming) ; un
/// champ qui tourne en bloc induit l'auto-mouvement (vection).
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct PerceptualMetrics {
    /// Vitesse angulaire perçue par objet (°/s) — >5°/s = illisible.
    pub legibility_deg_s: std::collections::HashMap<usize, f64>,
    /// Pire vitesse d'approche vers l'origine (m/s, 0 = aucune).
    pub looming_ms: f64,
    /// Fraction des objets en mouvement tournant dans le même sens
    /// autour du centre (0..1) — >0.7 = risque vection.
    pub vection: f64,
}

impl MergeRuntime {
    /// Crée un nouveau MergeRuntime
    pub fn new(
        osc_address: String,
        osc_port: u16,
        osc_sender: OscSender,
        fps: f64,
    ) -> crate::error::Result<Self> {
        Self::new_with_audio_state(
            osc_address,
            osc_port,
            osc_sender,
            fps,
            Arc::new(Mutex::new(AudioState::new())),
        )
    }

    /// MergeRuntime partageant l'`AudioState` de l'app — même Arc que les
    /// workers : les nodes audio du graph global voient l'état à jour sans
    /// propagation par polling.
    pub fn new_with_audio_state(
        osc_address: String,
        osc_port: u16,
        osc_sender: OscSender,
        fps: f64,
        audio_state: Arc<Mutex<AudioState>>,
    ) -> crate::error::Result<Self> {
        let osc_sink = crate::position_sink::OscSink::connect(&osc_address, osc_port, osc_sender)
            .map_err(crate::error::StagespaceError::NetworkError)?;

        Ok(MergeRuntime {
            thread: None,
            running: Arc::new(AtomicBool::new(false)),
            osc_armed: Arc::new(AtomicBool::new(true)),
            thread_died: Arc::new(AtomicBool::new(false)),
            merge_frames: Arc::new(AtomicU64::new(0)),
            dropped_positions: Arc::new(AtomicU64::new(0)),
            move_buffers: Arc::new(RwLock::new(HashMap::new())),
            active_moves: Arc::new(RwLock::new(HashMap::new())),
            macros: Arc::new(MacroState::new()),
            audio_state,
            origin: Arc::new(Mutex::new(nalgebra::Vector3::zeros())),
            osc_ids: Arc::new(RwLock::new(Arc::new(Vec::new()))),
            track_depths: Arc::new(RwLock::new(Arc::new(Vec::new()))),
            merge_strategy: Arc::new(RwLock::new(MergeStrategy::Override)),
            perf: Arc::new(PerfMonitor::new()),
            position_callback: Arc::new(Mutex::new(None)),
            sink: Arc::new(Mutex::new(Box::new(osc_sink))),
            fps,
            post_process_fn: Arc::new(RwLock::new(Arc::new(default_post_process_fn()))),
            track_positions: Arc::new(RwLock::new(Arc::new(HashMap::new()))),
            manual_positions: Arc::new(RwLock::new(HashMap::new())),
            object_channels: Arc::new(RwLock::new(HashMap::new())),
            parked_objects: Arc::new(RwLock::new(HashSet::new())),
            move_end_modes: Arc::new(RwLock::new(HashMap::new())),
            last_out_positions: Arc::new(RwLock::new(HashMap::new())),
            last_effective_channels: Arc::new(RwLock::new(HashMap::new())),
            last_canonical_positions: Arc::new(RwLock::new(HashMap::new())),
            held_objects: Arc::new(RwLock::new(HashSet::new())),
            psn_objects: Arc::new(RwLock::new(HashSet::new())),
            venue_map: Arc::new(RwLock::new(None)),
            perceptual: Arc::new(RwLock::new(PerceptualMetrics::default())),
            distance_reality: Arc::new(RwLock::new(None)),
            thrown: Arc::new(RwLock::new(HashMap::new())),
            spatial_compression: Arc::new(RwLock::new(1.0)),
            attention_frozen: Arc::new(RwLock::new(HashSet::new())),
            tape_recording: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            pos_tape: Arc::new(RwLock::new(Vec::new())),
            tape_play: Arc::new(RwLock::new(None)),
            channel_modulations: Arc::new(RwLock::new(Arc::new(Vec::new()))),
            kinematic_smoothing: Arc::new(RwLock::new(0.5)),
            zones: Arc::new(RwLock::new(Arc::new(Vec::new()))),
            graph_zones: Arc::new(RwLock::new(Arc::new(Vec::new()))),
            graph_modulations: Arc::new(RwLock::new(Arc::new(Vec::new()))),
            move_ref_id: Arc::new(RwLock::new(None)),
            stale_kill_ids: Arc::new(Mutex::new(Vec::new())),
            signal_fn: Arc::new(Mutex::new(crate::signal_compiler::empty_signal_fn())),
            output_layer: Arc::new(Mutex::new(transition::Layer::Live)),
            osc_values: Arc::new(RwLock::new(Arc::new(Mutex::new(HashMap::new())))),
        })
    }

    /// Définit le callback de position (pour le 3D preview). Le callback
    /// tourne sur un pump thread dédié alimenté par un canal borné à 2
    /// messages : le merge thread ne paie qu'un `try_send` (drop si plein)
    /// au lieu de la sérialisation JSON complète par frame (audit I10).
    /// Réassigner le callback remplace le sender → l'ancien pump voit son
    /// rx déconnecté et sort proprement.
    pub fn set_position_callback(&self, callback: PositionCallback) {
        let cb: SharedPositionCallback = Arc::from(callback);
        let (tx, rx) =
            std::sync::mpsc::sync_channel::<(f64, Vec<(usize, nalgebra::Vector3<f64>)>)>(2);
        std::thread::spawn(move || {
            while let Ok((t, positions)) = rx.recv() {
                cb(t, positions);
            }
        });
        *self
            .position_callback
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(tx);
    }

    /// Reconfigure la destination OSC (adresse + port + sender).
    /// Utile pour les tests CLI où on veut envoyer vers un listener spécifique.
    ///
    /// Sender ET socket sont swappés atomiquement sous le même lock —
    /// le merge thread prend un snapshot par frame, donc un merge en cours
    /// retargete immédiatement (plus de socket figée depuis le `start()`).
    /// Swap le transport de sortie — le merge thread l'utilise dès la
    /// prochaine frame. Seam pour d'autres renderers (MSC/MTC/PSN…) :
    /// injecter n'importe quel `PositionSink` sans toucher la boucle.
    pub fn set_sink(&self, sink: Box<dyn crate::position_sink::PositionSink>) {
        *self.sink.lock().unwrap_or_else(|e| e.into_inner()) = sink;
    }

    /// Master arm — « OSC LIVE » global. `false` = silence total : le merge
    /// continue (preview 3D alive) mais aucun paquet ne part. Indépendant
    /// des flags `is_preview` par move — c'est l'interrupteur master de
    /// la console, pas un réglage de move.
    pub fn set_osc_armed(&self, armed: bool) {
        self.osc_armed.store(armed, Ordering::SeqCst);
    }

    pub fn osc_armed(&self) -> bool {
        self.osc_armed.load(Ordering::SeqCst)
    }

    /// Configure la sortie OSC (sink par défaut). Sender + socket swappés
    /// atomiquement — un `set_osc_target` mid-show retargete au frame tick
    /// suivant, jamais de sender neuf sur ancienne socket.
    pub fn set_osc_target(
        &self,
        osc_address: String,
        osc_port: u16,
        osc_sender: OscSender,
    ) -> crate::error::Result<()> {
        let sink = crate::position_sink::OscSink::connect(&osc_address, osc_port, osc_sender)
            .map_err(crate::error::StagespaceError::NetworkError)?;
        self.set_sink(Box::new(sink));
        Ok(())
    }

    /// Envoie une position immédiate à un track via le sink courant.
    /// Utilisé par le panic/emergency stop — la cible suit `set_osc_target`,
    /// contrairement à un sender capturé au startup qui enverrait toujours
    /// à l'adresse initiale.
    pub fn send_position_now(
        &self,
        osc_id: u32,
        pos: nalgebra::Vector3<f64>,
    ) -> crate::error::Result<()> {
        // Mêmes contrats que la boucle d'envoi : dry-run = rien ne part
        // (panic inclus — un mute qui émet n'est pas un mute), et la
        // position passe par venue_map (sinon le panic envoie du
        // canonique sur une salle adaptée → mauvaise position).
        if !self.osc_armed() {
            return Ok(());
        }
        let send_pos = self
            .venue_map
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .map(|(s, o, yaw)| {
                let (c, sn) = (yaw.cos(), yaw.sin());
                let (x, y) = (pos.x * c - pos.y * sn, pos.x * sn + pos.y * c);
                nalgebra::Vector3::new(x * s[0] + o[0], y * s[1] + o[1], pos.z * s[2] + o[2])
            })
            .unwrap_or(pos);
        let report = self
            .sink
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .send_state(osc_id, send_pos, None);
        if report.sent == 0 && report.errors > 0 {
            return Err(crate::error::StagespaceError::NetworkError(
                std::io::Error::other("position sink send failed"),
            ));
        }
        Ok(())
    }

    /// Définit l'origin (isobarycentre des tracks)
    pub fn set_origin(&self, origin: nalgebra::Vector3<f64>) {
        *self.origin.lock().unwrap_or_else(|e| e.into_inner()) = origin;
    }

    /// Lit l'origin globale courante (pivot des transforms du post-process).
    /// Utilisée comme origin par défaut pour un move qui n'en spécifie pas.
    pub fn origin(&self) -> nalgebra::Vector3<f64> {
        *self.origin.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Définit les OSC ids globaux (tracks sélectionnées)
    pub fn set_osc_ids(&self, osc_ids: Vec<u32>) {
        *self.osc_ids.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(osc_ids);
    }

    /// Récupère les osc_ids globaux actuels
    pub fn osc_ids(&self) -> Vec<u32> {
        let guard = self.osc_ids.read().unwrap_or_else(|e| e.into_inner());
        (**guard).clone()
    }

    /// Recalcule les osc_ids globaux à partir des moves encore actifs.
    ///
    /// Helper de maintenance : aujourd'hui les osc_ids globaux sont pilotés
    /// par le frontend via `set_osc_ids` (ils doivent rester alignés avec
    /// `track_indices`). Conservé pour les chemins qui reparent des tracks
    /// sans repasser par le frontend.
    pub fn rebuild_osc_ids(&self) {
        let moves = self.active_moves.read().unwrap_or_else(|e| e.into_inner());
        let mut ids: Vec<u32> = Vec::new();
        for state in moves.values() {
            for &id in &state.osc_ids {
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
        }
        drop(moves);
        *self.osc_ids.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(ids);
    }

    /// Définit les depths par track
    pub fn set_track_depths(&self, depths: Vec<f64>) {
        *self.track_depths.write().unwrap_or_else(|e| e.into_inner()) = Arc::new(depths);
    }

    /// Depths par track courantes — snapshoté par store_cue (le runtime
    /// détient la vérité, pas le frontend).
    pub fn track_depths(&self) -> Vec<f64> {
        self.track_depths
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .clone()
    }

    /// Définit la stratégie de merge
    pub fn set_merge_strategy(&self, strategy: MergeStrategy) {
        *self
            .merge_strategy
            .write()
            .unwrap_or_else(|e| e.into_inner()) = strategy;
    }

    /// Hot-swap la fonction de post-processing (graph global)
    /// Hot-swap du graph de modulation (domaine signal → deltas de macros).
    /// Le merge l'évalue à chaque frame et applique les deltas de façon
    /// ADDITIVE sur un clone effectif des macros (couche sans conflit —
    /// les écritures directes panel/OSC/cue restent la base).
    pub fn swap_signal_fn(&self, new_fn: crate::signal_compiler::SignalFn) {
        *self.signal_fn.lock().unwrap_or_else(|e| e.into_inner()) = new_fn;
    }

    /// Branche le cache des valeurs OSC reçues (source des nodes
    /// `SignalOsc`) — appelé au démarrage et après chaque rebind du
    /// receiver avec `OscReceiver::address_values_handle()`.
    pub fn set_osc_values_handle(&self, handle: crate::compiler::OscValueMap) {
        *self.osc_values.write().unwrap_or_else(|e| e.into_inner()) = handle;
    }

    /// Évalue la `SignalFn` courante hors boucle — diagnostic/test :
    /// permet de vérifier qu'un recall/hot-swap a bien installé (ou
    /// reset) le graph de modulation sans démarrer le merge.
    pub fn eval_signal_deltas(&self, t: f64, dt: f64) -> HashMap<String, f64> {
        let audio_state = self
            .audio_state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let osc_map = self
            .osc_values
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let osc_vals = osc_map.lock().unwrap_or_else(|e| e.into_inner());
        let mut signal = self.signal_fn.lock().unwrap_or_else(|e| e.into_inner());
        (*signal)(&crate::signal_compiler::SignalCtx {
            t,
            dt,
            audio_state: &audio_state,
            osc_values: &osc_vals,
        })
        .macros
    }

    pub fn swap_post_process_fn(&self, new_fn: PostProcessFn) {
        *self
            .post_process_fn
            .write()
            .unwrap_or_else(|e| e.into_inner()) = Arc::new(new_fn);
    }

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

    /// Snapshot immuable de l'output layer courant — utilisé par
    /// `begin_transition` pour figer le `from` du crossfade.
    fn snapshot_layer(&self) -> transition::OutputLayer {
        transition::OutputLayer {
            post_process_fn: self
                .post_process_fn
                .read()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
            macros: self.macros.snapshot(),
            manual_positions: self
                .manual_positions
                .read()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
            track_depths: (**self.track_depths.read().unwrap_or_else(|e| e.into_inner())).clone(),
            object_channels: self
                .object_channels
                .read()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
            zones: {
                let mut z = (**self.graph_zones.read().unwrap_or_else(|e| e.into_inner())).clone();
                z.extend(
                    self.zones
                        .read()
                        .unwrap_or_else(|e| e.into_inner())
                        .iter()
                        .cloned(),
                );
                z
            },
            modulations: {
                let mut m = (**self
                    .graph_modulations
                    .read()
                    .unwrap_or_else(|e| e.into_inner()))
                .clone();
                m.extend(
                    self.channel_modulations
                        .read()
                        .unwrap_or_else(|e| e.into_inner())
                        .iter()
                        .cloned(),
                );
                m
            },
            origin: *self.origin.lock().unwrap_or_else(|e| e.into_inner()),
        }
    }

    /// Démarre un crossfade de l'output layer : tout ce que le post-merge
    /// lit en dehors des positions mergées (post-process graph, macros,
    /// positions manuelles, depths, canaux, zones, modulations, origin)
    /// est figé en `from` ; les setters suivants écrivent le nouvel état
    /// dans `Live` (= cible). `duration <= 0` → no-op.
    /// GO rapides en chaîne : l'ancienne transition continue à l'intérieur
    /// du nouvel arbre — continuité garantie (pas de saut).
    pub fn begin_transition(&self, duration: f64) {
        if duration <= 0.0 {
            return;
        }
        let frozen = self.snapshot_layer();
        let mut g = self.output_layer.lock().unwrap_or_else(|e| e.into_inner());
        *g = std::mem::replace(&mut *g, transition::Layer::Live).begin(frozen, duration);
    }

    /// Une transition d'output layer est-elle en cours ? (tests / perf).
    pub fn has_active_transition(&self) -> bool {
        !matches!(
            *self.output_layer.lock().unwrap_or_else(|e| e.into_inner()),
            transition::Layer::Live
        )
    }

    /// Récupère les macros (pour modification temps réel — fast path atomic)
    pub fn macros(&self) -> Arc<MacroState> {
        self.macros.clone()
    }

    /// Points de sortie pour le routing OSC IN (P3) — le receiver écrit
    /// directement dans ces Arcs partagés depuis son thread, sans lock
    /// supplémentaire dans le chemin temps réel du merge.
    pub fn osc_in_targets(&self) -> crate::osc_receiver::OscInTargets {
        crate::osc_receiver::OscInTargets {
            macros: Some(self.macros.clone()),
            object_channels: Some(self.object_channels.clone()),
            manual_positions: Some(self.manual_positions.clone()),
        }
    }

    /// Récupère l'Arc de l'audio state (pour mise à jour depuis l'app)
    pub fn audio_state_arc(&self) -> Arc<Mutex<AudioState>> {
        self.audio_state.clone()
    }

    /// Récupère les stats de performance
    pub fn get_perf_stats(&self) -> PerfStats {
        self.perf.get_stats()
    }

    /// Enregistre un move actif avec son buffer
    pub fn register_move(
        &self,
        move_id: String,
        buffer: Arc<PositionBuffer>,
        osc_ids: Vec<u32>,
        track_indices: Vec<usize>,
        is_preview: bool,
        end_mode: crate::EndMode,
    ) {
        let state = MoveState::new(osc_ids, track_indices, is_preview);
        self.active_moves
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(move_id.clone(), state);
        if end_mode == crate::EndMode::Hold {
            self.move_end_modes
                .write()
                .unwrap_or_else(|e| e.into_inner())
                .insert(move_id.clone(), end_mode);
        }
        self.move_buffers
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(move_id, buffer);
    }

    /// Vrai si le move est enregistré ET actif dans le merge (pas stale-killed).
    /// Un worker peut tourner (`runtime.is_running()`) alors que le merge l'a
    /// retiré pour staleness — cette méthode est la source de vérité.
    pub fn has_move(&self, move_id: &str) -> bool {
        self.active_moves
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(move_id)
            .is_some_and(|s| s.is_active)
    }

    /// Vrai si au moins un move est encore actif dans le merge — utilisé
    /// pour décider si un thread mort mérite un respawn automatique.
    pub fn has_active_moves(&self) -> bool {
        self.active_moves
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .any(|s| s.is_active)
    }

    /// Enfile un stale-kill — utilisé par la boucle merge interne.
    /// `#[doc(hidden)]` : exposé pour les tests du superviseur Tauri.
    #[doc(hidden)]
    pub fn enqueue_stale_kill(&self, move_id: String, buffer: Arc<PositionBuffer>) {
        Self::enqueue_stale_kill_into(&self.stale_kill_ids, move_id, buffer);
    }

    fn enqueue_stale_kill_into(
        queue: &StaleKillQueue,
        move_id: String,
        buffer: Arc<PositionBuffer>,
    ) {
        queue
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push((move_id, buffer));
    }

    /// Draine la file des moves retirés pour worker stale (audit C5).
    /// Appelé par le superviseur backend qui détient les `Runtime` des
    /// workers — lui seul peut faire `stop()` + nettoyage `movements`.
    /// L'`Arc<PositionBuffer>` permet un test `ptr_eq` pour ne jamais
    /// tuer un move plus récent ayant réutilisé le même id.
    pub fn drain_stale_kills(&self) -> Vec<StaleKill> {
        std::mem::take(
            &mut *self
                .stale_kill_ids
                .lock()
                .unwrap_or_else(|e| e.into_inner()),
        )
    }

    /// Démarre un fade in pour un move (utilisé au recall pour un crossfade doux)
    pub fn start_fade_in(&self, move_id: &str, fade_duration: f64) {
        if let Some(state) = self
            .active_moves
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .get_mut(move_id)
        {
            state.start_fade_in(fade_duration);
        }
    }

    /// Démarre un fade out pour un move (le move sera retiré quand le fade est terminé)
    pub fn start_fade_out(&self, move_id: &str, fade_duration: f64) {
        if let Some(state) = self
            .active_moves
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .get_mut(move_id)
        {
            state.start_fade_out(fade_duration);
        }
    }

    /// Retire un move du merge (sans fade).
    ///
    /// NOTE: les osc_ids globaux sont gérés par le frontend via set_global_osc_ids.
    // On ne reconstruit plus les osc_ids ici — la liste globale doit rester
    // alignée avec les track_indices (indices dans cette liste).
    pub fn unregister_move(&self, move_id: &str) {
        self.active_moves
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(move_id);
        self.move_end_modes
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(move_id);
        self.move_buffers
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(move_id);
    }

    /// Dernières positions émises par objet (tentées — pas de confirmation
    /// renderer) — le côté "commanded" de la confidence view.
    pub fn emitted_positions(&self) -> HashMap<usize, [f64; 3]> {
        self.last_out_positions
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Canaux spatiaux effectifs calculés par objet (statiques ⊕ modulés ⊕
    /// zones) — readback opérateur pour le panneau FX.
    pub fn effective_channels(&self) -> HashMap<usize, SpatialChannels> {
        self.last_effective_channels
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Position tape : record start/stop (start vide la bande).
    pub fn set_tape_recording(&self, on: bool) {
        if on {
            self.pos_tape
                .write()
                .unwrap_or_else(|e| e.into_inner())
                .clear();
        }
        self.tape_recording
            .store(on, std::sync::atomic::Ordering::Relaxed);
    }

    /// La bande enregistrée (t, {obj: pos}) — export JSON côté IPC.
    pub fn position_tape(&self) -> Vec<(f64, HashMap<usize, [f64; 3]>)> {
        self.pos_tape
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Replay de la bande — injectée en positions manuelles au rythme
    /// réel par le frame loop (timing backend, pas de setTimeout).
    pub fn play_tape(&self, entries: Vec<(f64, HashMap<usize, [f64; 3]>)>) {
        *self.tape_play.write().unwrap_or_else(|e| e.into_inner()) =
            Some((Instant::now(), entries, 0));
    }

    /// Attention orchestration — fige tous les objets SAUF `focus` à
    /// leur dernière position émise (stase pour change blindness : le
    /// seul objet en mouvement capte toute l'attention).
    /// Seed canonique pré-pp — last_out (post-macro) double-transformerait
    /// le gel quand les macros globales ≠ identité.
    pub fn attention_focus(&self, focus: usize) {
        let last_out = self
            .last_canonical_positions
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let mut frozen = self
            .attention_frozen
            .write()
            .unwrap_or_else(|e| e.into_inner());
        let mut manual = self
            .manual_positions
            .write()
            .unwrap_or_else(|e| e.into_inner());
        for (obj, pos) in last_out {
            if obj != focus {
                manual.insert(obj, pos);
                frozen.insert(obj);
            }
        }
    }

    /// Libère la stase d'attention — retire uniquement les positions
    /// que `attention_focus` a figées (jamais les manuelles opérateur).
    pub fn attention_release(&self) {
        let frozen = std::mem::take(
            &mut *self
                .attention_frozen
                .write()
                .unwrap_or_else(|e| e.into_inner()),
        );
        let mut manual = self
            .manual_positions
            .write()
            .unwrap_or_else(|e| e.into_inner());
        for obj in frozen {
            manual.remove(&obj);
        }
    }

    /// Dynamique spatiale — le compresseur spatial : k<1 resserre le
    /// champ, k>1 l'étend. Clampé [0.1, 4].
    pub fn set_spatial_compression(&self, k: f64) {
        if k.is_finite() {
            *self
                .spatial_compression
                .write()
                .unwrap_or_else(|e| e.into_inner()) = k.clamp(0.1, 4.0);
        }
    }

    /// Position gestures — applique une vélocité calculée à tous les
    /// objets émis (réutilise la balistique `thrown`).
    /// `explode` radiale · `converge` vers l'origine · `orbit`
    /// tangentielle · `front` pousse vers l'avant (y<0).
    pub fn gesture(&self, name: &str, strength: f64) {
        let last_out = self
            .last_canonical_positions
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        for (obj, p) in last_out {
            let r = (p[0] * p[0] + p[1] * p[1]).sqrt().max(0.5);
            let vel = match name {
                "explode" => [p[0] / r * strength, p[1] / r * strength, 0.0],
                "converge" => [-p[0] / r * strength, -p[1] / r * strength, 0.0],
                "orbit" => [-p[1] / r * strength, p[0] / r * strength, 0.0],
                "front" => [0.0, -strength, 0.0],
                _ => continue,
            };
            self.throw_object(obj, vel);
        }
    }

    /// Grab & throw : lance un objet avec une vélocité initiale.
    /// L'objet part de sa dernière position émise (ou manuelle/base)
    /// et continue balistique avec amortissement.
    pub fn throw_object(&self, obj: usize, vel: [f64; 3]) {
        if !vel.iter().all(|v| v.is_finite()) {
            return;
        }
        let vel: [f64; 3] = vel.map(|v| v.clamp(-50.0, 50.0));
        // Seed la position manuelle au point de départ si pas déjà tenue
        // — canonique pré-pp, sinon le point de départ double-transforme.
        if self
            .manual_positions
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(&obj)
            .is_none()
        {
            if let Some(p) = self
                .last_canonical_positions
                .read()
                .unwrap_or_else(|e| e.into_inner())
                .get(&obj)
                .copied()
            {
                self.set_manual_position(obj, p);
            }
        }
        self.thrown
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(obj, vel);
    }

    /// Couche réalité-distance — (exagération, gain_atten, air_loss).
    /// Validé : fini + bornes [0,4], [0,2], [0,0.5].
    pub fn set_distance_reality(&self, cfg: Option<(f64, f64, f64)>) {
        if let Some((ex, ga, al)) = cfg {
            if ex.is_finite() && ga.is_finite() && al.is_finite() {
                *self
                    .distance_reality
                    .write()
                    .unwrap_or_else(|e| e.into_inner()) =
                    Some((ex.clamp(0.0, 4.0), ga.clamp(0.0, 2.0), al.clamp(0.0, 0.5)));
            }
        } else {
            *self
                .distance_reality
                .write()
                .unwrap_or_else(|e| e.into_inner()) = None;
        }
    }

    /// Métriques perceptuelles calculées à 60fps dans le frame loop.
    pub fn perceptual_metrics(&self) -> PerceptualMetrics {
        self.perceptual
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Auto-venue : mappe l'espace canonique du show vers la salle
    /// réelle. `scale`/`offset` par axe — `p_out = p*s + o`. None =
    /// passthrough. Validé : fini + scale > 0.
    /// Auto-venue : mappe l'espace canonique du show vers la salle
    /// réelle. (scale, offset, yaw) — yaw = rotation dans le plan
    /// x-y (le sol) en radians, appliqué AVANT scale+offset.
    /// Validé : fini + scale > 0.
    pub fn set_venue_map(&self, map: Option<([f64; 3], [f64; 3], f64)>) {
        if let Some((scale, offset, yaw)) = map {
            if scale
                .iter()
                .all(|s| s.is_finite() && *s > 0.0 && *s <= 100.0)
                && offset.iter().all(|o| o.is_finite() && o.abs() <= 1000.0)
                && yaw.is_finite()
            {
                *self.venue_map.write().unwrap_or_else(|e| e.into_inner()) =
                    Some((scale, offset, yaw.clamp(-6.3, 6.3)));
            }
        } else {
            *self.venue_map.write().unwrap_or_else(|e| e.into_inner()) = None;
        }
    }

    /// Marque les objets pilotés par flux PSN (source-de-contrôle) —
    /// appelé par `set_psn_config` avec les object_index du mapping.
    pub fn set_psn_objects(&self, objs: HashSet<usize>) {
        *self.psn_objects.write().unwrap_or_else(|e| e.into_inner()) = objs;
    }

    /// Source-de-contrôle par objet — *pourquoi cet objet est là*.
    /// Priorité : park > psn > hold > manual > move > track(origine).
    /// Utilisé par `get_object_states` — la lecture opérateur du modèle
    /// de contrôle.
    pub fn object_control_sources(&self) -> HashMap<usize, String> {
        let parked = self
            .parked_objects
            .read()
            .unwrap_or_else(|e| e.into_inner());
        let psn = self.psn_objects.read().unwrap_or_else(|e| e.into_inner());
        let held = self.held_objects.read().unwrap_or_else(|e| e.into_inner());
        let manual = self
            .manual_positions
            .read()
            .unwrap_or_else(|e| e.into_inner());
        let moves = self.active_moves.read().unwrap_or_else(|e| e.into_inner());
        let tracks = self
            .track_positions
            .read()
            .unwrap_or_else(|e| e.into_inner());
        let mut objs: HashSet<usize> = HashSet::new();
        objs.extend(parked.iter().copied());
        objs.extend(psn.iter().copied());
        objs.extend(held.iter().copied());
        objs.extend(manual.keys().copied());
        objs.extend(tracks.keys().map(|&t| t as usize));
        let frozen_attn = self
            .attention_frozen
            .read()
            .unwrap_or_else(|e| e.into_inner());
        for s in moves.values() {
            objs.extend(s.track_indices.iter().copied());
        }
        let mut out = HashMap::with_capacity(objs.len());
        for &obj in &objs {
            let src = if parked.contains(&obj) {
                "park"
            } else if psn.contains(&obj) {
                "psn"
            } else if held.contains(&obj) {
                "hold"
            } else if frozen_attn.contains(&obj) {
                "freeze"
            } else if manual.contains_key(&obj) {
                "manual"
            } else if moves
                .values()
                .any(|s| s.is_active && s.track_indices.contains(&obj))
            {
                "move"
            } else {
                "track"
            };
            out.insert(obj, src.to_string());
        }
        out
    }

    /// Handle partagé des dernières positions émises — injecté dans le
    /// worker pour `AnchorMode::Follow` (origine suit la cible par frame).
    pub fn last_positions_handle(&self) -> Arc<RwLock<HashMap<usize, [f64; 3]>>> {
        // Le worker (Follow) travaille en espace canonique — handle sur la
        // map pré-pp, pas sur last_out (post-macro).
        self.last_canonical_positions.clone()
    }

    /// Dernière position monde connue d'un objet — source des ancres
    /// `AnchorMode::Current`. Ordre : canonique pré-pp (émission merge,
    /// manuelles incluses) → manuelle → origine track → None (jamais vu).
    pub fn last_position(&self, obj: usize) -> Option<[f64; 3]> {
        if let Some(p) = self
            .last_canonical_positions
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(&obj)
        {
            return Some(*p);
        }
        if let Some(p) = self
            .manual_positions
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(&obj)
        {
            return Some(*p);
        }
        self.track_positions
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(&(obj as u32))
            .copied()
    }

    /// Règle le poids d'un move actif — fade effectif = fade × weight
    /// (Override/Crossfade/Blend, tie-break de Priority).
    pub fn set_move_weight(&self, move_id: &str, weight: f64) {
        if let Some(state) = self
            .active_moves
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .get_mut(move_id)
        {
            // Un poids négatif/NaN casserait les comparaisons du merge —
            // on borne à [0, +∞) avec fallback 1.0.
            state.weight = if weight.is_finite() && weight >= 0.0 {
                weight
            } else {
                1.0
            };
        }
    }

    /// Règle la priorité d'un move actif (stratégie Priority).
    pub fn set_move_priority(&self, move_id: &str, priority: u32) {
        if let Some(state) = self
            .active_moves
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .get_mut(move_id)
        {
            state.priority = priority;
        }
    }

    /// Met à jour les osc_ids d'un move actif (pour hot-swap des tracks)
    pub fn update_move_osc_ids(&self, move_id: &str, osc_ids: Vec<u32>) {
        if let Some(state) = self
            .active_moves
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .get_mut(move_id)
        {
            state.osc_ids = osc_ids;
        }
    }

    /// Met à jour les track_indices d'un move actif (pour hot-swap des tracks)
    pub fn update_move_track_indices(&self, move_id: &str, track_indices: Vec<usize>) {
        if let Some(state) = self
            .active_moves
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .get_mut(move_id)
        {
            state.track_indices = track_indices;
        }
    }

    /// Update atomique osc_ids + track_indices — les deux changent sous un
    /// seul write lock, sinon une frame du merge pouvait voir des ids
    /// nouveaux avec des indices périmés (positions sur les mauvaises
    /// tracks pendant une frame).
    pub fn update_move_routing(&self, move_id: &str, osc_ids: Vec<u32>, track_indices: Vec<usize>) {
        if let Some(state) = self
            .active_moves
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .get_mut(move_id)
        {
            state.osc_ids = osc_ids;
            state.track_indices = track_indices;
        }
    }

    /// Vérifie si le merge runtime est en cours d'exécution
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Vrai si le merge thread est mort d'un panic contenu (catch_unwind).
    /// Reste true jusqu'au prochain `start()` — à surveiller côté app pour
    /// détecter un blackout OSC silencieux.
    pub fn thread_died(&self) -> bool {
        self.thread_died.load(Ordering::SeqCst)
    }

    /// Nombre de frames mergées depuis le dernier `start()` — liveness
    /// observable du merge thread (figé = thread mort ou bloqué).
    pub fn merge_frame_count(&self) -> u64 {
        self.merge_frames.load(Ordering::SeqCst)
    }

    /// Total de positions non-finies (NaN/inf) droppées avant l'envoi OSC.
    pub fn dropped_position_count(&self) -> u64 {
        self.dropped_positions.load(Ordering::SeqCst)
    }

}

impl Drop for MergeRuntime {
    /// Un drop sans `stop()` explicite ne doit pas laisser le thread merge/OSC
    /// tourner en fantôme (émetteur silencieux survivant à l'app).
    fn drop(&mut self) {
        self.stop();
    }
}
