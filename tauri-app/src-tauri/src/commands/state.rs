use std::sync::{Mutex, MutexGuard};

/// Lock a mutex, recovering from poisoning instead of panicking.
///
/// Every Mutex access in the Tauri backend must go through this helper so that
/// a panic in one thread does not crash the whole app — we log a `[WARN]` and
/// continue with the poisoned (but still usable) inner data.
pub fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| {
        eprintln!("[WARN] Mutex was poisoned, recovering inner data: {e}");
        e.into_inner()
    })
}
