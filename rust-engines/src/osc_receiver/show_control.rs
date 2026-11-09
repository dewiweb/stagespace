//! Show control `/stagespace/*` — extrait de osc_receiver.rs (Phase 5).
//! Commande + parsing adresses/args (pas de dispatch — dans pipeline.rs).

use super::*;

/// Commande show-control reçue via `/stagespace/*` — transmise telle
/// quelle au frontend qui la dispatche vers les mêmes fonctions que
/// les raccourcis clavier (backend = routeur seulement).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
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
    /// `/stagespace/unsolo` — rejoue les slots stoppés par le dernier solo.
    Unsolo,
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
    /// `/stagespace/position <obj> <x> <y> <z>` — position manuelle
    /// prioritaire (reprise opérateur depuis la console — drag sans GUI).
    SetPosition(usize, f64, f64, f64),
    /// `/stagespace/position/clear <obj>` — retire la position manuelle.
    ClearPosition(usize),
    /// `/stagespace/position/clearall` — retire toutes les positions.
    ClearAllPositions,
    /// `/stagespace/trackpos <track> <x> <y> <z>` — position d'origine
    /// d'une track (où panic renvoie, base du Barycenter — équivalent
    /// à l'import .hol pour un contrôleur externe).
    SetTrackPosition(u32, f64, f64, f64),
    /// `/stagespace/panic` — Esc panic.
    Panic,
    /// `/stagespace/stop` — stop tous les moves.
    Stop,
    /// `/stagespace/timecode <seconds | "HH:MM:SS:FF">` — secondes.
    Timecode(f64),
    /// `/stagespace/soundcheck [start|stop|next|prev]` — ping séquentiel
    /// par track (identification spatiale en repère). Défaut = start.
    Soundcheck(Option<String>),
    /// `/stagespace/throw <obj> <vx> <vy> <vz>` — grab & throw : lance
    /// l'objet avec une vélocité initiale (m/s), amortissement au repos.
    Throw(usize, f64, f64, f64),
    /// `/stagespace/spatial <k>` — dynamique spatiale : compresseur
    /// spatial global (k<1 resserre le champ, k>1 l'étend).
    Spatial(f64),
    /// `/stagespace/attention <obj>` — fige tous les autres objets
    /// (change blindness : un seul bouge, capte toute l'attention).
    /// `/stagespace/attention/clear` — libère la stase.
    Attention(Option<usize>),
    /// `/stagespace/gesture <name> [strength]` — explode/converge/orbit/
    /// front : vélocité calculée par objet via la balistique `thrown`.
    Gesture(String, f64),
    /// `/stagespace/rehearsal <record|stop|play|clear>` — capture de
    /// répétition : bande de commandes horodatée du busking, rejouée.
    Rehearsal(String),
    /// `/stagespace/cue/arm <n>` — arme une cue sans la tirer (modèle
    /// console : arm/nav ne tirent jamais, go tire l'armée).
    CueArm(String),
    /// `/stagespace/cue/go` — tire la cue armée, ou la suivante si rien
    /// d'armé — parité avec le GO de la surface conduite.
    CueGo,
    /// `/stagespace/macro <name> <v>` — macro globale : speed, scale,
    /// shift_x/y/z, yaw, pitch, roll, radius_scale, height_offset.
    Macro(String, f64),
    /// `/stagespace/timecode/chase <0|1>` — chase TC on/off (frontend).
    TimecodeChase(bool),
    /// `/stagespace/timecode/fps <n>` — fps du format HH:MM:SS:FF.
    TimecodeFps(f64),
    /// `/stagespace/positions` — dump des positions émises : le demandeur
    /// reçoit `/stagespace/pos/state <obj> <x> <y> <z>` par objet, répondu
    /// par le backend même sans webview.
    PositionsQuery,
    /// `/stagespace/view <surface>` — bascule la surface opérateur
    /// (atelier|conduite|jeu) : un contrôleur externe peut changer
    /// la vue de l'écran (dispatch frontend — le backend ne fait que router).
    View(String),
}

pub(crate) type ShowSink = Arc<dyn Fn(ShowCommand, std::net::SocketAddr) + Send + Sync>;

pub(crate) const MAX_CONTROLLERS: usize = 4;

