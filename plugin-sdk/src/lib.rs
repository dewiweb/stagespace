//! SDK invité pour les plugins WASM STAGESPACE (bundles `.ssx`, ABI v1).
//!
//! # Écrire un plugin
//!
//! ```rust,no_run
//! use stagespace_plugin_sdk::{get_f64, stagespace_plugin};
//!
//! fn position(t: f64, i: usize, n: usize, d: f64, params: &serde_json::Value) -> (f64, f64, f64) {
//!     let radius = get_f64(params, "radius", 1.0);
//!     let phase = 2.0 * std::f64::consts::PI * (t / d + i as f64 / n.max(1) as f64);
//!     (radius * phase.cos(), 0.0, radius * phase.sin())
//! }
//! stagespace_plugin!(position);
//! ```
//!
//! # Compiler
//!
//! ```bash
//! cargo build --release --target wasm32-unknown-unknown   # dans le crate du plugin
//! stagespace-pack manifest.json module.wasm -o mon_plugin.ssx
//! ```
//!
//! # ABI v1 (généré par la macro)
//!
//! - `plugin_params_ptr() -> i32` : buffer statique 64 KB — l'host y écrit
//!   le JSON des params du node (`EngineParams.extra`).
//! - `plugin_result_ptr() -> i32` : buffer statique 24 B — le plugin y écrit
//!   `[x, y, z]` en f64 little-endian.
//! - `plugin_position(t: f64, i: i32, n: i32, d: f64, params_len: i32)` :
//!   appelé par l'host à chaque frame × objet.
//!
//! Un trap (panic, index OOB, fuel épuisé) → l'host retourne (0,0,0) pour
//! cette frame — jamais de propagation vers le runtime 60 FPS.

/// Lit un paramètre `f64` depuis le JSON de params du node.
pub fn get_f64(params: &serde_json::Value, key: &str, default: f64) -> f64 {
    params.get(key).and_then(|v| v.as_f64()).unwrap_or(default)
}

/// Lit un paramètre `bool` depuis le JSON de params du node.
pub fn get_bool(params: &serde_json::Value, key: &str, default: bool) -> bool {
    params.get(key).and_then(|v| v.as_bool()).unwrap_or(default)
}

/// Lit un paramètre `&str` depuis le JSON de params du node.
pub fn get_str<'a>(params: &'a serde_json::Value, key: &str, default: &'a str) -> &'a str {
    params.get(key).and_then(|v| v.as_str()).unwrap_or(default)
}

/// Génère les exports ABI v1 attendus par l'host STAGESPACE.
///
/// `$func` : `fn(t: f64, i: usize, n: usize, d: f64, params: &serde_json::Value) -> (f64, f64, f64)`
/// — position de l'objet `i` au temps `t` (secondes), `n` = n_objects,
/// `d` = duration du graphe.
///
/// Les buffers statiques sont sûrs : wasm32 est mono-thread et l'host
/// sérialise les appels (Mutex sur le Store).
#[macro_export]
macro_rules! stagespace_plugin {
    ($func:path) => {
        #[doc(hidden)]
        #[allow(static_mut_refs)]
        static mut __SSX_PARAMS_BUF: [u8; 65536] = [0u8; 65536];
        #[doc(hidden)]
        #[allow(static_mut_refs)]
        static mut __SSX_RESULT_BUF: [f64; 3] = [0.0f64; 3];

        #[no_mangle]
        #[allow(static_mut_refs)]
        pub extern "C" fn plugin_params_ptr() -> i32 {
            unsafe { core::ptr::addr_of!(__SSX_PARAMS_BUF) as i32 }
        }

        #[no_mangle]
        #[allow(static_mut_refs)]
        pub extern "C" fn plugin_result_ptr() -> i32 {
            unsafe { core::ptr::addr_of!(__SSX_RESULT_BUF) as i32 }
        }

        #[no_mangle]
        #[allow(static_mut_refs)]
        pub extern "C" fn plugin_position(t: f64, i: i32, n: i32, d: f64, params_len: i32) {
            let params = unsafe {
                let ptr = core::ptr::addr_of!(__SSX_PARAMS_BUF) as *const u8;
                let len = (params_len.max(0) as usize).min(__SSX_PARAMS_BUF.len());
                serde_json::from_slice::<serde_json::Value>(core::slice::from_raw_parts(ptr, len))
                    .unwrap_or(serde_json::Value::Null)
            };
            let (x, y, z) = $func(t, i.max(0) as usize, n.max(0) as usize, d, &params);
            unsafe {
                core::ptr::addr_of_mut!(__SSX_RESULT_BUF).write([x, y, z]);
            }
        }
    };
}
