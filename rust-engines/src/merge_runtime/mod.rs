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
mod loop_core;
mod move_state;
mod osc_out;
mod overrides;
mod state_ops;
#[cfg(test)]
mod tests;
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
}

impl Drop for MergeRuntime {
    /// Un drop sans `stop()` explicite ne doit pas laisser le thread merge/OSC
    /// tourner en fantôme (émetteur silencieux survivant à l'app).
    fn drop(&mut self) {
        self.stop();
    }
}
