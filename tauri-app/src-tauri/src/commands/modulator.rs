use stagespace_engines::{ModulationSlot, Waveform};
use tauri::State;
use crate::AppState;
use std::sync::{Mutex, MutexGuard};

// Modulator Commands
/// Récupère le contenu d'un Mutex même s'il est empoisonné (poison recovery).
fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| {
        eprintln!("[WARN] Mutex was poisoned, recovering inner data: {}", e);
        e.into_inner()
    })
}
#[tauri::command]
pub async fn modulator_add_slot(
    target: String,
    waveform: String,
    rate: f64,
    depth: f64,
    center: f64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let wave = match waveform.as_str() {
        "sine" => Waveform::Sine,
        "triangle" => Waveform::Triangle,
        "square" => Waveform::Square,
        "sawtooth" => Waveform::Sawtooth,
        "random" => Waveform::Random,
        _ => return Err(format!("Invalid waveform: {}", waveform)),
    };
    
    let mut modulator = lock_or_recover(&state.modulator);
    modulator.add_slot(target, wave, rate, depth, center);
    Ok(())
}

#[tauri::command]
pub async fn modulator_remove_slot(target: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut modulator = lock_or_recover(&state.modulator);
    modulator.remove_slot(&target);
    Ok(())
}

#[tauri::command]
pub async fn modulator_list(state: State<'_, AppState>) -> Result<Vec<ModulationSlot>, String> {
    let modulator = lock_or_recover(&state.modulator);
    Ok(modulator.get_slots().values().cloned().collect())
}
