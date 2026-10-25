use super::state::lock_or_recover;
use crate::commands::error::IpcError;
use crate::AppState;
use stagespace_engines::{AudioCaptureManager, AudioDeviceInfo, AudioState};
use tauri::{Emitter, State};

#[tauri::command]
pub async fn list_audio_devices() -> Result<Vec<AudioDeviceInfo>, IpcError> {
    tauri::async_runtime::spawn_blocking(AudioCaptureManager::list_devices)
        .await
        .map_err(|e| IpcError::internal(format!("Audio device enumeration failed: {e}")))?
        .map_err(|e| IpcError::io(e.to_string()))
}

#[tauri::command]
pub async fn start_audio_capture(
    state: State<'_, AppState>,
    device_id: Option<String>,
) -> Result<(), IpcError> {
    // spawn_blocking : `start()` peut attendre jusqu'à 5s sur un device wedged
    // — inline, ça gèle un thread de l'executor async pendant un show.
    let capture = state.audio_capture.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let capture = lock_or_recover(&capture);
        capture
            .start(device_id.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| IpcError::internal(format!("Audio capture task failed: {e}")))?
    .map_err(IpcError::io)
}

#[tauri::command]
pub async fn stop_audio_capture(state: State<'_, AppState>) -> Result<(), IpcError> {
    let capture = state.audio_capture.clone();
    tauri::async_runtime::spawn_blocking(move || {
        lock_or_recover(&capture).stop();
    })
    .await
    .map_err(|e| IpcError::internal(format!("Audio stop task failed: {e}")))
}

#[tauri::command]
pub async fn get_audio_state(state: State<'_, AppState>) -> Result<AudioState, IpcError> {
    let capture = lock_or_recover(&state.audio_capture);
    Ok(capture.get_state())
}

/// Commande legacy : maintenue pour compatibilité, mais l'audio est désormais capturé en Rust.
/// Met à jour manuellement l'audio_state et propage aux runtimes.
#[tauri::command]
pub async fn update_audio_state(
    state: State<'_, AppState>,
    audio_data: AudioState,
) -> Result<(), IpcError> {
    // Une seule écriture : workers et MergeRuntime partagent l'Arc maître
    // (injecté à la construction) — plus de propagation N-copies.
    {
        let mut audio_state = lock_or_recover(&state.audio_state);
        *audio_state = audio_data;
    }
    Ok(())
}

/// Boucle de polling audio : copie l'état du AudioCaptureManager vers AppState,
/// propage aux runtimes, et émet `audio-state-update` vers le frontend.
pub fn start_audio_poller(app_handle: tauri::AppHandle, state: &AppState) {
    let app_handle = app_handle.clone();
    let audio_capture = state.audio_capture.clone();
    let audio_state = state.audio_state.clone();
    let shutdown = state.audio_poller_shutdown.clone();

    std::thread::spawn(move || {
        while !shutdown.load(std::sync::atomic::Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(100));

            if shutdown.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }

            // catch_unwind : un panic dans le poller ne doit pas tuer le
            // thread en silence (audio state figé pour toujours). On log et
            // on continue — l'itération suivante reprend le polling.
            let tick = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let state = {
                    let capture = audio_capture.lock().unwrap_or_else(|e| e.into_inner());
                    capture.get_state()
                };

                // Une seule écriture dans l'Arc maître — workers et MergeRuntime
                // partagent ce même Arc (injectés à la construction) : les nodes
                // audio du graph global et les audio mods des workers voient
                // l'état à jour sans copie supplémentaire.
                {
                    let mut s = audio_state.lock().unwrap_or_else(|e| e.into_inner());
                    *s = state.clone();
                }

                // Consommer les erreurs du device (débranché, stream mort…) —
                // sans ça l'UI n'est jamais notifiée d'une capture tombée.
                // `audio-recovered` suit l'auto-reconnexion réussie.
                {
                    let capture = audio_capture.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(err) = capture.take_error() {
                        let _ = app_handle.emit("audio-error", err);
                    }
                    if capture.take_recovered() {
                        let _ = app_handle.emit("audio-recovered", ());
                    }
                }

                // Émettre vers le frontend
                let _ = app_handle.emit("audio-state-update", state);
            }));
            if let Err(e) = tick {
                eprintln!("[ERROR] Audio poller tick panicked: {e:?} — continuing");
            }
        }
        eprintln!("[INFO] Audio poller thread terminated");
    });
}
