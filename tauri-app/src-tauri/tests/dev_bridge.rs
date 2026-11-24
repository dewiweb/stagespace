//! Pont de développement headless : expose le backend Tauri complet
//! (commands IPC + events) au frontend servi par le dev server Vite,
//! sans webview — pour des tests E2E réels pilotés par navigateur.
//!
//! Lancer : `cargo test --test dev_bridge -- --ignored --nocapture`
//! puis côté navigateur `?bridge=http://127.0.0.1:4173` — le shim
//! `__TAURI_INTERNALS__` route `invoke` → `POST {bridge}/invoke` et les
//! events → SSE `GET {bridge}/events`.
//!
//! Bind : `127.0.0.1:4173` par défaut, surchargeable via
//! `STAGESPACE_BRIDGE_BIND` (ex. `0.0.0.0:4173` pour une UI distante sur
//! le LAN — aucune auth : tunnel SSH recommandé hors réseau de confiance,
//! `ssh -L 4173:127.0.0.1:4173 host`).
//!
//! Toute la machinerie vit dans `stagespace_tauri::bridge_server` — le
//! même code que le remote UI in-app ; ce test n'apporte que la mock app
//! (`get_ipc_response` sur le webview mock : vrai dispatch IPC, vrai
//! AppState — MergeRuntime, OSC, superviseur compris).

#![cfg(test)]

use stagespace_tauri::{
    bridge_server, new_app_state, setup_backend_runtime, stagespace_invoke_handler,
};
use tauri::test::{mock_context, noop_assets};
use tauri::WebviewWindowBuilder;

const DEFAULT_BIND: &str = "127.0.0.1:4173";

#[test]
#[ignore = "pont de dev interactif — lancer à la demande, vit indéfiniment"]
fn dev_bridge() {
    // NB : le hook `.setup` de Tauri ne s'exécute que via le run-loop
    // (`RuntimeRunEvent::Ready`) — jamais dans une mock app. On appelle
    // donc `setup_backend_runtime` à la main : c'est lui qui branche
    // l'event_sink (global-positions), le receiver OSC et le superviseur.
    let mut app = tauri::Builder::<tauri::test::MockRuntime>::new()
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

    let dispatch =
        bridge_server::ipc_dispatch(webview, app.invoke_key().to_string()).expect("ipc_dispatch");
    let events = bridge_server::event_forwarder(app.handle());
    let bind = std::env::var(bridge_server::ENV_BIND).unwrap_or_else(|_| DEFAULT_BIND.to_string());
    eprintln!("[DEV-BRIDGE] backend headless prêt — {bind}");
    // Flag jamais armé : le pont de dev vit indéfiniment (Ctrl+C pour tuer).
    let never_shutdown = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let listener = std::net::TcpListener::bind(&bind).expect("bridge bind failed");
    // Le frontend dist est servi sur le même port : http://<ip>:4173/
    // suffit, pas de ?bridge= à taper (tauri-bridge.js déduit
    // l'origine via le marqueur selfhost injecté dans index.html).
    let dist = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend/dist");
    let statics = bridge_server::dir_statics(dist);
    bridge_server::serve(listener, dispatch, events, never_shutdown, Some(statics))
        .expect("bridge serve failed");
}
