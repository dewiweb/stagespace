use stagespace_engines::{AudioBinding, AudioSource};
use tauri::State;
use crate::AppState;
use std::sync::{Mutex, MutexGuard};

// Audio Reactor Commands
/// Récupère le contenu d'un Mutex même s'il est empoisonné (poison recovery).
fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| {
        eprintln!("[WARN] Mutex was poisoned, recovering inner data: {}", e);
        e.into_inner()
    })
}
#[tauri::command]
pub async fn audio_bind(
    source: String,
    macro_name: String,
    min_val: f64,
    max_val: f64,
    smooth: f64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let audio_source = match source.as_str() {
        "microphone" => AudioSource::Microphone,
        s if s.starts_with("file:") => AudioSource::File(s[5..].to_string()),
        s if s.starts_with("stream:") => AudioSource::Stream(s[7..].to_string()),
        _ => return Err(format!("Invalid audio source: {}", source)),
    };
    
    let binding = AudioBinding {
        source: audio_source,
        macro_name: macro_name.clone(),
        min_val,
        max_val,
        smooth,
    };
    
    let mut reactor = lock_or_recover(&state.audio_reactor);
    reactor.add_binding(binding);
    Ok(())
}

#[tauri::command]
pub async fn audio_unbind(source: String, macro_name: String, state: State<'_, AppState>) -> Result<(), String> {
    let audio_source = match source.as_str() {
        "microphone" => AudioSource::Microphone,
        s if s.starts_with("file:") => AudioSource::File(s[5..].to_string()),
        s if s.starts_with("stream:") => AudioSource::Stream(s[7..].to_string()),
        _ => return Err(format!("Invalid audio source: {}", source)),
    };
    
    let mut reactor = lock_or_recover(&state.audio_reactor);
    reactor.remove_binding(&audio_source, &macro_name);
    Ok(())
}

#[tauri::command]
pub async fn audio_clear(state: State<'_, AppState>) -> Result<(), String> {
    let mut reactor = lock_or_recover(&state.audio_reactor);
    reactor.clear_bindings();
    Ok(())
}
