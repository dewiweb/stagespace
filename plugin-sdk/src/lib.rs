//! SDK invité pour les plugins WASM STAGESPACE (bundles `.ssx`, ABI v1/v2).
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

/// Parse le JSON de params depuis le buffer — helper interne des macros.
#[doc(hidden)]
pub fn __ssx_read_params(buf: &[u8], params_len: i32) -> serde_json::Value {
    let len = (params_len.max(0) as usize).min(buf.len());
    serde_json::from_slice::<serde_json::Value>(&buf[..len]).unwrap_or(serde_json::Value::Null)
}

/// Lit la position upstream `idx` (0 ou 1) du buffer inputs — helper
/// interne des macros modifier/composite.
#[doc(hidden)]
pub fn __ssx_read_input(buf: &[f64; 6], idx: usize) -> (f64, f64, f64) {
    let o = idx.min(1) * 3;
    (buf[o], buf[o + 1], buf[o + 2])
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
                $crate::__ssx_read_params(&*core::ptr::addr_of!(__SSX_PARAMS_BUF), params_len)
            };
            let (x, y, z) = $func(t, i.max(0) as usize, n.max(0) as usize, d, &params);
            unsafe {
                core::ptr::addr_of_mut!(__SSX_RESULT_BUF).write([x, y, z]);
            }
        }
    };
}

/// Génère les exports ABI v2 pour un plugin **modifier** — wrap la
/// trajectoire upstream (port `input` du node).
///
/// `$func` : `fn(t: f64, i: usize, n: usize, d: f64, params: &serde_json::Value, input: (f64,f64,f64)) -> (f64, f64, f64)`
/// — `input` = position upstream de l'objet `i` à l'instant `t`, écrite
/// par l'host dans le buffer `plugin_inputs_ptr` avant chaque appel.
///
/// Le manifeste doit déclarer `"kind": "modifier"` et `"abi_version": 2`.
#[macro_export]
macro_rules! stagespace_plugin_modifier {
    ($func:path) => {
        #[doc(hidden)]
        #[allow(static_mut_refs)]
        static mut __SSX_PARAMS_BUF: [u8; 65536] = [0u8; 65536];
        #[doc(hidden)]
        #[allow(static_mut_refs)]
        static mut __SSX_RESULT_BUF: [f64; 3] = [0.0f64; 3];
        /// Positions upstream écrites par l'host — 1 input × [f64;3]
        /// (la moitié du buffer reste libre, convention partagée avec
        /// les composites).
        #[doc(hidden)]
        #[allow(static_mut_refs)]
        static mut __SSX_INPUTS_BUF: [f64; 6] = [0.0f64; 6];

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
        pub extern "C" fn plugin_inputs_ptr() -> i32 {
            unsafe { core::ptr::addr_of!(__SSX_INPUTS_BUF) as i32 }
        }

        #[no_mangle]
        #[allow(static_mut_refs)]
        pub extern "C" fn plugin_position(t: f64, i: i32, n: i32, d: f64, params_len: i32) {
            let params = unsafe {
                $crate::__ssx_read_params(&*core::ptr::addr_of!(__SSX_PARAMS_BUF), params_len)
            };
            let input =
                unsafe { $crate::__ssx_read_input(&*core::ptr::addr_of!(__SSX_INPUTS_BUF), 0) };
            let (x, y, z) = $func(t, i.max(0) as usize, n.max(0) as usize, d, &params, input);
            unsafe {
                core::ptr::addr_of_mut!(__SSX_RESULT_BUF).write([x, y, z]);
            }
        }
    };
}

/// Génère les exports ABI v2 pour un plugin **composite** — combine deux
/// trajectoires upstream (ports `input_a`/`input_b`, comme `Mix`).
///
/// `$func` : `fn(t: f64, i: usize, n: usize, d: f64, params: &serde_json::Value, a: (f64,f64,f64), b: (f64,f64,f64)) -> (f64, f64, f64)`
///
/// Le manifeste doit déclarer `"kind": "composite"` et `"abi_version": 2`.
#[macro_export]
macro_rules! stagespace_plugin_composite {
    ($func:path) => {
        #[doc(hidden)]
        #[allow(static_mut_refs)]
        static mut __SSX_PARAMS_BUF: [u8; 65536] = [0u8; 65536];
        #[doc(hidden)]
        #[allow(static_mut_refs)]
        static mut __SSX_RESULT_BUF: [f64; 3] = [0.0f64; 3];
        /// Positions upstream écrites par l'host : input_a aux indices
        /// 0..3, input_b aux indices 3..6.
        #[doc(hidden)]
        #[allow(static_mut_refs)]
        static mut __SSX_INPUTS_BUF: [f64; 6] = [0.0f64; 6];

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
        pub extern "C" fn plugin_inputs_ptr() -> i32 {
            unsafe { core::ptr::addr_of!(__SSX_INPUTS_BUF) as i32 }
        }

        #[no_mangle]
        #[allow(static_mut_refs)]
        pub extern "C" fn plugin_position(t: f64, i: i32, n: i32, d: f64, params_len: i32) {
            let params = unsafe {
                $crate::__ssx_read_params(&*core::ptr::addr_of!(__SSX_PARAMS_BUF), params_len)
            };
            let (a, b) = unsafe {
                let buf = &*core::ptr::addr_of!(__SSX_INPUTS_BUF);
                (
                    $crate::__ssx_read_input(buf, 0),
                    $crate::__ssx_read_input(buf, 1),
                )
            };
            let (x, y, z) = $func(t, i.max(0) as usize, n.max(0) as usize, d, &params, a, b);
            unsafe {
                core::ptr::addr_of_mut!(__SSX_RESULT_BUF).write([x, y, z]);
            }
        }
    };
}
