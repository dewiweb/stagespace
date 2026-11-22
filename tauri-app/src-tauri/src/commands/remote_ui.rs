//! Remote-UI bridge (HTTP/SSE → navigateurs distants) — start/stop à
//! chaud depuis Settings. Ne touche ni le moteur ni l'OSC : la webview
//! desktop et les clients distants partagent le même backend.
use crate::commands::error::IpcError;
use crate::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteUiStatus {
    pub running: bool,
    pub bind: Option<String>,
}

fn status(state: &State<AppState>) -> RemoteUiStatus {
    let rui = state.remote_ui.lock().unwrap_or_else(|e| e.into_inner());
    RemoteUiStatus {
        running: rui.is_running(),
        bind: rui.bind().map(String::from),
    }
}

/// `set_remote_ui { enabled, bind? }` — `enabled:true` (re)démarre le
/// serveur sur `bind` (défaut `0.0.0.0:4173`) ; `false` l'arrête.
/// Le bind est validé avant tout stop : un mauvais réglage ne tue pas
/// un serveur qui tourne déjà.
#[tauri::command]
pub fn set_remote_ui(
    state: State<AppState>,
    enabled: bool,
    bind: Option<String>,
) -> Result<RemoteUiStatus, IpcError> {
    let mut rui = state.remote_ui.lock().unwrap_or_else(|e| e.into_inner());
    if enabled {
        let bind = bind.unwrap_or_else(|| "0.0.0.0:4173".to_string());
        bind.parse::<std::net::SocketAddr>().map_err(|_| {
            IpcError::validation(format!(
                "invalid remote UI bind '{bind}' — expected host:port (e.g. 0.0.0.0:4173)"
            ))
        })?;
        rui.start(&bind).map_err(IpcError::internal)?;
    } else {
        rui.stop();
    }
    drop(rui);
    Ok(status(&state))
}

#[tauri::command]
pub fn remote_ui_status(state: State<AppState>) -> RemoteUiStatus {
    status(&state)
}
