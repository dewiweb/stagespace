use super::state::lock_or_recover;
use crate::AppState;
use stagespace_engines::{AudioCaptureManager, AudioDeviceInfo, AudioState};
use tauri::{Emitter, State};

#[tauri::command]
pub async fn list_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    AudioCaptureManager::list_devices().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_audio_capture(
    state: State<'_, AppState>,
    device_id: Option<String>,
) -> Result<(), String> {
    let capture = lock_or_recover(&state.audio_capture);
    capture
        .start(device_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_audio_capture(state: State<'_, AppState>) -> Result<(), String> {
    let capture = lock_or_recover(&state.audio_capture);
    capture.stop();
    Ok(())
}

#[tauri::command]
pub async fn get_audio_state(state: State<'_, AppState>) -> Result<AudioState, String> {
    let capture = lock_or_recover(&state.audio_capture);
    Ok(capture.get_state())
}

/// Commande legacy : maintenue pour compatibilité, mais l'audio est désormais capturé en Rust.
/// Met à jour manuellement l'audio_state et propage aux runtimes.
#[tauri::command]
pub async fn update_audio_state(
    state: State<'_, AppState>,
    audio_data: AudioState,
) -> Result<(), String> {
    // 1. Stocker dans AppState (lock très bref)
    {
        let mut audio_state = lock_or_recover(&state.audio_state);
        *audio_state = audio_data.clone();
    }
    // 2. Collecter les Arcs des runtimes actifs (lock bref sur movements)
    let runtime_arcs: Vec<_> = {
        let movements = lock_or_recover(&state.movements);
        movements
            .values()
            .map(|m| m.runtime.audio_state_arc())
            .collect()
    };
    // 3. Mettre à jour chaque runtime SANS tenir le lock sur movements
    for arc in &runtime_arcs {
        let mut s = arc.lock().unwrap_or_else(|e| e.into_inner());
        *s = audio_data.clone();
    }
    Ok(())
}

/// Boucle de polling audio : copie l'état du AudioCaptureManager vers AppState,
/// propage aux runtimes, et émet `audio-state-update` vers le frontend.
pub fn start_audio_poller(app_handle: tauri::AppHandle, state: &AppState) {
    let app_handle = app_handle.clone();
    let audio_capture = state.audio_capture.clone();
    let audio_state = state.audio_state.clone();
    let movements = state.movements.clone();
    let shutdown = state.audio_poller_shutdown.clone();

    std::thread::spawn(move || {
        while !shutdown.load(std::sync::atomic::Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(100));

            if shutdown.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }

            let state = {
                let capture = audio_capture.lock().unwrap_or_else(|e| e.into_inner());
                capture.get_state()
            };

            // Propager à AppState
            {
                let mut s = audio_state.lock().unwrap_or_else(|e| e.into_inner());
                *s = state.clone();
            }

            // Propager aux runtimes
            let runtime_arcs: Vec<_> = {
                let m = movements.lock().unwrap_or_else(|e| e.into_inner());
                m.values().map(|mv| mv.runtime.audio_state_arc()).collect()
            };
            for arc in &runtime_arcs {
                if let Ok(mut s) = arc.lock() {
                    *s = state.clone();
                }
            }

            // Émettre vers le frontend
            let _ = app_handle.emit("audio-state-update", state);
        }
        eprintln!("[INFO] Audio poller thread terminated");
    });
}
