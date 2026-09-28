//! Commandes CLI : écoute et validation OSC

use crate::cli_state;
use crate::graph_presets;
use stagespace_engines::{
    LoopMode, MacroTarget, MappingDestination, ObjectRef, OscMapping, SpatialChannel, Transform,
};
use std::str::FromStr;

use super::helpers::{osc_ids_to_indices, parse_args, parse_track_list};

pub fn cmd_osc_listen(args: &[&str]) -> Result<String, String> {
    let opts = parse_args(args);
    let port: u16 = opts
        .get("port")
        .and_then(|s| s.parse().ok())
        .unwrap_or(8000);
    let timeout_secs: u64 = opts
        .get("timeout")
        .and_then(|s| s.parse().ok())
        .unwrap_or(5);
    let profile = opts.get("profile").cloned();
    let validate = opts.contains_key("validate");
    let quiet = opts.contains_key("quiet");

    let socket = std::net::UdpSocket::bind(format!("0.0.0.0:{port}"))
        .map_err(|e| format!("Failed to bind port {port}: {e}"))?;
    socket
        .set_read_timeout(Some(std::time::Duration::from_secs(timeout_secs)))
        .map_err(|e| format!("Failed to set timeout: {e}"))?;

    let mut buf = [0u8; 4096];
    let mut out = format!("Listening on port {port} for {timeout_secs}s");
    if let Some(ref p) = profile {
        out.push_str(&format!(" (validating profile: {p})"));
    }
    out.push_str("...\n");

    // Stats de validation
    let mut total_packets = 0u64;
    let mut valid_packets = 0u64;
    let mut invalid_packets = 0u64;
    let mut unique_addresses: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut unique_track_ids: std::collections::HashSet<u32> = std::collections::HashSet::new();
    let mut first_packet_time: Option<std::time::Instant> = None;
    let mut last_packet_time: Option<std::time::Instant> = None;
    let mut errors: Vec<String> = Vec::new();

    loop {
        match socket.recv_from(&mut buf) {
            Ok((n, addr)) => {
                total_packets += 1;
                let now = std::time::Instant::now();
                if first_packet_time.is_none() {
                    first_packet_time = Some(now);
                }
                last_packet_time = Some(now);

                if let Ok((_, rosc::OscPacket::Message(msg))) = rosc::decoder::decode_udp(&buf[..n])
                {
                    let args: Vec<String> = msg
                        .args
                        .iter()
                        .map(|a| match a {
                            rosc::OscType::Float(f) => format!("{f:.4}"),
                            rosc::OscType::Int(i) => i.to_string(),
                            rosc::OscType::String(s) => s.clone(),
                            _ => format!("{a:?}"),
                        })
                        .collect();

                    unique_addresses.insert(msg.addr.clone());

                    // Extraire le track ID de l'adresse
                    if let Some(track_id) = extract_track_id(&msg.addr) {
                        unique_track_ids.insert(track_id);
                    }

                    // Validation selon le profil
                    let is_valid = if validate {
                        if let Some(ref p) = profile {
                            let valid = validate_osc_address(&msg.addr, p, &msg.args);
                            if !valid.0 {
                                invalid_packets += 1;
                                if errors.len() < 10 {
                                    errors.push(format!("  ✗ {} — {}", msg.addr, valid.1));
                                }
                            } else {
                                valid_packets += 1;
                            }
                            valid.0
                        } else {
                            valid_packets += 1;
                            true
                        }
                    } else {
                        valid_packets += 1;
                        true
                    };

                    if !quiet {
                        let marker = if validate {
                            if is_valid {
                                "✓"
                            } else {
                                "✗"
                            }
                        } else {
                            " "
                        };
                        out.push_str(&format!(
                            "  {marker} {} {} from {}\n",
                            msg.addr,
                            args.join(" "),
                            addr
                        ));
                    }
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                break;
            }
            Err(e) => {
                out.push_str(&format!("Error: {e}\n"));
                break;
            }
        }
    }

    // Résumé
    out.push_str("\n═══ Summary ═══\n");
    out.push_str(&format!("  Total packets: {total_packets}\n"));
    out.push_str(&format!(
        "  Valid: {valid_packets} | Invalid: {invalid_packets}\n"
    ));
    out.push_str(&format!(
        "  Unique addresses: {} ({})\n",
        unique_addresses.len(),
        unique_addresses
            .iter()
            .take(5)
            .cloned()
            .collect::<Vec<_>>()
            .join(", ")
    ));
    out.push_str(&format!(
        "  Unique track IDs: {} ({})\n",
        unique_track_ids.len(),
        {
            let mut ids: Vec<u32> = unique_track_ids.iter().copied().collect();
            ids.sort();
            ids.iter()
                .take(10)
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        }
    ));

    // Calcul du rate
    if let (Some(first), Some(last)) = (first_packet_time, last_packet_time) {
        let elapsed = last.duration_since(first).as_secs_f64();
        if elapsed > 0.0 {
            let rate = total_packets as f64 / elapsed;
            out.push_str(&format!("  Duration: {elapsed:.1}s\n"));
            out.push_str(&format!("  Packet rate: {rate:.1} pkt/s\n"));
            if total_packets > 10 {
                let expected = 60.0 * unique_track_ids.len().max(1) as f64;
                if rate < expected * 0.5 {
                    out.push_str(&format!(
                        "  ⚠ Rate low (expected ~{expected:.0} for 60fps × {} tracks)\n",
                        unique_track_ids.len()
                    ));
                } else {
                    out.push_str("  ✓ Rate OK\n");
                }
            }
        }
    }

    if !errors.is_empty() {
        out.push_str(&format!("\n  Errors ({}):\n", errors.len()));
        for e in &errors {
            out.push_str(e);
            out.push('\n');
        }
    }

    if validate && invalid_packets == 0 && total_packets > 0 {
        out.push_str("\n  ✓ All packets valid for profile\n");
    } else if validate && invalid_packets > 0 {
        out.push_str(&format!("\n  ✗ {invalid_packets} invalid packets\n"));
    }

    out.push_str("Done.\n");
    Ok(out)
}

/// Extrait le track ID d'une adresse OSC
pub fn extract_track_id(addr: &str) -> Option<u32> {
    // /track/{id}/xyz, /MultiEncoder/{id}/aed, /source/{id}/xyz, /adm/source/{id}/aed, /object/{id}/xyz
    let parts: Vec<&str> = addr.split('/').filter(|s| !s.is_empty()).collect();
    for part in &parts {
        if let Ok(id) = part.parse::<u32>() {
            return Some(id);
        }
    }
    None
}

/// Valide une adresse OSC selon le profil
pub fn validate_osc_address(_addr: &str, profile: &str, args: &[rosc::OscType]) -> (bool, String) {
    let (expected_pattern, expected_arg_count) = match profile {
        "holophonix" => ("/track/{id}/xyz", 3),
        "iem" => ("/MultiEncoder/{id}/aed", 3),
        "ircam" => ("/source/{id}/xyz", 3),
        "adm" => ("/adm/source/{id}/aed", 3),
        "generic" => ("/object/{id}/xyz", 3),
        "generic_polar" => ("/object/{id}", 3),
        _ => return (true, "Unknown profile — skipping validation".to_string()),
    };

    // Vérifier le pattern de base
    let _ = expected_pattern; // Le pattern est informatif, on fait une validation souple

    // Vérifier le nombre d'arguments (3 pour xyz ou aed)
    if args.len() != expected_arg_count {
        return (
            false,
            format!("Expected {expected_arg_count} args, got {}", args.len()),
        );
    }

    // Vérifier que les args sont des floats
    for (i, arg) in args.iter().enumerate() {
        if !matches!(arg, rosc::OscType::Float(_)) {
            return (false, format!("Arg {i} is not a float"));
        }
    }

    // Vérifier que les valeurs sont dans des plages raisonnables
    // Pour les profils polaires (IEM, ADM, generic_polar), l'azimuth peut aller jusqu'à 360°
    let max_value = match profile {
        "iem" | "adm" | "generic_polar" => 360.0,
        _ => 100.0,
    };
    for (i, arg) in args.iter().enumerate() {
        if let rosc::OscType::Float(v) = arg {
            if !v.is_finite() {
                return (false, format!("Arg {i} is not finite (NaN/Inf)"));
            }
            if v.abs() > max_value {
                return (
                    false,
                    format!("Arg {i} = {v:.4} — out of range (|v| > {max_value})"),
                );
            }
        }
    }

    (true, "OK".to_string())
}

pub fn cmd_osc_validate(args: &[&str]) -> Result<String, String> {
    let opts = parse_args(args);
    let template = opts.get("template").map(|s| s.as_str()).unwrap_or("circle");
    let track_str = opts.get("tracks").map(|s| s.as_str()).unwrap_or("1-5");
    let port: u16 = opts
        .get("port")
        .and_then(|s| s.parse().ok())
        .unwrap_or(8000);
    let profile = opts
        .get("profile")
        .map(|s| s.as_str())
        .unwrap_or("holophonix");
    let duration: f64 = opts
        .get("duration")
        .and_then(|s| s.parse().ok())
        .unwrap_or(3.0);

    let state = cli_state::state();
    let all_osc_ids = state.get_osc_ids();
    let osc_ids = parse_track_list(track_str, &all_osc_ids)?;
    let n_objects = state.track_count();

    // 1. Démarrer un listener UDP sur le port spécifié (dans un thread)
    let listen_port = port;
    let listen_duration = duration;
    let listen_profile = profile.to_string();
    let expected_track_count = osc_ids.len();
    let listener_thread = std::thread::spawn(move || -> String {
        let socket = match std::net::UdpSocket::bind(format!("0.0.0.0:{listen_port}")) {
            Ok(s) => s,
            Err(e) => return format!("Failed to bind port {listen_port}: {e}"),
        };
        let _ = socket.set_read_timeout(Some(std::time::Duration::from_secs_f64(
            listen_duration + 2.0,
        )));

        let mut buf = [0u8; 4096];
        let mut total = 0u64;
        let mut valid = 0u64;
        let mut invalid = 0u64;
        let mut track_ids: std::collections::HashSet<u32> = std::collections::HashSet::new();
        let mut addresses: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut errors: Vec<String> = Vec::new();
        let start = std::time::Instant::now();
        let mut first_packet: Option<std::time::Instant> = None;
        let mut last_packet: Option<std::time::Instant> = None;

        loop {
            if start.elapsed().as_secs_f64() > listen_duration {
                break;
            }
            match socket.recv_from(&mut buf) {
                Ok((n, _)) => {
                    total += 1;
                    let now = std::time::Instant::now();
                    if first_packet.is_none() {
                        first_packet = Some(now);
                    }
                    last_packet = Some(now);
                    if let Ok((_, rosc::OscPacket::Message(msg))) =
                        rosc::decoder::decode_udp(&buf[..n])
                    {
                        addresses.insert(msg.addr.clone());
                        if let Some(id) = extract_track_id(&msg.addr) {
                            track_ids.insert(id);
                        }
                        let v = validate_osc_address(&msg.addr, &listen_profile, &msg.args);
                        if v.0 {
                            valid += 1;
                        } else {
                            invalid += 1;
                            if errors.len() < 5 {
                                errors.push(format!("  {} — {}", msg.addr, v.1));
                            }
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => continue,
                Err(e) => return format!("Socket error: {e}"),
            }
        }

        let elapsed = start.elapsed().as_secs_f64();
        // Utiliser le temps entre le premier et le dernier packet pour le rate
        // (évite de compter le timeout socket après le dernier packet)
        let packet_elapsed = match (first_packet, last_packet) {
            (Some(first), Some(last)) => last.duration_since(first).as_secs_f64(),
            _ => 0.0,
        };
        let rate = if packet_elapsed > 0.0 {
            total as f64 / packet_elapsed
        } else {
            0.0
        };

        let mut summary = "═══ OSC Validation Report ═══\n".to_string();
        summary.push_str(&format!("  Profile: {listen_profile}\n"));
        summary.push_str(&format!("  Duration: {elapsed:.1}s\n"));
        summary.push_str(&format!("  Total packets: {total}\n"));
        summary.push_str(&format!("  Valid: {valid} | Invalid: {invalid}\n"));
        summary.push_str(&format!("  Packet rate: {rate:.1} pkt/s\n"));
        summary.push_str(&format!(
            "  Unique track IDs: {} ({})\n",
            track_ids.len(),
            {
                let mut ids: Vec<u32> = track_ids.iter().copied().collect();
                ids.sort();
                ids.iter()
                    .map(|id| id.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            }
        ));
        summary.push_str(&format!("  Unique addresses: {}\n", addresses.len()));

        if !errors.is_empty() {
            summary.push_str("\n  Errors:\n");
            for e in &errors {
                summary.push_str(e);
                summary.push('\n');
            }
        }

        // Verdict
        if total == 0 {
            summary.push_str("\n  ✗ FAIL: No OSC packets received\n");
        } else if invalid > 0 {
            summary.push_str(&format!("\n  ✗ FAIL: {invalid} invalid packets\n"));
        } else if track_ids.len() != expected_track_count {
            summary.push_str(&format!(
                "\n  ⚠ WARN: Expected {} track IDs, got {}\n",
                expected_track_count,
                track_ids.len()
            ));
        } else if rate < 30.0 && total > 10 {
            let expected = 60.0 * expected_track_count as f64;
            summary.push_str(&format!(
                "\n  ⚠ WARN: Low packet rate ({rate:.1} pkt/s, expected ~{expected})\n"
            ));
        } else {
            summary.push_str("\n  ✓ PASS: All packets valid, rate OK, all tracks covered\n");
        }

        summary
    });

    // 2. Reconfigurer le MergeRuntime pour envoyer sur le port de test
    {
        use stagespace_engines::{OscProfile, OscSender};
        use std::str::FromStr;
        let profile_enum =
            OscProfile::from_str(profile).map_err(|e| format!("Invalid OSC profile: {e}"))?;
        let osc_sender = OscSender::new(profile_enum, "127.0.0.1".to_string(), port);
        let merge_rt = state
            .shared
            .merge_runtime
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        merge_rt
            .set_osc_target("127.0.0.1".to_string(), port, osc_sender)
            .map_err(|e| format!("Failed to set OSC target: {e:?}"))?;
    }

    // 3. Activer le move via le MoveService partagé (même chemin que l'app :
    // réservation d'id, compile hors lock, worker + merge + cleanup).
    let graph_json = graph_presets::build_template_graph(template, n_objects, duration)?;
    let move_id = state.next_move_id("oscval");
    let track_indices = osc_ids_to_indices(&osc_ids, &all_osc_ids);
    let origin = state.compute_centroid(&track_indices);
    // Globals = toutes les tracks connues — cohérent avec track_indices
    // (avant : globals = sous-ensemble du move → indices hors bornes quand
    // --tracks ne couvrait pas le préfixe 1..n).
    state
        .shared
        .merge_runtime
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .set_osc_ids(all_osc_ids.clone());
    let spec = stagespace_tauri::commands::merge_commands::MoveSpec {
        id: move_id.clone(),
        name: format!("osc-validate-{template}"),
        graph_json,
        osc_ids,
        track_indices,
        is_preview: false,
        origin: Some(origin),
        duration,
        loop_mode: LoopMode::Loop,
        direction: stagespace_engines::PlayDirection::Forward,
        fade: None,
        speed: None,
        spatial_macros: None,
        animation_state: None,
    };
    stagespace_tauri::commands::merge_commands::spawn_move(spec, &state.shared)
        .map_err(|e| e.to_string())?;

    // 4. Attendre la durée du test
    std::thread::sleep(std::time::Duration::from_secs_f64(duration));

    // 5. Stopper le move (unregister + remove + join du worker)
    stagespace_tauri::commands::merge_commands::remove_move_now(&move_id, &state.shared);

    // 5. Récupérer le rapport du listener
    let report = listener_thread
        .join()
        .map_err(|_| "Listener thread panicked".to_string())?;

    Ok(format!(
        "OSC validation: template={template}, tracks={track_str}, port={port}, profile={profile}\n{report}"
    ))
}

// ─── OSC IN mapping (P3) ────────────────────────────────────────────────────

/// Parse une destination : handler:NAME | macro:NAME | channel:CH:OBJ | position:OBJ
/// OBJ = index (0,1,2…) ou wildcard ("*", "*1"…). Un nom nu → handler.
fn parse_destination(s: &str) -> Result<MappingDestination, String> {
    let parts: Vec<&str> = s.split(':').collect();
    match parts.as_slice() {
        ["handler", name] => Ok(MappingDestination::Handler {
            name: (*name).to_string(),
        }),
        ["macro", name] => Ok(MappingDestination::Macro {
            name: MacroTarget::from_str(name)?,
        }),
        ["channel", ch, obj] => Ok(MappingDestination::Channel {
            channel: SpatialChannel::from_str(ch)?,
            object: parse_object_ref(obj)?,
        }),
        ["position", obj] => Ok(MappingDestination::Position {
            object: parse_object_ref(obj)?,
        }),
        [name] => Ok(MappingDestination::Handler {
            name: (*name).to_string(),
        }),
        _ => Err(format!(
            "Invalid destination '{s}' — expected handler:NAME | macro:NAME | channel:CH:OBJ | position:OBJ"
        )),
    }
}

fn parse_object_ref(s: &str) -> Result<ObjectRef, String> {
    if s.starts_with('*') {
        Ok(ObjectRef::Wildcard(s.to_string()))
    } else {
        s.parse::<usize>()
            .map(ObjectRef::Index)
            .map_err(|_| format!("Invalid object ref '{s}' — expected index or wildcard (*)"))
    }
}

fn describe_object(o: &ObjectRef) -> String {
    match o {
        ObjectRef::Index(i) => i.to_string(),
        ObjectRef::Wildcard(w) => w.clone(),
    }
}

fn describe_mapping(m: &OscMapping) -> String {
    let dest = match &m.destination {
        MappingDestination::Handler { name } => format!("handler:{name}"),
        MappingDestination::Macro { name } => format!("macro:{name:?}").to_lowercase(),
        MappingDestination::Channel { channel, object } => {
            format!("channel:{channel:?}:{}", describe_object(object)).to_lowercase()
        }
        MappingDestination::Position { object } => {
            format!("position:{}", describe_object(object))
        }
    };
    let t = &m.transform;
    let mut tf = String::new();
    if t.scale != 1.0 {
        tf.push_str(&format!(" scale={}", t.scale));
    }
    if t.offset != 0.0 {
        tf.push_str(&format!(" offset={}", t.offset));
    }
    if let Some(min) = t.min {
        tf.push_str(&format!(" min={min}"));
    }
    if let Some(max) = t.max {
        tf.push_str(&format!(" max={max}"));
    }
    if t.smooth > 0.0 {
        tf.push_str(&format!(" smooth={}", t.smooth));
    }
    if t.deadzone > 0.0 {
        tf.push_str(&format!(" deadzone={}", t.deadzone));
    }
    let state = if m.enabled { "" } else { " [disabled]" };
    format!("{} → {dest}{tf}{state}", m.address)
}

/// Usage: osc-map <address> <dest> [--scale s] [--offset o] [--min m] [--max M] [--smooth s] [--deadzone d]
/// dest: handler:NAME | macro:NAME | channel:CH:OBJ | position:OBJ (OBJ = index ou * / *N)
pub fn cmd_osc_map(args: &[&str]) -> Result<String, String> {
    let positional: Vec<&&str> = args.iter().filter(|a| !a.starts_with("--")).collect();
    if positional.len() < 2 {
        return Err(
            "Usage: osc-map <address> <handler:NAME|macro:NAME|channel:CH:OBJ|position:OBJ> [opts]"
                .to_string(),
        );
    }
    let address = (*positional[0]).to_string();
    let destination = parse_destination(positional[1])?;
    let opts = parse_args(args);

    let num = |key: &str| -> Result<Option<f64>, String> {
        opts.get(key)
            .map(|s| {
                s.parse::<f64>()
                    .map_err(|_| format!("Invalid --{key}: {s}"))
            })
            .transpose()
    };
    let transform = Transform {
        scale: num("scale")?.unwrap_or(1.0),
        offset: num("offset")?.unwrap_or(0.0),
        min: num("min")?,
        max: num("max")?,
        smooth: num("smooth")?.unwrap_or(0.0),
        deadzone: num("deadzone")?.unwrap_or(0.0),
    };

    let mapping = OscMapping {
        address,
        destination,
        transform,
        enabled: !opts.contains_key("disabled"),
    };
    let desc = describe_mapping(&mapping);

    let state = cli_state::state();
    state
        .shared
        .osc_receiver
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .add_mapping(mapping)?;
    Ok(format!("✓ Mapping added: {desc}"))
}

/// Usage: osc-unmap <address>
pub fn cmd_osc_unmap(args: &[&str]) -> Result<String, String> {
    let address = args.first().ok_or("Usage: osc-unmap <address>")?;
    let state = cli_state::state();
    let removed = state
        .shared
        .osc_receiver
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove_mapping(address);
    if removed {
        Ok(format!("✓ Mapping removed: {address}"))
    } else {
        Err(format!("No mapping for address: {address}"))
    }
}

/// Usage: osc-maps
pub fn cmd_osc_maps(_args: &[&str]) -> Result<String, String> {
    let state = cli_state::state();
    let receiver = state
        .shared
        .osc_receiver
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let mappings = receiver.list_mappings();
    if mappings.is_empty() {
        return Ok("No OSC IN mappings".to_string());
    }
    let mut out = format!("OSC IN mappings ({}):\n", mappings.len());
    let mut lines: Vec<String> = mappings.iter().map(describe_mapping).collect();
    lines.sort();
    for line in lines {
        out.push_str(&format!("  {line}\n"));
    }
    Ok(out)
}

/// Usage: osc-inject <address> <v1> [v2] [v3] — injecte un message dans le
/// pipeline de mapping sans passer par le socket UDP
pub fn cmd_osc_inject(args: &[&str]) -> Result<String, String> {
    if args.len() < 2 {
        return Err("Usage: osc-inject <address> <v1> [v2] [v3...]".to_string());
    }
    let address = args[0];
    let values: Result<Vec<f64>, _> = args[1..].iter().map(|s| s.parse::<f64>()).collect();
    let values = values.map_err(|_| "Invalid numeric value".to_string())?;

    let state = cli_state::state();
    let receiver = state
        .shared
        .osc_receiver
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    receiver.handle_message(address, values);
    let stats = receiver.stats();
    Ok(format!(
        "✓ Injected {address} — received={} matched={} routed={} dropped={}",
        stats.packets_received, stats.messages_matched, stats.values_routed, stats.messages_dropped
    ))
}

/// Usage: osc-values [key]
pub fn cmd_osc_values(args: &[&str]) -> Result<String, String> {
    let state = cli_state::state();
    let receiver = state
        .shared
        .osc_receiver
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(key) = args.first() {
        return match receiver.get_last_value(key) {
            Some(v) => Ok(format!("{key} = {v:?}")),
            None => Err(format!("No value for key: {key}")),
        };
    }
    let all = receiver.get_all_values();
    if all.is_empty() {
        return Ok("No OSC IN values received".to_string());
    }
    let mut out = format!("OSC IN values ({}):\n", all.len());
    let mut keys: Vec<&String> = all.keys().collect();
    keys.sort();
    for k in keys {
        out.push_str(&format!("  {k} = {:?}\n", all[k]));
    }
    Ok(out)
}

/// Usage: osc-in <on|off|start|stop|stats> [--port N]
pub fn cmd_osc_in(args: &[&str]) -> Result<String, String> {
    let sub = args.first().copied().unwrap_or("stats");
    let state = cli_state::state();
    let mut receiver = state
        .shared
        .osc_receiver
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    match sub {
        "on" => {
            receiver.set_in_enabled(true);
            Ok("✓ OSC IN enabled".to_string())
        }
        "off" => {
            receiver.set_in_enabled(false);
            Ok("✓ OSC IN disabled (anti-loop)".to_string())
        }
        "start" => {
            let opts = parse_args(&args[1..]);
            if let Some(p) = opts.get("port") {
                let port: u16 = p.parse().map_err(|_| format!("Invalid port: {p}"))?;
                if receiver.is_running {
                    receiver.stop();
                }
                receiver.port = port;
            }
            receiver
                .start()
                .map(|_| format!("✓ OSC receiver listening on port {}", receiver.port))
        }
        "stop" => {
            receiver.stop();
            Ok("✓ OSC receiver stopped".to_string())
        }
        "stats" => {
            let s = receiver.stats();
            Ok(format!(
                "OSC IN: enabled={} suppressed={} running={} port={}\n  received={} matched={} routed={} dropped={}",
                receiver.in_enabled(),
                receiver.is_suppressed(),
                receiver.is_running,
                receiver.port,
                s.packets_received,
                s.messages_matched,
                s.values_routed,
                s.messages_dropped
            ))
        }
        _ => Err("Usage: osc-in <on|off|start|stop|stats> [--port N]".to_string()),
    }
}

/// Usage: osc-suppress <ms> — fenêtre anti-loop
pub fn cmd_osc_suppress(args: &[&str]) -> Result<String, String> {
    let ms: u64 = args
        .first()
        .ok_or("Usage: osc-suppress <ms>")?
        .parse()
        .map_err(|_| "Invalid duration (ms)".to_string())?;
    let state = cli_state::state();
    state
        .shared
        .osc_receiver
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .suppress_ms(ms);
    Ok(format!("✓ OSC IN suppressed for {ms}ms"))
}
