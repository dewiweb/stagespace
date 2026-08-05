//! STAGESPACE CLI — outil de test du workflow métier sans UI.
//!
//! Le CLI est un processus unique qui lit des commandes depuis stdin ou
//! depuis un fichier script. L'état (MergeRuntime, workers) persiste en
//! mémoire entre les commandes.
//!
//! Usage interactif :
//!   stagespace-cli
//!   > import-hol test.hol
//!   > list-tracks
//!   > activate-move circle --tracks 1,2,3,4,5
//!   > sample --move circle --obj 0 --samples 10
//!   > stop-all
//!   > quit
//!
//! Usage script (pour tests E2E) :
//!   stagespace-cli < script.txt
//!   stagespace-cli --file script.txt
//!
//! Usage one-liner :
//!   echo "activate-move circle --tracks 1-5; sample --obj 0; stop-all" | stagespace-cli

mod cli_state;
mod commands;
mod graph_presets;

use std::io::{self, BufRead, Write};

fn main() -> std::process::ExitCode {
    let args: Vec<String> = std::env::args().collect();

    // --file <path> : lire les commandes depuis un fichier
    let script_lines: Option<Vec<String>> = if args.len() >= 3 && args[1] == "--file" {
        match std::fs::read_to_string(&args[2]) {
            Ok(content) => Some(content.lines().map(|l| l.to_string()).collect()),
            Err(e) => {
                eprintln!("Error reading script file: {e}");
                return std::process::ExitCode::from(1);
            }
        }
    } else if args.len() == 1 {
        // Pas d'args : mode interactif (stdin)
        None
    } else {
        // Args directs : traiter comme une seule ligne de commandes
        // stagespace-cli "activate-move circle; sample; stop-all"
        // ou
        // stagespace-cli activate-move circle --tracks 1-5
        let joined = args[1..].join(" ");
        Some(vec![joined])
    };

    let stdout = io::stdout();
    let mut out = stdout.lock();

    // Si on a un script, l'exécuter
    if let Some(lines) = script_lines {
        for line in lines {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            // Une ligne peut contenir plusieurs commandes séparées par ;
            for cmd in line.split(';') {
                let cmd = cmd.trim();
                if cmd.is_empty() {
                    continue;
                }
                writeln!(&mut out, "› {cmd}").ok();
                match commands::dispatch(cmd) {
                    Ok(output) => {
                        if !output.is_empty() {
                            writeln!(&mut out, "{output}").ok();
                        }
                    }
                    Err(e) => {
                        writeln!(&mut out, "✗ {e}").ok();
                        return std::process::ExitCode::from(1);
                    }
                }
            }
        }
        return std::process::ExitCode::from(0);
    }

    // Mode interactif (REPL)
    writeln!(
        &mut out,
        "STAGESPACE CLI — type 'help' for commands, 'quit' to exit"
    )
    .ok();
    let stdin = io::stdin();
    loop {
        write!(&mut out, "› ").ok();
        out.flush().ok();
        let mut line = String::new();
        if stdin.lock().read_line(&mut line).unwrap_or(0) == 0 {
            break; // EOF
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if line == "quit" || line == "exit" {
            break;
        }
        if line == "help" {
            commands::print_help(&mut out);
            continue;
        }
        match commands::dispatch(line) {
            Ok(output) => {
                if !output.is_empty() {
                    writeln!(&mut out, "{output}").ok();
                }
            }
            Err(e) => {
                writeln!(&mut out, "✗ {e}").ok();
            }
        }
    }

    // Cleanup : stop all moves
    let _ = commands::dispatch("stop-all");

    std::process::ExitCode::from(0)
}
