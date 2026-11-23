//! Transitions, gestion des moves, tape/attention/gestes, status — extrait de mod.rs (Phase 4).

use super::*;

impl MergeRuntime {
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
        // Held = mémoire éphémère post-move : un move qui reprend une
        // track consomme son hold (`AnchorMode::Current` l'a déjà capturée
        // via `last_position` avant le register). Sans ça, la position
        // tenue gagnerait le post-process (`manual > move`) et clouerait
        // l'objet pendant tout le nouveau move. Les manual posées par
        // l'opérateur ne sont jamais consommées — `held_objects` fait la
        // distinction entre « figé par un move » et « tenu par l'opérateur ».
        // Un move preview est une dry-run : il ne touche pas à l'état live.
        if !is_preview && !track_indices.is_empty() {
            let mut held = self.held_objects.write().unwrap_or_else(|e| e.into_inner());
            let mut manual = self
                .manual_positions
                .write()
                .unwrap_or_else(|e| e.into_inner());
            for &track in &track_indices {
                if held.remove(&track) {
                    manual.remove(&track);
                }
            }
        }
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

    pub(crate) fn enqueue_stale_kill_into(
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

    /// Retire un move en appliquant son `end_mode` déclaré — le stop
    /// opérateur honore `Hold` (pause : figer la dernière position émise
    /// en manuelle) comme une fin naturelle. Les retraits internes
    /// (panic, recall, spawn-failure) passent par `unregister_move` brut :
    /// un kill non déclaré ne doit pas écrire de hold.
    pub fn finish_move(&self, move_id: &str) {
        let is_hold = self
            .move_end_modes
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(move_id)
            .is_some_and(|m| *m == crate::EndMode::Hold);
        if is_hold {
            let (buffer, track_indices) = {
                let moves = self.active_moves.read().unwrap_or_else(|e| e.into_inner());
                let buffers = self.move_buffers.read().unwrap_or_else(|e| e.into_inner());
                (
                    buffers.get(move_id).cloned(),
                    moves
                        .get(move_id)
                        .map(|s| s.track_indices.clone())
                        .unwrap_or_default(),
                )
            };
            if let Some(buf) = buffer {
                let positions = buf.read();
                let mut mp = self
                    .manual_positions
                    .write()
                    .unwrap_or_else(|e| e.into_inner());
                let mut held = self.held_objects.write().unwrap_or_else(|e| e.into_inner());
                write_held_positions(&track_indices, &positions, &mut mp, &mut held);
            }
        }
        let track_indices = {
            let moves = self.active_moves.read().unwrap_or_else(|e| e.into_inner());
            moves
                .get(move_id)
                .map(|s| (s.track_indices.clone(), s.is_preview))
        };
        self.unregister_move(move_id);
        // Revert : les objets retournent à leur source de fond — émission
        // unitaire des origines, sinon le renderer garderait la dernière
        // position du move (rien ne les commande plus). Un preview n'a
        // jamais émis : pas de retour à envoyer.
        if !is_hold {
            if let Some((tracks, false)) = track_indices {
                emit_rest_positions(
                    &self.active_moves,
                    &self.manual_positions,
                    &self.held_objects,
                    &self.parked_objects,
                    &self.track_positions,
                    &self.osc_ids,
                    &self.venue_map,
                    &self.last_out_positions,
                    &self.sink,
                    &tracks,
                );
            }
        }
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
        let parked = self
            .parked_objects
            .read()
            .unwrap_or_else(|e| e.into_inner());
        for (obj, pos) in last_out {
            // Park exclu : il tient déjà sa position — le release
            // d'attention ne doit pas lui ôter son hold.
            if obj != focus && !parked.contains(&obj) {
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
        let ids = self.osc_ids.read().unwrap_or_else(|e| e.into_inner());
        let mut objs: HashSet<usize> = HashSet::new();
        objs.extend(parked.iter().copied());
        objs.extend(psn.iter().copied());
        objs.extend(held.iter().copied());
        objs.extend(manual.keys().copied());
        // Les origines sont indexées en track_id — les objets concernés
        // se résolvent via le mapping courant.
        objs.extend(
            tracks
                .keys()
                .filter_map(|tid| ids.iter().position(|id| id == tid)),
        );
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
        let ids = self.osc_ids.read().unwrap_or_else(|e| e.into_inner());
        let tp = self
            .track_positions
            .read()
            .unwrap_or_else(|e| e.into_inner());
        track_pos_for_obj(&tp, &ids, obj).copied()
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

    /// Poids merge courant d'un move (`fade × weight` = poids
    /// effectif) — `None` si inconnu/retiré. Inspection/debug.
    pub fn get_move_weight(&self, move_id: &str) -> Option<f64> {
        self.active_moves
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(move_id)
            .map(|s| s.weight)
    }

    /// Priorité merge courante d'un move — `None` si inconnu/retiré.
    pub fn get_move_priority(&self, move_id: &str) -> Option<u32> {
        self.active_moves
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(move_id)
            .map(|s| s.priority)
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

/// Émission unitaire des positions de repos après un revert — sinon le
/// renderer garderait la dernière position du move indéfiniment (rien ne
/// les commande plus). Skippés : objets encore couverts par un move
/// actif (flash aller-retour), sous override opérateur (manual/held/park)
/// ou sans origine déclarée. Fonction libre : le merge thread n'a pas de
/// `self`, il passe ses arcs.
#[allow(clippy::too_many_arguments)]
pub(crate) fn emit_rest_positions(
    active_moves: &Arc<RwLock<HashMap<String, MoveState>>>,
    manual_positions: &Arc<RwLock<HashMap<usize, [f64; 3]>>>,
    held_objects: &Arc<RwLock<HashSet<usize>>>,
    parked_objects: &Arc<RwLock<HashSet<usize>>>,
    track_positions: &SharedTrackPositions,
    osc_ids: &Arc<RwLock<Arc<Vec<u32>>>>,
    venue_map: &Arc<RwLock<Option<VenueMap>>>,
    last_out_positions: &Arc<RwLock<HashMap<usize, [f64; 3]>>>,
    sink: &SharedSink,
    track_indices: &[usize],
) {
    let covered: HashSet<usize> = active_moves
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .values()
        .filter(|s| s.is_active)
        .flat_map(|s| s.track_indices.iter().copied())
        .collect();
    let manual = manual_positions.read().unwrap_or_else(|e| e.into_inner());
    let held = held_objects.read().unwrap_or_else(|e| e.into_inner());
    let parked = parked_objects.read().unwrap_or_else(|e| e.into_inner());
    let track_pos = track_positions
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let osc_ids = osc_ids.read().unwrap_or_else(|e| e.into_inner()).clone();
    let venue_map = *venue_map.read().unwrap_or_else(|e| e.into_inner());
    let mut last_out = last_out_positions
        .write()
        .unwrap_or_else(|e| e.into_inner());
    let mut sink = sink.lock().unwrap_or_else(|e| e.into_inner());
    for &t in track_indices {
        if covered.contains(&t)
            || manual.contains_key(&t)
            || held.contains(&t)
            || parked.contains(&t)
        {
            continue;
        }
        let (Some(pos), Some(&osc_id)) = (
            track_pos_for_obj(&track_pos, &osc_ids, t).copied(),
            osc_ids.get(t),
        ) else {
            continue;
        };
        // Même transform venue_map que le chemin d'émission normal.
        let send = venue_map
            .map(|(s, o, yaw)| {
                let (c, sn) = (yaw.cos(), yaw.sin());
                let (x, y) = (pos[0] * c - pos[1] * sn, pos[0] * sn + pos[1] * c);
                [x * s[0] + o[0], y * s[1] + o[1], pos[2] * s[2] + o[2]]
            })
            .unwrap_or(pos);
        last_out.insert(t, pos);
        let _ = sink.send_state(osc_id, send.into(), None);
    }
}

/// Résout l'origine déclarée d'un objet — `track_positions` est indexée en
/// **track_id** (= osc_id, espace opérateur : `/stagespace/trackpos`,
/// import `.hol`, frontend) : la position de repos suit l'IDENTITÉ de
/// l'objet. La résolution obj→track passe par le mapping `osc_ids` courant,
/// ce qui rend l'ordre écriture/mapping sans importance.
pub(crate) fn track_pos_for_obj<'a>(
    track_pos: &'a HashMap<u32, [f64; 3]>,
    osc_ids: &[u32],
    obj: usize,
) -> Option<&'a [f64; 3]> {
    let tid = osc_ids.get(obj)?;
    track_pos.get(tid)
}

/// Écrit les dernières positions d'un move comme positions manuelles
/// « held » — partagé entre la fin naturelle (stale-kill) et le stop
/// opérateur (`finish_move`) : même sémantique `EndMode::Hold`.
/// `positions[i]` (index local du buffer) → `track_indices[i]` (index global).
pub(crate) fn write_held_positions(
    track_indices: &[usize],
    positions: &[(usize, nalgebra::Vector3<f64>)],
    manual_positions: &mut HashMap<usize, [f64; 3]>,
    held_objects: &mut HashSet<usize>,
) {
    for (i, (_, pos)) in positions.iter().enumerate() {
        if let Some(&track) = track_indices.get(i) {
            manual_positions.insert(track, [pos.x, pos.y, pos.z]);
            held_objects.insert(track);
        }
    }
}
