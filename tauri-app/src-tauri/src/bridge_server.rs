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
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse, InvokeResponseBody};
use tauri::webview::InvokeRequest;
use tauri::{AppHandle, EventId, Listener, Manager, Runtime, WebviewWindow};

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
    "show-state-changed",
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
/// `shutdown` : arrêt propre demandé par `RemoteUi::stop` — l'accept
/// loop, le broadcast et les writers SSE sortent tous (sinon les
/// senders survivraient à leur propre Arc : cycle d'auto-référence).
/// Le listener est bindé par l'appelant : une erreur de bind (port
/// occupé, adresse invalide) remonte à l'appelant au lieu de mourir
/// dans le thread en laissant croire que le serveur tourne.
pub fn serve(
    listener: TcpListener,
    dispatch: Dispatch,
    events: Receiver<Value>,
    shutdown: Arc<AtomicBool>,
) -> std::io::Result<()> {
    let subscribers: Arc<Mutex<Vec<Sender<Value>>>> = Arc::new(Mutex::new(Vec::new()));
    {
        let subscribers = subscribers.clone();
        let sd = shutdown.clone();
        std::thread::spawn(move || loop {
            match events.recv_timeout(Duration::from_millis(50)) {
                Ok(ev) => {
                    let mut subs = subscribers.lock().unwrap_or_else(|e| e.into_inner());
                    subs.retain(|s| s.send(ev.clone()).is_ok());
                }
                Err(RecvTimeoutError::Timeout) => {
                    if sd.load(Ordering::SeqCst) {
                        return;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => return,
            }
        });
    }

    listener.set_nonblocking(true)?;
    eprintln!(
        "[BRIDGE] remote UI ready — {}/invoke + /events",
        listener
            .local_addr()
            .map(|a| a.to_string())
            .unwrap_or_default()
    );

    while !shutdown.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let dispatch = dispatch.clone();
                let subscribers = subscribers.clone();
                let sd = shutdown.clone();
                std::thread::spawn(move || {
                    handle_conn(&mut stream, dispatch, subscribers, sd);
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_) => continue,
        }
    }
    Ok(())
}

fn handle_conn(
    stream: &mut TcpStream,
    dispatch: Dispatch,
    subscribers: Arc<Mutex<Vec<Sender<Value>>>>,
    shutdown: Arc<AtomicBool>,
) {
    let mut reader = BufReader::new(&*stream);
    let req = match parse_request(&mut reader) {
        Some(r) => r,
        None => return,
    };
    let (method, path, body) = req;
    if method == "OPTIONS" {
        respond(stream, "204 No Content", "text/plain", &[]);
        return;
    }
    if method == "GET" && path == "/events" {
        // SSE — le writer vit tant que le client lit, ou jusqu'à shutdown.
        let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\n\r\n";
        if stream.write_all(head.as_bytes()).is_err() {
            return;
        }
        let (tx, rx): (Sender<Value>, Receiver<Value>) = channel();
        subscribers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(tx);
        loop {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(ev) => {
                    let frame = format!("data: {ev}\n\n");
                    if stream.write_all(frame.as_bytes()).is_err() {
                        break;
                    }
                    let _ = stream.flush();
                }
                Err(RecvTimeoutError::Timeout) => {
                    if shutdown.load(Ordering::SeqCst) {
                        break;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
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
            stream,
            "200 OK",
            "application/json",
            out.to_string().as_bytes(),
        );
        return;
    }
    respond(stream, "404 Not Found", "text/plain", b"not found");
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
    // Origine "locale" attendue par `is_local_url` : `http://tauri.localhost`
    // sous Windows/Android (custom protocol = http://<name>.localhost),
    // `tauri://localhost` ailleurs. Une URL non-locale bascule l'origine en
    // Remote → le gate ACL refuse toutes les commandes ("not allowed").
    let url: tauri::Url = if cfg!(any(windows, target_os = "android")) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    }
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
/// Version "feu et oublie" pour le dev-bridge headless (vit indéfiniment,
/// pas besoin d'unlisten). Le RemoteUi in-app enregistre les siens avec
/// unlisten au stop.
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

struct RunningBridge {
    bind: String,
    shutdown: Arc<AtomicBool>,
    listeners: Vec<EventId>,
}

/// État remote-UI dans AppState — serveur bridge start/stop à chaud.
/// `webview` (la `main`, posée au setup) est la cible du dispatch IPC ;
/// None en headless/mock → `start` refuse poliment.
#[derive(Default)]
pub struct RemoteUi {
    pub webview: Option<WebviewWindow>,
    server: Option<RunningBridge>,
}

impl Drop for RemoteUi {
    fn drop(&mut self) {
        self.stop();
    }
}

impl RemoteUi {
    pub fn is_running(&self) -> bool {
        self.server.is_some()
    }

    pub fn bind(&self) -> Option<&str> {
        self.server.as_ref().map(|s| s.bind.as_str())
    }

    pub fn start(&mut self, bind: &str) -> Result<(), String> {
        if self.server.as_ref().is_some_and(|s| s.bind == bind) {
            return Ok(()); // déjà sur ce bind — no-op
        }
        let webview = self
            .webview
            .clone()
            .ok_or_else(|| "remote UI unavailable (headless backend)".to_string())?;
        let app = webview.app_handle().clone();
        let dispatch = ipc_dispatch(webview, app.invoke_key().to_string())?;
        // Bind synchrone AVANT le teardown : un port occupé ou une
        // adresse invalide remonte en erreur à l'appelant (set_remote_ui
        // → toast, spawn_if_enabled → retry) sans tuer un serveur qui
        // tourne, et `is_running` ne peut plus mentir.
        let listener = TcpListener::bind(bind).map_err(|e| format!("cannot bind {bind}: {e}"))?;
        self.stop();
        let (ev_tx, ev_rx) = channel::<Value>();
        let mut listeners = Vec::with_capacity(EVENTS.len());
        for name in EVENTS {
            let tx = ev_tx.clone();
            let id = app.listen_any(*name, move |e| {
                let payload = serde_json::from_str::<Value>(e.payload()).unwrap_or(Value::Null);
                let _ = tx.send(serde_json::json!({ "event": name, "payload": payload }));
            });
            listeners.push(id);
        }
        let shutdown = Arc::new(AtomicBool::new(false));
        let sd = shutdown.clone();
        std::thread::spawn(move || {
            if let Err(e) = serve(listener, dispatch, ev_rx, sd) {
                eprintln!("[BRIDGE] serve stopped: {e}");
            }
        });
        self.server = Some(RunningBridge {
            bind: bind.to_string(),
            shutdown,
            listeners,
        });
        eprintln!("[BRIDGE] remote UI started on {bind} — no auth, trusted network only");
        Ok(())
    }

    pub fn stop(&mut self) {
        if let Some(s) = self.server.take() {
            s.shutdown.store(true, Ordering::SeqCst);
            if let Some(wv) = &self.webview {
                let app = wv.app_handle();
                for id in s.listeners {
                    app.unlisten(id);
                }
            }
            eprintln!("[BRIDGE] remote UI stopped (was {})", s.bind);
        }
    }
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
    // Retry borné dans un thread : une instance précédente peut encore
    // tenir le port au boot (drain/TIME_WAIT/zombie) — le bridge ne doit
    // ni bloquer le setup ni mourir sur un conflit transitoire.
    let app = app.clone();
    std::thread::spawn(move || {
        const BIND_ATTEMPTS: u32 = 5;
        for attempt in 1..=BIND_ATTEMPTS {
            let result = {
                let state = app.state::<crate::AppState>();
                let mut rui = state.remote_ui.lock().unwrap_or_else(|e| e.into_inner());
                rui.start(&bind)
            };
            match result {
                Ok(()) => return,
                Err(e) if attempt < BIND_ATTEMPTS => {
                    eprintln!(
                        "[BRIDGE] bind {bind} failed ({e}) — retry {attempt}/{BIND_ATTEMPTS}"
                    );
                    std::thread::sleep(Duration::from_secs(2));
                }
                Err(e) => {
                    eprintln!("[BRIDGE] remote UI disabled — {e}");
                    return;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    /// `serve` doit être stoppable : flag posé → l'accept loop sort, les
    /// writers SSE partent (sinon ils se maintiendraient vivants via
    /// leur propre Arc<subscribers> — cycle d'auto-référence).
    #[test]
    fn serve_stops_on_shutdown_flag() {
        let listener_probe = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener_probe.local_addr().unwrap().port();
        drop(listener_probe);

        let shutdown = Arc::new(AtomicBool::new(false));
        let (_tx, rx) = channel::<Value>();
        let dispatch: Dispatch = Arc::new(|_cmd, _args| Ok(Value::Array(vec![])));
        let sd = shutdown.clone();
        let listener = TcpListener::bind(format!("127.0.0.1:{port}")).unwrap();
        let h = std::thread::spawn(move || serve(listener, dispatch, rx, sd));
        // Laisse le listener s'installer, puis arrête.
        std::thread::sleep(Duration::from_millis(100));
        shutdown.store(true, Ordering::SeqCst);
        let _ = h.join().expect("serve thread should exit on shutdown");
    }

    /// SSE : un abonné reçoit les events broadcast, et son writer part
    /// quand le bridge s'arrête (recv_timeout + flag — pas de fuite).
    #[test]
    fn sse_subscriber_gets_events_and_exits_on_shutdown() {
        let listener_probe = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener_probe.local_addr().unwrap().port();
        drop(listener_probe);

        let shutdown = Arc::new(AtomicBool::new(false));
        let (tx, rx) = channel::<Value>();
        let dispatch: Dispatch = Arc::new(|_cmd, _args| Ok(Value::Array(vec![])));
        let sd = shutdown.clone();
        let listener = TcpListener::bind(format!("127.0.0.1:{port}")).unwrap();
        std::thread::spawn(move || {
            let _ = serve(listener, dispatch, rx, sd);
        });
        std::thread::sleep(Duration::from_millis(150));

        let mut stream = TcpStream::connect(format!("127.0.0.1:{port}")).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_millis(1500)))
            .unwrap();
        stream
            .write_all(b"GET /events HTTP/1.1\r\nHost: x\r\n\r\n")
            .unwrap();
        let mut head = [0u8; 128];
        let n = stream.read(&mut head).unwrap();
        assert!(String::from_utf8_lossy(&head[..n]).contains("text/event-stream"));

        tx.send(serde_json::json!({"event": "test", "payload": 42}))
            .unwrap();
        let mut buf = [0u8; 256];
        let n = stream.read(&mut buf).unwrap();
        assert!(String::from_utf8_lossy(&buf[..n]).contains("\"test\""));

        shutdown.store(true, Ordering::SeqCst);
        // Le writer SSE sort dans les ~500ms — reads suivants doivent
        // aboutir à EOF/err (un event résiduel peut traîner, d'où la marge).
        let mut ended = false;
        for _ in 0..6 {
            match stream.read(&mut buf) {
                Ok(0) | Err(_) => {
                    ended = true;
                    break;
                }
                Ok(_) => {}
            }
        }
        assert!(ended, "SSE writer should exit after shutdown");
    }

    /// RemoteUi headless : pas de webview → `start` refuse poliment au
    /// lieu de crasher (chemin emprunté par `set_remote_ui` en mock).
    #[test]
    fn remote_ui_headless_refuses_start() {
        let mut rui = RemoteUi::default();
        assert!(rui.start("127.0.0.1:4199").is_err());
        assert!(!rui.is_running());
        assert_eq!(rui.bind(), None);
        // stop idempotent : safe sans serveur.
        rui.stop();
    }
}