/// Parse un message `/stagespace/*` (args bruts — strings préservées).
/// `fps` = frames/s pour la forme string `HH:MM:SS:FF` du timecode.
pub(crate) fn parse_show_command(addr: &str, args: &[OscType], fps: f64) -> Option<ShowCommand> {
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
                OscType::Long(v) => Some(*v as f64),
                OscType::Double(v) => Some(*v),
                OscType::String(s) => s.parse::<f64>().ok(),
                _ => None,
            });
            Some(ShowCommand::CueRecall(id, fade))
        }
        "cue/arm" => args
            .first()
            .and_then(|a| match a {
                OscType::String(s) => Some(s.clone()),
                OscType::Int(i) => Some(i.to_string()),
                OscType::Long(i) => Some(i.to_string()),
                OscType::Float(f) => Some(format!("{f}")),
                OscType::Double(f) => Some(format!("{f}")),
                _ => None,
            })
            .map(ShowCommand::CueArm),
        "cue/go" => Some(ShowCommand::CueGo),
        "macro" => {
            let name = args.first().and_then(|a| match a {
                OscType::String(s) => Some(s.clone()),
                _ => None,
            })?;
            let v = args.get(1).and_then(|a| match a {
                OscType::Float(v) => Some(*v as f64),
                OscType::Double(v) => Some(*v),
                OscType::Int(v) => Some(*v as f64),
                OscType::Long(v) => Some(*v as f64),
                OscType::String(s) => s.parse::<f64>().ok(),
                _ => None,
            })?;
            Some(ShowCommand::Macro(name, v))
        }
        "timecode/chase" => args
            .first()
            .and_then(|a| match a {
                OscType::Int(v) => Some(*v != 0),
                OscType::Long(v) => Some(*v != 0),
                OscType::Float(v) => Some(*v != 0.0),
                OscType::Double(v) => Some(*v != 0.0),
                OscType::String(s) => match s.as_str() {
                    "1" | "on" | "true" => Some(true),
                    "0" | "off" | "false" => Some(false),
                    _ => None,
                },
                _ => None,
            })
            .map(ShowCommand::TimecodeChase),
        "timecode/fps" => args
            .first()
            .and_then(|a| match a {
                OscType::Float(v) => Some(*v as f64),
                OscType::Double(v) => Some(*v),
                OscType::Int(v) => Some(*v as f64),
                OscType::Long(v) => Some(*v as f64),
                OscType::String(s) => s.parse::<f64>().ok(),
                _ => None,
            })
            .map(ShowCommand::TimecodeFps),
        "positions" => Some(ShowCommand::PositionsQuery),
        "view" => args
            .first()
            .and_then(|a| match a {
                OscType::String(s) => Some(s.clone()),
                OscType::Int(i) => Some(i.to_string()),
                OscType::Long(i) => Some(i.to_string()),
                _ => None,
            })
            .map(ShowCommand::View),
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
        "unsolo" => Some(ShowCommand::Unsolo),
        "position" | "position/clear" | "position/clearall" | "trackpos" => {
            let index_arg = |a: &OscType| match a {
                OscType::Float(v) => Some(*v as usize),
                OscType::Int(v) => Some((*v).max(0) as usize),
                OscType::String(s) => s.parse::<usize>().ok(),
                _ => None,
            };
            let coord_arg = |a: &OscType| match a {
                OscType::Float(v) => Some(*v as f64),
                OscType::Double(v) => Some(*v),
                OscType::Int(v) => Some(*v as f64),
                OscType::Long(v) => Some(*v as f64),
                OscType::String(s) => s.parse::<f64>().ok(),
                _ => None,
            };
            match tail {
                "position/clearall" => Some(ShowCommand::ClearAllPositions),
                "position/clear" => args
                    .first()
                    .and_then(index_arg)
                    .map(ShowCommand::ClearPosition),
                "position" => {
                    let obj = args.first().and_then(index_arg)?;
                    let x = args.get(1).and_then(coord_arg)?;
                    let y = args.get(2).and_then(coord_arg)?;
                    let z = args.get(3).and_then(coord_arg)?;
                    Some(ShowCommand::SetPosition(obj, x, y, z))
                }
                "trackpos" => {
                    let track = args.first().and_then(index_arg)? as u32;
                    let x = args.get(1).and_then(coord_arg)?;
                    let y = args.get(2).and_then(coord_arg)?;
                    let z = args.get(3).and_then(coord_arg)?;
                    Some(ShowCommand::SetTrackPosition(track, x, y, z))
                }
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
        "soundcheck" => {
            let action = args.first().and_then(|a| match a {
                OscType::String(s) => Some(s.clone()),
                OscType::Int(i) => Some(i.to_string()),
                _ => None,
            });
            Some(ShowCommand::Soundcheck(action))
        }
        "throw" => {
            let obj = args.first().and_then(|a| match a {
                OscType::Int(i) => Some(*i as usize),
                OscType::Float(f) => Some(*f as usize),
                _ => None,
            })?;
            let get = |i: usize| match args.get(i) {
                Some(OscType::Float(f)) => Some(*f as f64),
                Some(OscType::Double(d)) => Some(*d),
                Some(OscType::Int(n)) => Some(*n as f64),
                _ => None,
            };
            Some(ShowCommand::Throw(obj, get(1)?, get(2)?, get(3)?))
        }
        "spatial" => {
            let k = args.first().and_then(|a| match a {
                OscType::Float(f) => Some(*f as f64),
                OscType::Double(d) => Some(*d),
                OscType::Int(i) => Some(*i as f64),
                _ => None,
            })?;
            Some(ShowCommand::Spatial(k))
        }
        "attention" => {
            let obj = args.first().and_then(|a| match a {
                OscType::Int(i) => Some(*i as usize),
                OscType::Float(f) => Some(*f as usize),
                _ => None,
            });
            Some(ShowCommand::Attention(obj))
        }
        "attention/clear" => Some(ShowCommand::Attention(None)),
        "gesture" => {
            let name = args.first().and_then(|a| match a {
                OscType::String(s) => Some(s.clone()),
                _ => None,
            })?;
            let strength = args
                .get(1)
                .and_then(|a| match a {
                    OscType::Float(f) => Some(*f as f64),
                    OscType::Double(d) => Some(*d),
                    OscType::Int(i) => Some(*i as f64),
                    _ => None,
                })
                .unwrap_or(3.0);
            Some(ShowCommand::Gesture(name, strength))
        }
        "rehearsal" | "record" => {
            let action = args.first().and_then(|a| match a {
                OscType::String(s) => Some(s.clone()),
                _ => None,
            })?;
            Some(ShowCommand::Rehearsal(
                if tail == "record" && action == "start" {
                    "record".to_string()
                } else {
                    action
                },
            ))
        }
        _ => None,
    }
}

/// `HH:MM:SS:FF` → secondes (non-drop : FF = frames à `fps` fps).
pub(crate) fn parse_timecode_string(s: &str, fps: f64) -> Option<f64> {
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
