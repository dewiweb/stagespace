//! Pont de développement headless : expose le backend Tauri complet
//! (commands IPC + events) au frontend servi par le dev server Vite,
//! sans webview — pour des tests E2E réels pilotés par navigateur.
//!
//! Lancer : `cargo test --test dev_bridge -- --ignored --nocapture`
//! puis injecter côté navigateur le shim `__TAURI_INTERNALS__` qui route
//! `invoke` → `POST http://127.0.0.1:4173/invoke` et les events → SSE
//! `GET http://127.0.0.1:4173/events`.
//!
//! Le pont utilise `tauri::test::get_ipc_response` (MockRuntime) : les
//! commands s'exécutent dans le vrai dispatch IPC avec le vrai AppState —
//! MergeRuntime, OSC, superviseur compris. `event_sink` (agnostique)
//! fait remonter les events backend au navigateur.

#![cfg(test)]

use serde_json::Value;
use stagespace_tauri::{new_app_state, setup_backend_runtime, stagespace_invoke_handler};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{get_ipc_response, mock_context, noop_assets};
use tauri::webview::InvokeRequest;
use tauri::{Listener, WebviewWindowBuilder};

const BIND: &str = "127.0.0.1:4173";

/// Events backend que le frontend écoute — forwarded vers les
/// subscribers SSE tels quels (`listen_any` capte aussi les emits directs
/// `app_handle.emit` du setup : show-control, show-log, timers:cancel).
const EVENTS: &[&str] = &[
    "global-positions",
    "active-moves-update",
    "move-stale-killed",
    "merge-restarted",
    "merge-restart-failed",
    "audio-state-update",
    "audio-error",
    "audio-recovered",
    "osc-armed-changed",
    "cue-stored",
    "cue-recalled",
    "cue-armed",
    "show-control",
    "show-log",
    "timers:cancel",
];

struct Job {
    cmd: String,
    args: Value,
    reply: Sender<Result<Value, Value>>,
}

fn parse_request(
    reader: &mut BufReader<&std::net::TcpStream>,
) -> Option<(String, String, Vec<u8>)> {
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let mut len = 0usize;
    loop {
        let mut h = String::new();
        reader.read_line(&mut h).ok()?;
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                len = v.trim().parse().unwrap_or(0);
            }
        }
    }
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).ok()?;
    Some((method, path, body))
}

fn respond(stream: &mut std::net::TcpStream, status: &str, content_type: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
}

#[test]
#[ignore = "pont de dev interactif — lancer à la demande, vit indéfiniment"]
fn dev_bridge() {
    // NB : le hook `.setup` de Tauri ne s'exécute que via le run-loop
    // (`RuntimeRunEvent::Ready`) — jamais dans une mock app. On appelle
    // donc `setup_backend_runtime` à la main : c'est lui qui branche
    // l'event_sink (global-positions), le receiver OSC et le superviseur.
    let mut app = tauri::Builder::new()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(new_app_state())
        .invoke_handler(stagespace_invoke_handler)
        .build(mock_context(noop_assets()))
        .expect("mock app build failed");
    setup_backend_runtime(&mut app).expect("backend runtime setup failed");

    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("mock webview build failed");
    // Clé IPC générée par l'app — get_ipc_response l'exige identique.
    let invoke_key = app.invoke_key().to_string();

    // Events backend → broadcast vers les subscribers SSE.
    let subscribers: Arc<Mutex<Vec<Sender<Value>>>> = Arc::new(Mutex::new(Vec::new()));
    let (ev_tx, ev_rx) = channel::<Value>();
    for name in EVENTS {
        let tx = ev_tx.clone();
        let tx = tx.clone();
        app.listen_any(*name, move |e| {
            let payload = serde_json::from_str::<Value>(e.payload()).unwrap_or(Value::Null);
            let _ = tx.send(serde_json::json!({ "event": name, "payload": payload }));
        });
    }
    {
        let subscribers = subscribers.clone();
        std::thread::spawn(move || {
            for ev in ev_rx {
                let mut subs = subscribers.lock().unwrap_or_else(|e| e.into_inner());
                subs.retain(|s| s.send(ev.clone()).is_ok());
            }
        });
    }

    // Dispatch IPC sérialisé sur CE thread (le webview mock n'est pas
    // nécessairement Send) — déterministe, une commande à la fois.
    let (job_tx, job_rx) = channel::<Job>();
    std::thread::spawn(move || {
        for job in job_rx {
            let res = get_ipc_response(
                &webview,
                InvokeRequest {
                    cmd: job.cmd,
                    callback: CallbackFn(0),
                    error: CallbackFn(1),
                    url: "tauri://localhost".parse().expect("url"),
                    body: InvokeBody::Json(job.args),
                    headers: Default::default(),
                    invoke_key: invoke_key.clone(),
                },
            )
            .map(|b| match b {
                InvokeResponseBody::Json(s) => {
                    serde_json::from_str::<Value>(&s).unwrap_or(Value::Null)
                }
                InvokeResponseBody::Raw(bytes) => serde_json::json!(bytes),
            });
            let _ = job.reply.send(res);
        }
    });

    let listener = TcpListener::bind(BIND).expect("bridge bind failed");
    eprintln!("[DEV-BRIDGE] backend headless prêt — {BIND}/invoke + /events");

    for conn in listener.incoming() {
        let mut stream = match conn {
            Ok(s) => s,
            Err(_) => continue,
        };
        let job_tx = job_tx.clone();
        let subscribers = subscribers.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(&stream);
            let req = match parse_request(&mut reader) {
                Some(r) => r,
                None => return,
            };
            let (method, path, body) = req;
            if method == "OPTIONS" {
                respond(&mut stream, "204 No Content", "text/plain", &[]);
                return;
            }
            if method == "GET" && path == "/events" {
                // SSE — le writer vit tant que le client lit.
                let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\n\r\n";
                if stream.write_all(head.as_bytes()).is_err() {
                    return;
                }
                let (tx, rx): (Sender<Value>, Receiver<Value>) = channel();
                subscribers
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .push(tx);
                for ev in rx {
                    let frame = format!("data: {ev}\n\n");
                    if stream.write_all(frame.as_bytes()).is_err() {
                        break;
                    }
                    let _ = stream.flush();
                }
                return;
            }
            if method == "POST" && path == "/invoke" {
                let parsed: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
                let cmd = parsed["cmd"].as_str().unwrap_or("").to_string();
                let args = parsed["args"].clone();
                let (reply_tx, reply_rx) = channel();
                if job_tx
                    .send(Job {
                        cmd,
                        args,
                        reply: reply_tx,
                    })
                    .is_err()
                {
                    respond(
                        &mut stream,
                        "500 Internal Server Error",
                        "application/json",
                        b"{}",
                    );
                    return;
                }
                let out = match reply_rx.recv() {
                    Ok(Ok(v)) => serde_json::json!({ "ok": v }),
                    Ok(Err(e)) => serde_json::json!({ "err": e }),
                    Err(_) => {
                        serde_json::json!({ "err": { "code": "bridge", "message": "dispatch failed" } })
                    }
                };
                respond(
                    &mut stream,
                    "200 OK",
                    "application/json",
                    out.to_string().as_bytes(),
                );
                return;
            }
            respond(&mut stream, "404 Not Found", "text/plain", b"not found");
        });
    }
}
