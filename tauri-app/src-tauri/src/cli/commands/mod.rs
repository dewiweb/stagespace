//! Dispatch des commandes CLI — chaque commande retourne un string de sortie.

mod helpers;
mod hol;
mod moves;
mod osc;
mod sample;

use hol::{cmd_import_hol, cmd_list_tracks};
use moves::{
    cmd_activate_move, cmd_clear_channel, cmd_kin_smoothing, cmd_list_moves, cmd_mod_add,
    cmd_mod_clear, cmd_mod_list, cmd_set_channel, cmd_set_macros, cmd_set_merge_strategy,
    cmd_set_move_speed, cmd_stop_all, cmd_stop_move,
};
use osc::{
    cmd_osc_in, cmd_osc_inject, cmd_osc_listen, cmd_osc_map, cmd_osc_maps, cmd_osc_suppress,
    cmd_osc_unmap, cmd_osc_validate, cmd_osc_values,
};
use sample::{cmd_perf, cmd_sample, cmd_templates};

use std::io::Write;

/// Dispatch principal
pub fn dispatch(input: &str) -> Result<String, String> {
    // Initialiser l'état si pas déjà fait
    crate::cli_state::init_state()?;

    let parts: Vec<&str> = input.split_whitespace().collect();
    if parts.is_empty() {
        return Ok(String::new());
    }

    let cmd = parts[0];
    let rest = &parts[1..];

    match cmd {
        "import-hol" => cmd_import_hol(rest),
        "list-tracks" => cmd_list_tracks(rest),
        "activate-move" | "activate" => cmd_activate_move(rest),
        "list-moves" | "moves" => cmd_list_moves(rest),
        "sample" => cmd_sample(rest),
        "set-macros" | "macros" => cmd_set_macros(rest),
        "set-merge-strategy" | "merge-strategy" => cmd_set_merge_strategy(rest),
        "set-move-speed" | "move-speed" => cmd_set_move_speed(rest),
        "set-channel" | "channel" => cmd_set_channel(rest),
        "clear-channel" => cmd_clear_channel(rest),
        "mod-add" => cmd_mod_add(rest),
        "mod-list" => cmd_mod_list(rest),
        "mod-clear" => cmd_mod_clear(rest),
        "kin-smoothing" => cmd_kin_smoothing(rest),
        "stop-move" => cmd_stop_move(rest),
        "stop-all" => cmd_stop_all(rest),
        "osc-listen" | "osc-listen-validate" => cmd_osc_listen(rest),
        "osc-validate" => cmd_osc_validate(rest),
        "osc-map" => cmd_osc_map(rest),
        "osc-unmap" => cmd_osc_unmap(rest),
        "osc-maps" => cmd_osc_maps(rest),
        "osc-inject" => cmd_osc_inject(rest),
        "osc-values" => cmd_osc_values(rest),
        "osc-in" => cmd_osc_in(rest),
        "osc-suppress" => cmd_osc_suppress(rest),
        "perf" | "stats" => cmd_perf(rest),
        "templates" => cmd_templates(rest),
        "help" => {
            print_help(&mut std::io::stdout().lock());
            Ok(String::new())
        }
        _ => Err(format!(
            "Unknown command: '{cmd}'. Type 'help' for available commands."
        )),
    }
}

pub fn print_help(out: &mut impl Write) {
    writeln!(out, "Available commands:").ok();
    writeln!(
        out,
        "  import-hol <file.hol>              Import Holophonix project"
    )
    .ok();
    writeln!(
        out,
        "  list-tracks                        List tracks from imported .hol"
    )
    .ok();
    writeln!(out, "  activate-move <template> [opts]    Activate a move").ok();
    writeln!(
        out,
        "  list-moves                         List active moves"
    )
    .ok();
    writeln!(
        out,
        "  sample --move <id> [opts]          Sample trajectory positions"
    )
    .ok();
    writeln!(
        out,
        "  set-macros [opts]                  Set global spatial macros"
    )
    .ok();
    writeln!(
        out,
        "  set-merge-strategy <strategy>      Set merge strategy"
    )
    .ok();
    writeln!(
        out,
        "  set-move-speed <id> <speed>        Set per-move speed"
    )
    .ok();
    writeln!(
        out,
        "  set-channel <obj> <ch> <val>       Set spatial channel (gain|spread|distance|presence|yaw|aperture|lfe)"
    )
    .ok();
    writeln!(
        out,
        "  clear-channel <obj|all> [ch]       Clear spatial channel(s)"
    )
    .ok();
    writeln!(
        out,
        "  mod-add <src> <ch> <scale> [..]    Add kinematic modulation (speed|accel|jerk → channel)"
    )
    .ok();
    writeln!(out, "  mod-list                           List modulations").ok();
    writeln!(out, "  mod-clear <index|all>              Remove modulation(s)").ok();
    writeln!(
        out,
        "  kin-smoothing <0-0.99>             Set kinematic smoothing"
    )
    .ok();
    writeln!(out, "  stop-move <id>                     Stop a move").ok();
    writeln!(out, "  stop-all                           Stop all moves").ok();
    writeln!(
        out,
        "  osc-listen --port <port>           Listen for OSC packets"
    )
    .ok();
    writeln!(
        out,
        "  osc-validate [opts]                Activate move + validate OSC output"
    )
    .ok();
    writeln!(
        out,
        "  osc-map <addr> <dest> [opts]       Map OSC IN → handler:NAME|macro:NAME|channel:CH:OBJ|position:OBJ"
    )
    .ok();
    writeln!(out, "  osc-unmap <addr>                   Remove OSC IN mapping").ok();
    writeln!(out, "  osc-maps                           List OSC IN mappings").ok();
    writeln!(
        out,
        "  osc-inject <addr> <v...>           Inject OSC message into mapping pipeline"
    )
    .ok();
    writeln!(out, "  osc-values [key]                   Show OSC IN last values").ok();
    writeln!(
        out,
        "  osc-in <on|off|start|stop|stats>   Control OSC IN receiver"
    )
    .ok();
    writeln!(
        out,
        "  osc-suppress <ms>                  Anti-loop suppression window"
    )
    .ok();
    writeln!(
        out,
        "  perf                               Show performance stats"
    )
    .ok();
    writeln!(
        out,
        "  templates                          List shape templates"
    )
    .ok();
    writeln!(out, "  quit                               Exit CLI").ok();
}
