//! Pipeline interne : match, suppression, validation, dispatch, routing.
//! Extrait de osc_receiver.rs (Phase 5).

use super::*;

pub(crate) fn match_address(pattern: &str, addr: &str) -> Option<Vec<String>> {
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

pub(crate) fn is_suppressed(suppress_until: &Mutex<Option<Instant>>) -> bool {
    suppress_until
        .lock()
        .map(|g| g.is_some_and(|t| Instant::now() < t))
        .unwrap_or(false)
}

pub(crate) fn validate_mapping(mapping: &OscMapping) -> Result<(), String> {
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

pub(crate) fn extract_args(args: &[OscType]) -> Vec<f64> {
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

pub(crate) fn handle_packet(
    packet: OscPacket,
    shared: &Shared,
    depth: usize,
    src: std::net::SocketAddr,
) {
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
pub(crate) fn handle_show_command(msg: &OscMessage, src: std::net::SocketAddr, shared: &Shared) {
    shared
        .stats
        .packets_received
        .fetch_add(1, Ordering::Relaxed);
    // Ack/nack APRÈS parse — un ack avant parse confirmait des commandes
    // invalides jamais exécutées ; un inconnu mérite un nack explicite.
    let socket = shared
        .reply_socket
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .cloned();
    let fps = f64::from_bits(shared.timecode_fps.load(Ordering::Relaxed));
    match parse_show_command(&msg.addr, &msg.args, fps) {
        Some(cmd) => {
            // Contrôleur + voyant enregistrés APRÈS parse (revue F6) —
            // du garbage /stagespace/* évincerait une console légitime
            // (max 4) et allumerait le voyant "console connectée".
            {
                let mut c = shared.controllers.lock().unwrap_or_else(|e| e.into_inner());
                c.retain(|a| *a != src);
                c.insert(0, src);
                c.truncate(MAX_CONTROLLERS);
            }
            *shared
                .last_show_rx
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
            if let Some(socket) = socket.as_ref() {
                let ack = OscPacket::Message(OscMessage {
                    addr: "/stagespace/ack".to_string(),
                    args: vec![OscType::String(msg.addr.clone())],
                });
                if let Ok(bytes) = encode(&ack) {
                    let _ = socket.send_to(&bytes, src);
                }
            }
            // Le sink est cloné (Arc) hors du mutex — l'invoquer sous le
            // lock bloquerait toute la file /stagespace/* : un panic
            // attendrait derrière la commande lente qu'il doit interrompre
            // (revue des fixs F7).
            let sink = shared
                .show_sink
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            if let Some(sink) = sink {
                sink(cmd, src);
            }
        }
        None => {
            // Commande inconnue/malformée → nack explicite au contrôleur
            // (l'ack ne part que pour les commandes parsées et dispatchées).
            if let Some(socket) = socket.as_ref() {
                let nack = OscPacket::Message(OscMessage {
                    addr: "/stagespace/nack".to_string(),
                    args: vec![OscType::String(format!("unknown-command: {}", msg.addr))],
                });
                if let Ok(bytes) = encode(&nack) {
                    let _ = socket.send_to(&bytes, src);
                }
            }
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
pub(crate) fn dispatch_message(addr: &str, args: Vec<f64>, shared: &Shared) {
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

pub(crate) fn route_destination(
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

/// Encode `/stagespace/pos/state <obj> <x> <y> <z>` — réponse feedback au
/// query `positions` (émise par le sink backend, sans webview requise).
pub fn encode_position_feedback(obj: usize, pos: [f64; 3]) -> Option<Vec<u8>> {
    encode(&OscPacket::Message(OscMessage {
        addr: "/stagespace/pos/state".to_string(),
        args: vec![
            OscType::Int(obj as i32),
            OscType::Float(pos[0] as f32),
            OscType::Float(pos[1] as f32),
            OscType::Float(pos[2] as f32),
        ],
    }))
    .ok()
}
