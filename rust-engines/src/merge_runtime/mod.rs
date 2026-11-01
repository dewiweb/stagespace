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
    /// Objets dont la position manuelle vient d'un hold de fin de move
    /// (end_mode=Hold) — distingue "tenu par la mémoire" de "reprise
    /// opérateur" dans la source-de-contrôle.
    held_objects: Arc<RwLock<HashSet<usize>>>,
    /// Objets pilotés par flux PSN — posés par set_psn_config, lus pour
    /// la source-de-contrôle (PSN > manuel dans la priorité).
    psn_objects: Arc<RwLock<HashSet<usize>>>,
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
            held_objects: Arc::new(RwLock::new(HashSet::new())),
            psn_objects: Arc::new(RwLock::new(HashSet::new())),
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
        let report = self
            .sink
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .send_state(osc_id, pos, None);
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

    /// Positions réellement émises par objet (ce que le renderer a reçu)
    /// — le côté "commanded" de la confidence view.
    pub fn emitted_positions(&self) -> HashMap<usize, [f64; 3]> {
        self.last_out_positions
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Marque les objets pilotés par flux PSN (source-de-contrôle) —
    /// appelé par `set_psn_config` avec les object_index du mapping.
    pub fn set_psn_objects(&self, objs: HashSet<usize>) {
        *self
            .psn_objects
            .write()
            .unwrap_or_else(|e| e.into_inner()) = objs;
    }

    /// Source-de-contrôle par objet — *pourquoi cet objet est là*.
    /// Priorité : park > psn > hold > manual > move > track(origine).
    /// Utilisé par `get_object_states` — la lecture opérateur du modèle
    /// de contrôle.
    pub fn object_control_sources(&self) -> HashMap<usize, String> {
        let parked = self.parked_objects.read().unwrap_or_else(|e| e.into_inner());
        let psn = self.psn_objects.read().unwrap_or_else(|e| e.into_inner());
        let held = self.held_objects.read().unwrap_or_else(|e| e.into_inner());
        let manual = self.manual_positions.read().unwrap_or_else(|e| e.into_inner());
        let moves = self.active_moves.read().unwrap_or_else(|e| e.into_inner());
        let tracks = self.track_positions.read().unwrap_or_else(|e| e.into_inner());
        let mut objs: HashSet<usize> = HashSet::new();
        objs.extend(parked.iter().copied());
        objs.extend(psn.iter().copied());
        objs.extend(held.iter().copied());
        objs.extend(manual.keys().copied());
        objs.extend(tracks.keys().map(|&t| t as usize));
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
            } else if manual.contains_key(&obj) {
                "manual"
            } else if moves.values().any(|s| s.is_active && s.track_indices.contains(&obj)) {
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
    pub fn last_positions_handle(
        &self,
    ) -> Arc<RwLock<HashMap<usize, [f64; 3]>>> {
        self.last_out_positions.clone()
    }

    /// Dernière position monde connue d'un objet — source des ancres
    /// `AnchorMode::Current`. Ordre : dernière émission merge →
    /// manuelle → origine track → None (jamais vu).
    pub fn last_position(&self, obj: usize) -> Option<[f64; 3]> {
        if let Some(p) = self
            .last_out_positions
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

    /// Démarre le merge thread
    pub fn start(&mut self) -> crate::error::Result<()> {
        if self.running.load(Ordering::SeqCst) {
            return Ok(()); // Déjà démarré
        }

        self.running.store(true, Ordering::SeqCst);
        self.thread_died.store(false, Ordering::SeqCst);
        self.merge_frames.store(0, Ordering::SeqCst);
        let running = self.running.clone();
        let osc_armed_arc = self.osc_armed.clone();
        let thread_died = self.thread_died.clone();
        let merge_frames = self.merge_frames.clone();
        let dropped_positions = self.dropped_positions.clone();
        let sink_arc = self.sink.clone();
        let move_buffers = self.move_buffers.clone();
        let active_moves = self.active_moves.clone();
        let macros = self.macros.clone();
        let audio_state_arc = self.audio_state.clone();
        let origin_arc = self.origin.clone();
        let osc_ids_arc = self.osc_ids.clone();
        let track_depths_arc = self.track_depths.clone();
        let merge_strategy_arc = self.merge_strategy.clone();
        let perf = self.perf.clone();
        let position_callback = self.position_callback.clone();
        let fps = self.fps;
        let post_process_fn_arc = self.post_process_fn.clone();
        let track_positions_arc = self.track_positions.clone();
        let manual_positions_arc = self.manual_positions.clone();
        let move_end_modes_arc = self.move_end_modes.clone();
        let last_out_positions_arc = self.last_out_positions.clone();
        let held_objects_arc = self.held_objects.clone();
        let object_channels_arc = self.object_channels.clone();
        let zones_arc = self.zones.clone();
        let channel_modulations_arc = self.channel_modulations.clone();
        let kinematic_smoothing_arc = self.kinematic_smoothing.clone();
        let graph_zones_arc = self.graph_zones.clone();
        let graph_modulations_arc = self.graph_modulations.clone();
        let move_ref_id_arc = self.move_ref_id.clone();
        let stale_kill_ids = self.stale_kill_ids.clone();
        let signal_fn_arc = self.signal_fn.clone();
        let output_layer_arc = self.output_layer.clone();
        let osc_values_arc = self.osc_values.clone();

        let handle = std::thread::spawn(move || {
            let mut start = Instant::now();
            let frame_duration = Duration::from_secs_f64(1.0 / fps);
            let mut frame_count = 0u64;
            let mut last_perf_update = Instant::now();
            let mut frames_since_perf = 0u64;
            let mut osc_since_perf = 0u64;
            let mut osc_errors_perf = 0u64;
            let mut osc_refused_perf = 0u64;
            // Circuit-breaker OSC (C6) : si >50 % des paquets reviennent en
            // ECONNREFUSED sur 2 fenêtres de perf consécutives (~1 s), la
            // destination est morte — on suspend les sends (le merge et le
            // preview continuent) et on sonde à 1 Hz via l'état réel du
            // premier objet. Une sonde réussie referme le circuit ; si la
            // panne persiste les fenêtres refused re-tripent naturellement.
            // Sans ça : 30 000 encodages/s + sends perdus indéfiniment, et
            // le sweep de PANIC retardé d'autant.
            let mut osc_circuit_open = false;
            let mut osc_bad_windows = 0u32;
            let mut last_probe = Instant::now() - Duration::from_secs(1);
            // États cinématiques par objet — thread-local, aucun lock.
            // Mesurés sur les positions finales (post-merge + post-process).
            let mut kinematic_states: HashMap<usize, KinematicState> = HashMap::new();
            // Moves déjà warnés pour un mismatch track_indices/positions —
            // rate-limit : 1 log par move par épisode (audit I11).
            let mut mismatch_warned: std::collections::HashSet<String> =
                std::collections::HashSet::new();
            let mut prev_frame: Option<Instant> = None;
            let mut prev_t: Option<f64> = None;

            // Instrumentation de la contention des locks : chaque acquisition
            // du hot-path est chronométrée (Instant autour de l'appel) et le
            // total par frame va dans PerfStats.merge_lock_us. Coût : ~2
            // Instant::now() (~50 ns) par site × ~25 sites ≈ 1-2 µs/frame.
            // STAGESPACE_LOCK_PROF=1 active un dump par site toutes les 5 s
            // sur stderr (attribution fine de la contention).
            let lock_profiling = std::env::var_os("STAGESPACE_LOCK_PROF").is_some();
            let mut lock_sites: HashMap<&'static str, u64> = HashMap::new();
            let mut lock_profile_frames = 0u64;
            let mut lock_profile_total_ns = 0u64;
            let mut last_lock_dump = Instant::now();

            // Une frame complète du merge. Séparée en closure pour être
            // enveloppée dans catch_unwind : un panic (post-process, callback,
            // modulations…) ne doit PAS tuer le thread en silence — blackout
            // OSC total avec `running` toujours true. Avec catch_unwind on
            // marque thread_died, on envoie une frame de parking, puis on sort.
            let mut frame = || {
                let frame_start = Instant::now();
                // Attente cumulée des acquisitions de locks de CETTE frame —
                // publiée à la fin dans merge_lock_us (cf. timed_lock!).
                let mut lock_wait_ns = 0u64;
                let t_real = start.elapsed().as_secs_f64();
                // dt réel mesuré (jitter-tolérant) pour les fades
                let dt = prev_frame
                    .map(|p| (frame_start - p).as_secs_f64().max(1e-6))
                    .unwrap_or_else(|| frame_duration.as_secs_f64());
                prev_frame = Some(frame_start);

                // 1. Lire tous les buffers (read lock très court)
                let buffers = timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "move_buffers.read",
                    move_buffers.read().unwrap_or_else(|e| e.into_inner())
                )
                .clone();

                // 2. Collecter les positions par move, avec fade et priorité
                // CRITICAL: ne pas tenir le write lock trop longtemps — register_move
                // a besoin d'accéder à active_moves.write() et sinon il est bloqué
                // pendant des secondes (lock starvation par le merge thread à 60 FPS).
                // Solution: clone les états sous un write lock très court, puis
                // traite tout hors lock.
                let mut move_positions: Vec<MoveEntry> = Vec::new();
                let mut preview_positions: Vec<(usize, nalgebra::Vector3<f64>)> = Vec::new();
                let mut moves_to_remove: Vec<String> = Vec::new();

                // --- Section critique courte: update fades + clone data ---
                let move_snapshots: Vec<(String, f64, f64, u32, Vec<usize>, bool)> = {
                    let mut moves_guard = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "active_moves.write",
                        active_moves.write().unwrap_or_else(|e| e.into_inner())
                    );
                    let mut snapshots = Vec::with_capacity(moves_guard.len());
                    for (move_id, state) in moves_guard.iter_mut() {
                        if !state.is_active {
                            moves_to_remove.push(move_id.clone());
                            continue;
                        }
                        let fade = state.update_fade(dt);
                        if !state.is_active {
                            moves_to_remove.push(move_id.clone());
                            continue;
                        }
                        // Détection de worker zombie : si le PositionBuffer du
                        // move n'a pas été réécrit depuis STALE_FRAME_LIMIT
                        // frames de merge (~0.5 s à 60 FPS), le worker est mort
                        // ou fini — on retire le move au lieu de merger ses
                        // dernières positions indéfiniment.
                        let stale = buffers
                            .get(move_id)
                            .map(|b| {
                                timed_lock!(
                                    lock_wait_ns,
                                    lock_sites,
                                    lock_profiling,
                                    "posbuf.frame_count",
                                    b.frame_count()
                                ) == state.last_frame_count
                            })
                            .unwrap_or(false);
                        if stale {
                            state.stale_frames += 1;
                        } else {
                            state.stale_frames = 0;
                            state.last_frame_count = buffers
                                .get(move_id)
                                .map(|b| {
                                    timed_lock!(
                                        lock_wait_ns,
                                        lock_sites,
                                        lock_profiling,
                                        "posbuf.frame_count",
                                        b.frame_count()
                                    )
                                })
                                .unwrap_or(0);
                        }
                        // Grace allongée tant que le worker n'a jamais
                        // écrit (last_frame_count == 0 = jamais observé
                        // de write) — sinon un premier frame lent fait
                        // tuer le move avant sa première émission.
                        let stale_limit = if state.last_frame_count == 0 {
                            FRESH_STALE_FRAME_LIMIT
                        } else {
                            STALE_FRAME_LIMIT
                        };
                        if state.stale_frames > stale_limit {
                            crate::logging::log_osc_error(&format!(
                                "MergeRuntime: move {move_id} retiré — worker inactif depuis {} frames",
                                state.stale_frames
                            ));
                            state.is_active = false;
                            moves_to_remove.push(move_id.clone());
                            // EndMode::Hold — figer les dernières positions
                            // du buffer en positions manuelles : l'objet
                            // reste où le move l'a laissé (sémantique
                            // « continue » au lieu du retour à la base).
                            if move_end_modes_arc
                                .read()
                                .unwrap_or_else(|e| e.into_inner())
                                .get(move_id)
                                .is_some_and(|m| *m == crate::EndMode::Hold)
                            {
                                if let Some(buf) = buffers.get(move_id) {
                                    let positions = buf.read();
                                    let mut mp = manual_positions_arc
                                        .write()
                                        .unwrap_or_else(|e| e.into_inner());
                                    for (i, (_, pos)) in positions.iter().enumerate() {
                                        if let Some(&track) = state.track_indices.get(i) {
                                            mp.insert(track, [pos.x, pos.y, pos.z]);
                                            held_objects_arc
                                                .write()
                                                .unwrap_or_else(|e| e.into_inner())
                                                .insert(track);
                                        }
                                    }
                                }
                            }
                            // Audit C5 : publier l'ID + le buffer (test
                            // d'identité côté superviseur) pour arrêter
                            // réellement le thread worker — sinon il
                            // tourne à 100 % CPU après son retrait.
                            if let Some(buf) = buffers.get(move_id) {
                                Self::enqueue_stale_kill_into(
                                    &stale_kill_ids,
                                    move_id.clone(),
                                    buf.clone(),
                                );
                            }
                            continue;
                        }
                        snapshots.push((
                            move_id.clone(),
                            fade,
                            state.weight,
                            state.priority,
                            state.track_indices.clone(),
                            state.is_preview,
                        ));
                    }
                    for id in &moves_to_remove {
                        moves_guard.remove(id);
                    }
                    snapshots
                };
                // --- Fin section critique: lock relâché ---

                // Lire les buffers et mapper hors lock. Les moves en PREVIEW
                // n'entrent PAS dans le merge : ils pourraient gagner le merge
                // (Override = fade le plus haut) sur une track partagée avec un
                // move live → track live mutée. Leurs positions vont
                // directement au callback display, sans toucher à l'OSC.
                for (move_id, fade, weight, priority, track_indices, is_preview) in &move_snapshots
                {
                    if let Some(buffer) = buffers.get(move_id) {
                        let positions = timed_lock!(
                            lock_wait_ns,
                            lock_sites,
                            lock_profiling,
                            "posbuf.read",
                            buffer.read()
                        );
                        if positions.is_empty() {
                            continue;
                        }
                        let global_positions: Vec<(usize, nalgebra::Vector3<f64>)> =
                            if track_indices.is_empty() {
                                mismatch_warned.remove(move_id.as_str());
                                positions.clone()
                            } else {
                                // Fenêtre de mismatch (routing non atomique
                                // pendant hot-swap) : avant, le move entier
                                // était sauté à chaque frame + warn×60/s.
                                // On clip à min(len) — un sous-ensemble qui
                                // bouge vaut mieux qu'un move muet — et on
                                // ne log qu'une fois par épisode.
                                if track_indices.len() != positions.len() {
                                    if mismatch_warned.insert(move_id.clone()) {
                                        crate::logging::log_osc_error(&format!(
                                            "MergeRuntime: move {} partially merged — track_indices.len()={} != positions.len()={} (clipped, further warnings suppressed)",
                                            move_id, track_indices.len(), positions.len()
                                        ));
                                    }
                                } else {
                                    mismatch_warned.remove(move_id.as_str());
                                }
                                let n = track_indices.len().min(positions.len());
                                positions
                                    .iter()
                                    .take(n)
                                    .enumerate()
                                    .map(|(local_idx, (_, pos))| (track_indices[local_idx], *pos))
                                    .collect()
                            };
                        if *is_preview {
                            preview_positions.extend(global_positions);
                        } else {
                            move_positions.push((
                                move_id.clone(),
                                *fade,
                                *weight,
                                *priority,
                                global_positions,
                            ));
                        }
                    }
                }

                // Nettoyer les buffers des moves retirés (write lock court)
                if !moves_to_remove.is_empty() {
                    let mut bufs = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "move_buffers.write",
                        move_buffers.write().unwrap_or_else(|e| e.into_inner())
                    );
                    for id in &moves_to_remove {
                        bufs.remove(id);
                    }
                }

                // Idle : aucun move live ni preview → sauter le travail lourd,
                // mais garder la boucle vivante (liveness observable via
                // merge_frames) ET le pacing — sans sleep ici la boucle
                // spinne à 100% CPU et martèle les locks.
                if move_positions.is_empty() && preview_positions.is_empty() {
                    frame_count += 1;
                    let target_time = frame_count as u128 * frame_duration.as_nanos();
                    let current_time = start.elapsed().as_nanos();
                    if target_time > current_time {
                        std::thread::sleep(Duration::from_nanos(
                            (target_time - current_time) as u64,
                        ));
                    } else if current_time - target_time
                        > CATCHUP_FRAME_LIMIT * frame_duration.as_nanos()
                    {
                        start = Instant::now();
                        frame_count = 0;
                    }
                    return;
                }

                // 3. Merge : résoudre les conflits par track.
                let merge_work_start = Instant::now();
                let osc_ids = timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "osc_ids.read",
                    osc_ids_arc.read().unwrap_or_else(|e| e.into_inner())
                )
                .clone();
                let strategy = *timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "merge_strategy.read",
                    merge_strategy_arc.read().unwrap_or_else(|e| e.into_inner())
                );
                // merge_positions trie ses candidats par move_id → déterministe.
                let merged = merge_positions(&move_positions, strategy);

                // MoveRef (audit T2) : un node MoveRef avec `move_id`
                // déclaré dans le graph global remplace la source — la
                // chaîne post-process ne reçoit que les positions de ce
                // move. Move absent → positions vides (pas de fallback
                // silencieux sur le merge complet : le graphe demande
                // explicitement ce move).
                let mut merged = {
                    let move_ref = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "move_ref_id.read",
                        move_ref_id_arc.read().unwrap_or_else(|e| e.into_inner())
                    )
                    .clone();
                    match move_ref {
                        Some(ref id) => move_positions
                            .iter()
                            .find(|e| &e.0 == id)
                            .map(|e| e.4.clone())
                            .unwrap_or_default(),
                        None => merged,
                    }
                };

                // 4. Post-processing via le graph global compilé (PostProcessFn)
                // Snapshots Arc sous locks courts, puis tout hors lock.
                let origin = *timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "origin.lock",
                    origin_arc.lock().unwrap_or_else(|e| e.into_inner())
                );
                let track_depths = timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "track_depths.read",
                    track_depths_arc.read().unwrap_or_else(|e| e.into_inner())
                )
                .clone();
                let track_positions = timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "track_positions.read",
                    track_positions_arc
                        .read()
                        .unwrap_or_else(|e| e.into_inner())
                )
                .clone();
                let manual_positions = timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "manual_positions.read",
                    manual_positions_arc
                        .read()
                        .unwrap_or_else(|e| e.into_inner())
                )
                .clone();
                let audio_state = timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "audio_state.lock",
                    audio_state_arc.lock().unwrap_or_else(|e| e.into_inner())
                )
                .clone();

                // Signal graph : évalue la `SignalFn` compilée → deltas
                // additifs appliqués sur un clone effectif des macros.
                // La base (panel/OSC/cue) n'est jamais écrasée — couche
                // additive pure, les transforms lisent `ctx.macros` sans
                // changement.
                let signal_deltas = {
                    let mut signal = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "signal_fn.lock",
                        signal_fn_arc.lock().unwrap_or_else(|e| e.into_inner())
                    );
                    let deltas = {
                        let osc_map = timed_lock!(
                            lock_wait_ns,
                            lock_sites,
                            lock_profiling,
                            "osc_values.read",
                            osc_values_arc.read().unwrap_or_else(|e| e.into_inner())
                        )
                        .clone();
                        let osc_vals = timed_lock!(
                            lock_wait_ns,
                            lock_sites,
                            lock_profiling,
                            "osc_map.lock",
                            osc_map.lock().unwrap_or_else(|e| e.into_inner())
                        );
                        (*signal)(&crate::signal_compiler::SignalCtx {
                            t: t_real,
                            dt,
                            audio_state: &audio_state,
                            osc_values: &osc_vals,
                        })
                    };
                    deltas
                };
                let eff_macros = if signal_deltas.macros.is_empty() {
                    None
                } else {
                    Some(crate::signal_compiler::macro_with_deltas(
                        &macros,
                        &signal_deltas.macros,
                    ))
                };

                let ctx = PostProcessContext {
                    t: t_real,
                    macros: eff_macros.as_ref().unwrap_or_else(|| macros.as_ref()),
                    audio_state: &audio_state,
                    track_positions: &track_positions,
                    manual_positions: &manual_positions,
                    origin,
                    track_depths: &track_depths,
                };

                // Transition de recall en cours ? Snapshot de l'arbre —
                // `Live` = chemin classique inchangé ; un Blend terminé
                // retombe à Live (l'arbre n'accumule rien).
                let layer_snap = {
                    let mut g = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "output_layer.lock",
                        output_layer_arc.lock().unwrap_or_else(|e| e.into_inner())
                    );
                    if transition::layer_finished(&g) {
                        *g = transition::Layer::Live;
                    }
                    g.clone()
                };
                let transition_active = !matches!(layer_snap, transition::Layer::Live);
                // Les valeurs propres vivent ici (référencées par LiveInputs).
                let transition_owned = if transition_active {
                    let pp_fn = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "post_process_fn.read",
                        post_process_fn_arc
                            .read()
                            .unwrap_or_else(|e| e.into_inner())
                    )
                    .clone();
                    let live_channels = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "object_channels.read",
                        object_channels_arc
                            .read()
                            .unwrap_or_else(|e| e.into_inner())
                    )
                    .clone();
                    let live_zones: Vec<crate::zones::Zone> = {
                        let mut z = (**timed_lock!(
                            lock_wait_ns,
                            lock_sites,
                            lock_profiling,
                            "graph_zones.read",
                            graph_zones_arc.read().unwrap_or_else(|e| e.into_inner())
                        ))
                        .clone();
                        z.extend(
                            timed_lock!(
                                lock_wait_ns,
                                lock_sites,
                                lock_profiling,
                                "zones.read",
                                zones_arc.read().unwrap_or_else(|e| e.into_inner())
                            )
                            .iter()
                            .cloned(),
                        );
                        z
                    };
                    let live_mods: Vec<ChannelModulation> = {
                        let mut m = (**timed_lock!(
                            lock_wait_ns,
                            lock_sites,
                            lock_profiling,
                            "graph_modulations.read",
                            graph_modulations_arc
                                .read()
                                .unwrap_or_else(|e| e.into_inner())
                        ))
                        .clone();
                        m.extend(
                            timed_lock!(
                                lock_wait_ns,
                                lock_sites,
                                lock_profiling,
                                "channel_modulations.read",
                                channel_modulations_arc
                                    .read()
                                    .unwrap_or_else(|e| e.into_inner())
                            )
                            .iter()
                            .cloned(),
                        );
                        m
                    };
                    Some((pp_fn, live_channels, live_zones, live_mods))
                } else {
                    None
                };
                let live_common = transition_owned.as_ref().map(|_| transition::EvalCommon {
                    t: t_real,
                    audio_state: &audio_state,
                    track_positions: &track_positions,
                    macros_deltas: &signal_deltas.macros,
                });
                let live_layer =
                    transition_owned
                        .as_ref()
                        .map(|(pp_fn, ch, zo, mo)| transition::LiveInputs {
                            post_process_fn: pp_fn,
                            macros: eff_macros.as_ref().unwrap_or_else(|| macros.as_ref()),
                            manual_positions: &manual_positions,
                            track_depths: &track_depths,
                            object_channels: ch,
                            zones: zo,
                            modulations: mo,
                            origin,
                        });

                let transformed_raw: Vec<(usize, nalgebra::Vector3<f64>)> =
                    match (&live_layer, &live_common) {
                        (Some(live), Some(common)) => {
                            // Transition : positions = blend des feuilles
                            // (chaque feuille = son propre post-process /
                            // macros / manual / depths / origin).
                            transition::eval_positions_tree(&layer_snap, live, &merged, common)
                        }
                        _ => {
                            let pp_fn = timed_lock!(
                                lock_wait_ns,
                                lock_sites,
                                lock_profiling,
                                "post_process_fn.read",
                                post_process_fn_arc
                                    .read()
                                    .unwrap_or_else(|e| e.into_inner())
                            );
                            // `merged` est consommé ici — les bras
                            // transition/preview qui le relisent sont
                            // mutuellement exclusifs avec le bras Live.
                            pp_fn(&ctx, std::mem::take(&mut merged))
                        }
                    };

                // Sanitize : une position NaN/inf ne doit jamais partir en OSC
                // (f64::clamp ne panique pas ici — on droppe l'objet). Le
                // compteur dropped_positions rend la perte observable.
                let transformed: Vec<(usize, nalgebra::Vector3<f64>)> = transformed_raw
                    .into_iter()
                    .filter(|(_, pos)| {
                        if pos.iter().all(|v| v.is_finite()) {
                            true
                        } else {
                            dropped_positions.fetch_add(1, Ordering::SeqCst);
                            false
                        }
                    })
                    .collect();

                // Dernières positions monde émises — source des ancres
                // `AnchorMode::Current` au spawn du move suivant.
                {
                    let mut last_out = last_out_positions_arc
                        .write()
                        .unwrap_or_else(|e| e.into_inner());
                    for (obj, pos) in &transformed {
                        last_out.insert(*obj, [pos.x, pos.y, pos.z]);
                    }
                }

                // 4.5 Cinématique : vitesse/accélération/jerk sur les positions
                // finales (celles réellement envoyées au renderer), dt réel
                // entre frames pour une mesure correcte même en cas de jitter.
                let kin_dt = prev_t.map(|p| (t_real - p).max(1e-6)).unwrap_or(dt);
                prev_t = Some(t_real);
                let kin_smoothing = *timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "kin_smoothing.read",
                    kinematic_smoothing_arc
                        .read()
                        .unwrap_or_else(|e| e.into_inner())
                );
                let has_modulations = !timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "channel_modulations.read",
                    channel_modulations_arc
                        .read()
                        .unwrap_or_else(|e| e.into_inner())
                )
                .is_empty()
                    || !timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "graph_modulations.read",
                        graph_modulations_arc
                            .read()
                            .unwrap_or_else(|e| e.into_inner())
                    )
                    .is_empty();
                if has_modulations {
                    let present: std::collections::HashSet<usize> =
                        transformed.iter().map(|(i, _)| *i).collect();
                    for (obj_idx, pos) in &transformed {
                        kinematic_states.entry(*obj_idx).or_default().update(
                            *pos,
                            kin_dt,
                            kin_smoothing,
                        );
                    }
                    kinematic_states.retain(|idx, _| present.contains(idx));
                } else if !kinematic_states.is_empty() {
                    kinematic_states.clear();
                }
                // Règles = graph-déclarées puis manuelles — les manuelles
                // écrasent le graph sur les canaux qu'elles ciblent.
                let modulated_channels: HashMap<usize, SpatialChannels> = {
                    let graph_rules = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "graph_modulations.read",
                        graph_modulations_arc
                            .read()
                            .unwrap_or_else(|e| e.into_inner())
                    )
                    .clone();
                    let manual_rules = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "channel_modulations.read",
                        channel_modulations_arc
                            .read()
                            .unwrap_or_else(|e| e.into_inner())
                    )
                    .clone();
                    let mut rules: Vec<ChannelModulation> = (*graph_rules).clone();
                    rules.extend(manual_rules.iter().cloned());
                    apply_modulations(&rules, &kinematic_states)
                };

                // 4.6 Zones : graph-déclarées puis manuelles (dernier mot au
                // manuel). Snapshot Arc sous read lock court.
                let zones: Vec<crate::zones::Zone> = {
                    let graph = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "graph_zones.read",
                        graph_zones_arc.read().unwrap_or_else(|e| e.into_inner())
                    )
                    .clone();
                    let manual = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "zones.read",
                        zones_arc.read().unwrap_or_else(|e| e.into_inner())
                    )
                    .clone();
                    let mut z = (*graph).clone();
                    z.extend(manual.iter().cloned());
                    z
                };

                // Transition : canaux effectifs = blend des feuilles —
                // chaque feuille évalue statiques ⊕ modulations ⊕ zones sur
                // SES positions ; les deux côtés partagent `kinematic_states`
                // (déjà à jour sur les positions blendées).
                let eff_channels_override: Option<HashMap<usize, SpatialChannels>> =
                    match (&live_layer, &live_common) {
                        (Some(live), Some(common)) => Some(transition::eval_channels_tree(
                            &layer_snap,
                            live,
                            &merged,
                            common,
                            &kinematic_states,
                        )),
                        _ => None,
                    };

                // 5. Output — le sink est locké pour la frame entière : les
                // sends par objet sont non-bloquants (~µs), et un set_sink
                // mid-show ne peut pas swaper en plein milieu d'une frame.
                // ECONNREFUSED = ICMP port-unreachable → personne n'écoute :
                // compté dans `refused` (renderer down), pas du packet loss.
                // Erreurs comptées, jamais loguées par paquet (flood de warn!
                // quand le renderer est down).
                let object_channels = timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "object_channels.read",
                    object_channels_arc
                        .read()
                        .unwrap_or_else(|e| e.into_inner())
                )
                .clone();
                // Master arm : disarmé = silence total, le merge continue
                // (preview alive) mais aucun paquet ne part — ni les sends
                // normaux ni la sonde du circuit-breaker.
                if osc_armed_arc.load(Ordering::SeqCst) {
                    let mut sink_guard = timed_lock!(
                        lock_wait_ns,
                        lock_sites,
                        lock_profiling,
                        "sink.lock",
                        sink_arc.lock().unwrap_or_else(|e| e.into_inner())
                    );
                    if osc_circuit_open {
                        // Circuit ouvert : une sonde par seconde — un vrai
                        // send_state du premier objet (donnée utile si le
                        // renderer est revenu entre-temps).
                        if last_probe.elapsed() >= Duration::from_secs(1) {
                            last_probe = Instant::now();
                            if let Some(&(obj_idx, pos)) =
                                transformed.iter().find(|(i, _)| osc_ids.get(*i).is_some())
                            {
                                let report = sink_guard.send_state(osc_ids[obj_idx], pos, None);
                                if report.sent > 0 && report.refused == 0 && report.errors == 0 {
                                    osc_circuit_open = false;
                                    osc_bad_windows = 0;
                                    crate::logging::log_osc_error(
                                        "OSC circuit CLOSED — renderer reachable again",
                                    );
                                }
                            }
                        }
                    } else {
                        for (obj_idx, pos) in &transformed {
                            if let Some(&osc_id) = osc_ids.get(*obj_idx) {
                                // Canaux effectifs = statiques + modulés (modulation
                                // prioritaire sur les canaux qu'elle cible) + zones
                                // (blend par influence, prioritaires sur le reste)
                                let effective: Option<SpatialChannels> =
                                    if let Some(over) = &eff_channels_override {
                                        over.get(obj_idx).copied()
                                    } else {
                                        let has_zones =
                                            crate::zones::any_zone_applies(&zones, *obj_idx, pos);
                                        match (
                                            object_channels.get(obj_idx),
                                            modulated_channels.get(obj_idx),
                                            has_zones,
                                        ) {
                                            (None, None, false) => None,
                                            (s, m, _) => {
                                                let mut eff = s.copied().unwrap_or_default();
                                                if let Some(mc) = m {
                                                    eff.overlay(mc);
                                                }
                                                crate::zones::apply_zones(
                                                    &zones, *obj_idx, pos, &mut eff,
                                                );
                                                Some(eff)
                                            }
                                        }
                                    };
                                let report =
                                    sink_guard.send_state(osc_id, *pos, effective.as_ref());
                                osc_since_perf += report.sent as u64;
                                osc_errors_perf += report.errors as u64;
                                osc_refused_perf += report.refused as u64;
                            }
                        }
                    }
                }

                // 6. Callback pour le 3D preview : display = positions mergées +
                // positions preview (affichées mais jamais envoyées en OSC).
                // Parité : les positions preview passent par le MÊME post-process
                // que le live — sinon le 3D ment sur ce que l'OSC enverrait si le
                // move passait live (scale/rotate/origin du graph global).
                // Le sender est cloné sous un lock très court — la sériali-
                // sation JSON de l'emit se fait sur le pump thread. Le post-
                // process du preview reste ici (il doit refléter le live).
                let cb = timed_lock!(
                    lock_wait_ns,
                    lock_sites,
                    lock_profiling,
                    "position_cb.lock",
                    position_callback.lock().unwrap_or_else(|e| e.into_inner())
                )
                .clone();
                if let Some(tx) = cb {
                    let preview_transformed: Vec<(usize, nalgebra::Vector3<f64>)> =
                        if preview_positions.is_empty() {
                            Vec::new()
                        } else {
                            let raw = match (&live_layer, &live_common) {
                                // Parité : le preview suit le même blend
                                // de layers que le live pendant une
                                // transition (sinon le 3D ment).
                                (Some(live), Some(common)) => transition::eval_positions_tree(
                                    &layer_snap,
                                    live,
                                    &preview_positions,
                                    common,
                                ),
                                _ => {
                                    let pp_fn = timed_lock!(
                                        lock_wait_ns,
                                        lock_sites,
                                        lock_profiling,
                                        "post_process_fn.read",
                                        post_process_fn_arc
                                            .read()
                                            .unwrap_or_else(|e| e.into_inner())
                                    );
                                    pp_fn(&ctx, preview_positions.clone())
                                }
                            };
                            raw.into_iter()
                                .filter(|(_, pos)| pos.iter().all(|v| v.is_finite()))
                                .collect()
                        };
                    let mut display = transformed.clone();
                    display.extend(preview_transformed);
                    // try_send borné : si le pump est encore occupé à
                    // sérialiser la frame précédente, on droppe — preview
                    // dégradé (≈20-30 Hz) plutôt que merge retardé.
                    let _ = tx.try_send((t_real, display));
                }

                // 7. Perf monitor — agrégation des erreurs OSC (1 log max par
                // fenêtre de 500 ms au lieu d'un warn! par paquet échoué).
                frame_count += 1;
                frames_since_perf += 1;
                let perf_elapsed = last_perf_update.elapsed();
                if perf_elapsed.as_millis() >= 500 {
                    let secs = perf_elapsed.as_secs_f64();
                    let fps_actual = frames_since_perf as f64 / secs;
                    let osc_rate = osc_since_perf as f64 / secs;
                    let frame_time_us = frame_start.elapsed().as_micros() as f64;
                    let latency_ms = frame_time_us / 1000.0;
                    let cpu_pct = (latency_ms / (1000.0 / fps)) * 100.0;
                    let total_osc = osc_since_perf + osc_errors_perf;
                    let (error_rate, refused_rate) = if total_osc > 0 {
                        (
                            osc_errors_perf as f64 / total_osc as f64,
                            osc_refused_perf as f64 / total_osc as f64,
                        )
                    } else {
                        (0.0, 0.0)
                    };
                    if osc_errors_perf > 0 {
                        crate::logging::log_osc_error(&format!(
                            "MergeRuntime OSC: {} erreurs / {} paquets sur {:.0} ms ({} refused)",
                            osc_errors_perf,
                            total_osc,
                            perf_elapsed.as_millis(),
                            osc_refused_perf
                        ));
                    }
                    // Circuit-breaker : 2 fenêtres de 500 ms à >50 % refused
                    // = renderer mort → suspendre les sends (sonde à 1 Hz).
                    if !osc_circuit_open {
                        if total_osc > 0 && refused_rate > 0.5 {
                            osc_bad_windows += 1;
                            if osc_bad_windows >= 2 {
                                osc_circuit_open = true;
                                // Sonde quasi-immédiate à la prochaine frame.
                                last_probe = Instant::now() - Duration::from_secs(1);
                                crate::logging::log_osc_error(
                                    "OSC circuit OPEN — target unreachable, suspending sends (probe @1Hz)",
                                );
                            }
                        } else {
                            osc_bad_windows = 0;
                        }
                    }
                    perf.set_osc_suspended(osc_circuit_open);
                    perf.update_with_error_rate(
                        fps_actual,
                        osc_rate,
                        latency_ms,
                        cpu_pct,
                        error_rate,
                        refused_rate,
                    );
                    frames_since_perf = 0;
                    osc_since_perf = 0;
                    osc_errors_perf = 0;
                    osc_refused_perf = 0;
                    last_perf_update = Instant::now();
                }

                // Durée de travail réel de la frame (merge + sends + perf) —
                // exclut le sleep de pacing : c'est le vrai coût hot-path,
                // exposé dans PerfStats.merge_frame_us.
                perf.set_merge_frame_us(merge_work_start.elapsed().as_secs_f64() * 1e6);
                // Attente totale en acquisition de locks sur la frame entière
                // (les premiers locks — move_buffers/active_moves — précèdent
                // merge_work_start ; le total est donc un tout petit peu plus
                // large que merge_frame_us, c'est voulu : on mesure la
                // contention de TOUTE la frame).
                perf.set_merge_lock_us(lock_wait_ns as f64 / 1000.0);

                // Dump du profiling par site (STAGESPACE_LOCK_PROF=1) : toutes
                // les 5 s, top des sites par attente cumulée ramenée à la
                // frame — attribution fine de la contention sans coût quand
                // le flag est absent (lock_sites reste vide).
                if lock_profiling {
                    lock_profile_frames += 1;
                    lock_profile_total_ns += lock_wait_ns;
                    if last_lock_dump.elapsed() >= Duration::from_secs(5) {
                        let frames = lock_profile_frames.max(1) as f64;
                        let mut ranked: Vec<(&'static str, u64)> = lock_sites.drain().collect();
                        ranked.sort_by_key(|entry| std::cmp::Reverse(entry.1));
                        let top = ranked
                            .iter()
                            .take(10)
                            .map(|(name, ns)| format!("{name}={:.0}", *ns as f64 / frames))
                            .collect::<Vec<_>>()
                            .join(" ");
                        eprintln!(
                            "[lock-prof] {} frames, wait_total={:.0} ns/frame :: {}",
                            lock_profile_frames,
                            lock_profile_total_ns as f64 / frames,
                            top
                        );
                        lock_profile_frames = 0;
                        lock_profile_total_ns = 0;
                        last_lock_dump = Instant::now();
                    }
                }

                // Timing précis + re-ancrage : après un stall (pause debug,
                // emit bloquant, préemption), on ne burst pas des centaines de
                // frames obsolètes — on ré-ancre frame_count sur le temps réel.
                let target_time = frame_count as u128 * frame_duration.as_nanos();
                let current_time = start.elapsed().as_nanos();
                if target_time > current_time {
                    let sleep_ns = (target_time - current_time) as u64;
                    // std::thread::sleep au lieu de spin_sleep — rend la main à
                    // l'OS. Précision ~1-2ms suffisante pour 60 FPS.
                    std::thread::sleep(Duration::from_nanos(sleep_ns));
                } else if current_time - target_time
                    > CATCHUP_FRAME_LIMIT * frame_duration.as_nanos()
                {
                    start = Instant::now();
                    frame_count = 0;
                }
            };

            while running.load(Ordering::SeqCst) {
                merge_frames.fetch_add(1, Ordering::SeqCst);
                if std::panic::catch_unwind(std::panic::AssertUnwindSafe(&mut frame)).is_err() {
                    // Panic contenu : le merge thread va mourir — on le rend
                    // observable (thread_died + running=false + frame_count
                    // figé) et on tente une frame de parking sur les derniers
                    // états connus avant de sortir.
                    thread_died.store(true, Ordering::SeqCst);
                    // Marquer stopped AVANT le parking : si le parking ou le
                    // callback panique à son tour, is_running() ne doit pas
                    // rester true sur un thread mort (spawn_move pourrait
                    // alors ne jamais redémarrer le merge).
                    running.store(false, Ordering::SeqCst);
                    crate::logging::log_osc_error(
                        "MergeRuntime: PANIC in merge thread — arrêt du merge",
                    );
                    // Parking : envoyer l'origin à toutes les tracks (même
                    // comportement que le panic côté app) avant de mourir.
                    {
                        let origin = *origin_arc.lock().unwrap_or_else(|e| e.into_inner());
                        let ids = osc_ids_arc
                            .read()
                            .unwrap_or_else(|e| e.into_inner())
                            .clone();
                        let mut sink_guard = sink_arc.lock().unwrap_or_else(|e| e.into_inner());
                        for osc_id in ids.iter() {
                            let _ = sink_guard.send_state(*osc_id, origin, None);
                        }
                    }
                    let cb = position_callback
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .clone();
                    if let Some(tx) = cb {
                        // send (bloquant borné) plutôt que try_send : la frame
                        // de parking DOIT passer — le pump est en général vide.
                        let _ = tx.send((0.0, Vec::new()));
                    }
                    break;
                }
            }
        });

        self.thread = Some(handle);
        Ok(())
    }

    /// Arrête le merge thread
    pub fn stop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.thread.take() {
            // join() depuis le thread lui-même paniquerait — garde défensive
            // (un drop depuis le merge thread ne devrait pas arriver, mais un
            // panic dans Drop est non-catchable proprement).
            if handle.thread().id() != std::thread::current().id() {
                let _ = handle.join();
            }
        }
    }

    /// Applique le post-process global (PostProcessFn) à des samples
    /// de trajectoire déjà calculés (avec macros du movement).
    ///
    /// Utilisé par la visualisation 3D pour que la trajectoire affichée
    /// corresponde à la sortie OSC réelle (qui passe par le post-process).
    ///
    /// `samples` : Vec<(t, x, y, z)> — samples raw d'un movement
    /// `object_index` : l'index de l'objet dans le merge global
    pub fn apply_post_process_to_samples(
        &self,
        samples: Vec<(f64, f64, f64, f64)>,
        object_index: usize,
    ) -> Vec<(f64, f64, f64, f64)> {
        self.sample_post_processor()(samples, object_index)
    }

    pub fn sample_post_processor(
        &self,
    ) -> impl Fn(TrajectorySamples, usize) -> TrajectorySamples + Send + 'static {
        let macros = self.macros.clone();
        let audio_state = self
            .audio_state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let track_positions = self
            .track_positions
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let manual_positions = self
            .manual_positions
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let origin = *self.origin.lock().unwrap_or_else(|e| e.into_inner());
        let track_depths = self
            .track_depths
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();

        let pp_fn = self
            .post_process_fn
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        move |samples, object_index| {
            let mut result = Vec::with_capacity(samples.len());
            for (t, x, y, z) in samples {
                let ctx = PostProcessContext {
                    t,
                    macros: &macros,
                    audio_state: &audio_state,
                    track_positions: &track_positions,
                    manual_positions: &manual_positions,
                    origin,
                    track_depths: &track_depths,
                };
                let pos = nalgebra::Vector3::new(x, y, z);
                let transformed = pp_fn(&ctx, vec![(object_index, pos)]);
                if let Some((_, tp)) = transformed.first() {
                    result.push((t, tp.x, tp.y, tp.z));
                } else {
                    result.push((t, x, y, z));
                }
            }
            result
        }
    }
}

impl Drop for MergeRuntime {
    /// Un drop sans `stop()` explicite ne doit pas laisser le thread merge/OSC
    /// tourner en fantôme (émetteur silencieux survivant à l'app).
    fn drop(&mut self) {
        self.stop();
    }
}
