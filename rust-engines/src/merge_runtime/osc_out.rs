//! Sink/callback OSC + identité/routing — extrait de mod.rs (Phase 4).

use super::*;

impl MergeRuntime {
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
}
