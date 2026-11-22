//! Remote-UI bridge : sert l'IPC du backend (commands + events) sur
//! HTTP+SSE pour le frontend React dans un navigateur — cohabite avec
//! l'UI desktop (webview), même `AppState`, même `MergeRuntime`.
//!
//! - `POST /invoke {cmd,args}` → `webview.on_message` sur le webview
//!   `main` : le vrai dispatch IPC, comme la webview desktop.
//! - `GET /events` → SSE : `app.listen_any` re-broadcasté, multi-clients.
//!
//! In-app : `spawn_if_enabled` depuis `.setup()` — opt-in via
//! `STAGESPACE_BRIDGE_BIND` (ex. `127.0.0.1:4173` local,
//! `0.0.0.0:4173` LAN — aucune auth : tunnel SSH hors LAN de confiance).
//! Tests : `tests/dev_bridge.rs` réutilise `serve`/`EVENTS` sur une
//! mock app headless.

use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse, InvokeResponseBody};
use tauri::webview::InvokeRequest;
use tauri::{AppHandle, Listener, Manager, Runtime, WebviewWindow};

/// Events backend forwardés aux clients SSE — doit couvrir tout event
/// écouté par le frontend (ajouter ici tout nouvel emit).
pub const EVENTS: &[&str] = &[
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

pub const ENV_BIND: &str = "STAGESPACE_BRIDGE_BIND";

/// Dispatch d'une commande IPC : (cmd, args) → réponse sérialisée ou
/// erreur Tauri. Fourni par l'appelant (app réelle ou mock de test).
pub type Dispatch = Arc<dyn Fn(String, Value) -> Result<Value, Value> + Send + Sync>;

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

/// Boucle HTTP+SSE bloquante — spawnée par l'appelant (thread dédié).
/// `events` reçoit `{"event": name, "payload": …}` pré-formatés.
pub fn serve(bind: &str, dispatch: Dispatch, events: Receiver<Value>) -> std::io::Result<()> {
    let subscribers: Arc<Mutex<Vec<Sender<Value>>>> = Arc::new(Mutex::new(Vec::new()));
    {
        let subscribers = subscribers.clone();
        std::thread::spawn(move || {
            for ev in events {
                let mut subs = subscribers.lock().unwrap_or_else(|e| e.into_inner());
                subs.retain(|s| s.send(ev.clone()).is_ok());
            }
        });
    }

    let listener = TcpListener::bind(bind)?;
    eprintln!("[BRIDGE] remote UI ready — {bind}/invoke + /events");

    for conn in listener.incoming() {
        let mut stream = match conn {
            Ok(s) => s,
            Err(_) => continue,
        };
        let dispatch = dispatch.clone();
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
                let out = match dispatch(cmd, args) {
                    Ok(v) => serde_json::json!({ "ok": v }),
                    Err(e) => serde_json::json!({ "err": e }),
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
    Ok(())
}

/// Dispatch IPC sérialisé via `webview.on_message` — le point d'entrée
/// réel des messages IPC des webviews (`get_ipc_response` n'est qu'un
/// wrapper MockRuntime de cet appel). Le webview est détenu par le
/// thread dispatch : jobs sur channel, une commande à la fois,
/// déterministe. Partagé app réelle (`Wry`) et mock (`MockRuntime`).
pub fn ipc_dispatch<R: Runtime>(
    webview: WebviewWindow<R>,
    invoke_key: String,
) -> Result<Dispatch, String> {
    let url: tauri::Url = "tauri://localhost"
        .parse()
        .map_err(|e| format!("bridge url parse: {e}"))?;
    let (job_tx, job_rx) = channel::<Job>();
    std::thread::spawn(move || {
        for job in job_rx {
            let (tx, rx) = std::sync::mpsc::sync_channel(1);
            webview.clone().on_message(
                InvokeRequest {
                    cmd: job.cmd,
                    callback: CallbackFn(0),
                    error: CallbackFn(1),
                    url: url.clone(),
                    body: InvokeBody::Json(job.args),
                    headers: Default::default(),
                    invoke_key: invoke_key.clone(),
                },
                Box::new(move |_wv, _cmd, response, _callback, _error| {
                    let _ = tx.send(response);
                }),
            );
            let res = match rx.recv() {
                Ok(InvokeResponse::Ok(b)) => Ok(match b {
                    InvokeResponseBody::Json(s) => {
                        serde_json::from_str::<Value>(&s).unwrap_or(Value::Null)
                    }
                    InvokeResponseBody::Raw(bytes) => serde_json::json!(bytes),
                }),
                Ok(InvokeResponse::Err(e)) => Err(e.0),
                Err(_) => Err(serde_json::json!({
                    "code": "bridge", "message": "no ipc response"
                })),
            };
            let _ = job.reply.send(res);
        }
    });
    Ok(Arc::new(move |cmd, args| {
        let (reply_tx, reply_rx) = channel();
        if job_tx
            .send(Job {
                cmd,
                args,
                reply: reply_tx,
            })
            .is_err()
        {
            return Err(
                serde_json::json!({ "code": "bridge", "message": "dispatch channel closed" }),
            );
        }
        match reply_rx.recv() {
            Ok(res) => res,
            Err(_) => Err(serde_json::json!({ "code": "bridge", "message": "dispatch failed" })),
        }
    }))
}

/// Events backend → channel pré-formaté `{event, payload}` pour `serve`.
pub fn event_forwarder<R: Runtime>(app: &AppHandle<R>) -> Receiver<Value> {
    let (ev_tx, ev_rx) = channel::<Value>();
    for name in EVENTS {
        let tx = ev_tx.clone();
        app.listen_any(*name, move |e| {
            let payload = serde_json::from_str::<Value>(e.payload()).unwrap_or(Value::Null);
            let _ = tx.send(serde_json::json!({ "event": name, "payload": payload }));
        });
    }
    ev_rx
}

/// Opt-in par `STAGESPACE_BRIDGE_BIND` — off par défaut. Échec = log,
/// jamais fatal (le bridge ne doit pas pouvoir tuer l'app).
pub fn spawn_if_enabled(app: &AppHandle) {
    let Ok(bind) = std::env::var(ENV_BIND) else {
        return;
    };
    if bind.is_empty() {
        return;
    }
    match spawn(app, &bind) {
        Ok(()) => eprintln!("[BRIDGE] remote UI enabled on {bind} — no auth, trusted network only"),
        Err(e) => eprintln!("[BRIDGE] remote UI disabled — {e}"),
    }
}

fn spawn(app: &AppHandle, bind: &str) -> Result<(), String> {
    let webview = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview not found".to_string())?;
    let dispatch = ipc_dispatch(webview, app.invoke_key().to_string())?;
    let events = event_forwarder(app);
    let bind = bind.to_string();
    std::thread::spawn(move || {
        if let Err(e) = serve(&bind, dispatch, events) {
            eprintln!("[BRIDGE] serve stopped: {e}");
        }
    });
    Ok(())
}
