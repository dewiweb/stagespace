use std::sync::atomic::{AtomicU64, Ordering};

/// Portée d'une macro spatiale (audit T2 — le scope était implicite :
/// `launch_animation` poussait les macros au worker, `playSlot` au merge,
/// et le frontend devait neutraliser manuellement pour éviter un
/// transform ×2. La propriété n'existait que dans des commentaires).
///
/// Contrat :
/// - `PerMove` : macros du worker (`Runtime::macros()`), seedées une
///   fois au lancement via `SpatialMacroInit` / `SpatialMacroSnapshot`
///   (valeurs du cue). Appliquées en espace local par `move_transform`.
/// - `Global` : macros du merge (`MergeRuntime::macros()`), pilotées en
///   live par `set_macro`. Appliquées en espace monde par le post-process
///   (par défaut ou chaîne compilée du graph global).
///
/// Un même paramètre ne doit être piloté que par UN scope — pousser la
/// même valeur aux deux produit un transform doublé.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MacroScope {
    /// Macros du merge — live, globales, tous les moves.
    Global,
    /// Macros d'un worker — seedées au lancement, propres au move.
    PerMove,
}

/// Macros temps réel — lues à chaque frame, modifiables sans recompilation
///
/// Les macros sont des transformations POST-engine appliquées par le runtime.
/// Les audio mods agissent sur ces macros (addition : macro_effective = macro_base + audio_delta).
///
/// Macros existantes :
/// - speed : time scaling (t_virtual = t * speed)
/// - scale : position scaling (pos * scale)
/// - shift_x/y/z : translation
/// - yaw/pitch/roll : rotation (degrés)
///
/// Nouvelles macros (post-engine) :
/// - radius_scale : multiplie le rayon des engines (injecté dans params.extra)
/// - height_offset : ajoute à Y après l'engine
///
/// Cohérence multi-champs : `version` est un seqlock — les écritures
/// groupées (`set_shift`, `set_rotation`, `restore_all`) l'encadrent, les
/// lectures groupées (`get_shift`, `get_rotation`, `snapshot`, `Clone`)
/// retentent si une écriture était en cours. Sans ça, une frame pouvait
/// lire shift_x nouveau + shift_y/z anciens (transform déchiré).
#[derive(Debug)]
pub struct MacroState {
    /// Seqlock : impair = écriture en cours, pair = stable.
    version: AtomicU64,
    pub speed: std::sync::atomic::AtomicU64, // bits of f64
    pub scale: std::sync::atomic::AtomicU64,
    pub shift_x: std::sync::atomic::AtomicU64,
    pub shift_y: std::sync::atomic::AtomicU64,
    pub shift_z: std::sync::atomic::AtomicU64,
    pub yaw: std::sync::atomic::AtomicU64, // rotation autour de Y (degrés)
    pub pitch: std::sync::atomic::AtomicU64, // rotation autour de X (degrés)
    pub roll: std::sync::atomic::AtomicU64, // rotation autour de Z (degrés)
    // Nouvelles macros
    pub radius_scale: std::sync::atomic::AtomicU64, // multiplicateur de rayon (1.0 = neutre)
    pub height_offset: std::sync::atomic::AtomicU64, // offset vertical post-engine
}

/// Snapshot immuable d'une frame — toutes les valeurs lues sous le même
/// seqlock, donc cohérentes entre elles.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MacroFrameSnapshot {
    pub speed: f64,
    pub scale: f64,
    pub shift: nalgebra::Vector3<f64>,
    pub yaw: f64,
    pub pitch: f64,
    pub roll: f64,
    pub radius_scale: f64,
    pub height_offset: f64,
}

impl Default for MacroState {
    fn default() -> Self {
        Self::new()
    }
}

impl MacroState {
    pub fn new() -> Self {
        MacroState {
            version: AtomicU64::new(0),
            speed: AtomicU64::new(1.0f64.to_bits()),
            scale: AtomicU64::new(1.0f64.to_bits()),
            shift_x: AtomicU64::new(0.0f64.to_bits()),
            shift_y: AtomicU64::new(0.0f64.to_bits()),
            shift_z: AtomicU64::new(0.0f64.to_bits()),
            yaw: AtomicU64::new(0.0f64.to_bits()),
            pitch: AtomicU64::new(0.0f64.to_bits()),
            roll: AtomicU64::new(0.0f64.to_bits()),
            radius_scale: AtomicU64::new(1.0f64.to_bits()),
            height_offset: AtomicU64::new(0.0f64.to_bits()),
        }
    }

    /// Section d'écriture seqlock : version impaire pendant les stores.
    fn write_section(&self, f: impl FnOnce(&Self)) {
        self.version.fetch_add(1, Ordering::Release);
        f(self);
        self.version.fetch_add(1, Ordering::Release);
    }

    /// Lecture cohérente : retente tant qu'une écriture est intercalée.
    /// Les écrivains sont rares (sliders, recall) → borne en pratique.
    fn read_consistent<T>(&self, f: impl Fn(&Self) -> T) -> T {
        loop {
            let v1 = self.version.load(Ordering::Acquire);
            if v1 & 1 != 0 {
                std::hint::spin_loop();
                continue;
            }
            let out = f(self);
            std::sync::atomic::fence(Ordering::Acquire);
            if self.version.load(Ordering::Acquire) == v1 {
                return out;
            }
        }
    }

    pub fn get_speed(&self) -> f64 {
        f64::from_bits(self.speed.load(Ordering::Relaxed))
    }
    pub fn get_scale(&self) -> f64 {
        f64::from_bits(self.scale.load(Ordering::Relaxed))
    }
    pub fn get_shift(&self) -> nalgebra::Vector3<f64> {
        self.read_consistent(|m| {
            nalgebra::Vector3::new(
                f64::from_bits(m.shift_x.load(Ordering::Relaxed)),
                f64::from_bits(m.shift_y.load(Ordering::Relaxed)),
                f64::from_bits(m.shift_z.load(Ordering::Relaxed)),
            )
        })
    }
    pub fn get_rotation(&self) -> (f64, f64, f64) {
        self.read_consistent(|m| {
            (
                f64::from_bits(m.yaw.load(Ordering::Relaxed)),
                f64::from_bits(m.pitch.load(Ordering::Relaxed)),
                f64::from_bits(m.roll.load(Ordering::Relaxed)),
            )
        })
    }
    pub fn get_radius_scale(&self) -> f64 {
        f64::from_bits(self.radius_scale.load(Ordering::Relaxed))
    }
    pub fn get_height_offset(&self) -> f64 {
        f64::from_bits(self.height_offset.load(Ordering::Relaxed))
    }

    /// Snapshot complet cohérent — une seule passe seqlock pour les 10
    /// champs. Les lecteurs par frame (merge, workers) clonent via
    /// `Clone` qui utilise ce chemin : une frame ne voit jamais un mix.
    pub fn snapshot(&self) -> MacroFrameSnapshot {
        self.read_consistent(|m| MacroFrameSnapshot {
            speed: f64::from_bits(m.speed.load(Ordering::Relaxed)),
            scale: f64::from_bits(m.scale.load(Ordering::Relaxed)),
            shift: nalgebra::Vector3::new(
                f64::from_bits(m.shift_x.load(Ordering::Relaxed)),
                f64::from_bits(m.shift_y.load(Ordering::Relaxed)),
                f64::from_bits(m.shift_z.load(Ordering::Relaxed)),
            ),
            yaw: f64::from_bits(m.yaw.load(Ordering::Relaxed)),
            pitch: f64::from_bits(m.pitch.load(Ordering::Relaxed)),
            roll: f64::from_bits(m.roll.load(Ordering::Relaxed)),
            radius_scale: f64::from_bits(m.radius_scale.load(Ordering::Relaxed)),
            height_offset: f64::from_bits(m.height_offset.load(Ordering::Relaxed)),
        })
    }

    pub fn set_speed(&self, v: f64) {
        self.write_section(|m| m.speed.store(v.to_bits(), Ordering::Relaxed));
    }
    pub fn set_scale(&self, v: f64) {
        self.write_section(|m| m.scale.store(v.to_bits(), Ordering::Relaxed));
    }
    pub fn set_shift(&self, x: f64, y: f64, z: f64) {
        self.write_section(|m| {
            m.shift_x.store(x.to_bits(), Ordering::Relaxed);
            m.shift_y.store(y.to_bits(), Ordering::Relaxed);
            m.shift_z.store(z.to_bits(), Ordering::Relaxed);
        });
    }
    pub fn set_rotation(&self, yaw: f64, pitch: f64, roll: f64) {
        self.write_section(|m| {
            m.yaw.store(yaw.to_bits(), Ordering::Relaxed);
            m.pitch.store(pitch.to_bits(), Ordering::Relaxed);
            m.roll.store(roll.to_bits(), Ordering::Relaxed);
        });
    }
    pub fn set_radius_scale(&self, v: f64) {
        self.write_section(|m| m.radius_scale.store(v.to_bits(), Ordering::Relaxed));
    }
    pub fn set_height_offset(&self, v: f64) {
        self.write_section(|m| m.height_offset.store(v.to_bits(), Ordering::Relaxed));
    }

    /// Restauration atomique d'un snapshot (cue recall) — UNE seule
    /// section d'écriture : aucune frame ne voit un mix ancien/nouveau
    /// entre scale, shift, rotation et les macros étendues.
    pub fn restore_all(&self, snap: &MacroFrameSnapshot) {
        self.write_section(|m| {
            m.speed.store(snap.speed.to_bits(), Ordering::Relaxed);
            m.scale.store(snap.scale.to_bits(), Ordering::Relaxed);
            m.shift_x.store(snap.shift.x.to_bits(), Ordering::Relaxed);
            m.shift_y.store(snap.shift.y.to_bits(), Ordering::Relaxed);
            m.shift_z.store(snap.shift.z.to_bits(), Ordering::Relaxed);
            m.yaw.store(snap.yaw.to_bits(), Ordering::Relaxed);
            m.pitch.store(snap.pitch.to_bits(), Ordering::Relaxed);
            m.roll.store(snap.roll.to_bits(), Ordering::Relaxed);
            m.radius_scale
                .store(snap.radius_scale.to_bits(), Ordering::Relaxed);
            m.height_offset
                .store(snap.height_offset.to_bits(), Ordering::Relaxed);
        });
    }
}

impl Clone for MacroState {
    /// Clone cohérent : le snapshot est lu sous le seqlock — un clone ne
    /// mélange jamais des champs de deux écritures différentes.
    fn clone(&self) -> Self {
        let s = self.snapshot();
        MacroState {
            version: AtomicU64::new(0),
            speed: AtomicU64::new(s.speed.to_bits()),
            scale: AtomicU64::new(s.scale.to_bits()),
            shift_x: AtomicU64::new(s.shift.x.to_bits()),
            shift_y: AtomicU64::new(s.shift.y.to_bits()),
            shift_z: AtomicU64::new(s.shift.z.to_bits()),
            yaw: AtomicU64::new(s.yaw.to_bits()),
            pitch: AtomicU64::new(s.pitch.to_bits()),
            roll: AtomicU64::new(s.roll.to_bits()),
            radius_scale: AtomicU64::new(s.radius_scale.to_bits()),
            height_offset: AtomicU64::new(s.height_offset.to_bits()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_macro_state_realtime() {
        let macros = MacroState::new();
        assert!((macros.get_speed() - 1.0).abs() < 1e-10);
        macros.set_speed(2.5);
        assert!((macros.get_speed() - 2.5).abs() < 1e-10);
        macros.set_shift(1.0, -2.0, 0.5);
        let s = macros.get_shift();
        assert!((s.x - 1.0).abs() < 1e-10);
        assert!((s.y + 2.0).abs() < 1e-10);
        assert!((s.z - 0.5).abs() < 1e-10);
    }

    #[test]
    fn test_new_macros() {
        let macros = MacroState::new();
        assert!((macros.get_radius_scale() - 1.0).abs() < 1e-10);
        assert!((macros.get_height_offset() - 0.0).abs() < 1e-10);
        macros.set_radius_scale(2.0);
        macros.set_height_offset(1.5);
        assert!((macros.get_radius_scale() - 2.0).abs() < 1e-10);
        assert!((macros.get_height_offset() - 1.5).abs() < 1e-10);
    }

    #[test]
    fn test_snapshot_coherent() {
        let macros = MacroState::new();
        let snap = MacroFrameSnapshot {
            speed: 2.0,
            scale: 3.0,
            shift: nalgebra::Vector3::new(1.0, 2.0, 3.0),
            yaw: 10.0,
            pitch: 20.0,
            roll: 30.0,
            radius_scale: 1.5,
            height_offset: 0.5,
        };
        macros.restore_all(&snap);
        assert_eq!(macros.snapshot(), snap);
        let cloned = macros.clone();
        assert_eq!(cloned.snapshot(), snap);
    }

    #[test]
    fn test_concurrent_reads_never_torn() {
        // Un writer qui alterne deux états complets ; le reader ne doit
        // jamais observer un mélange (shift_x de A + shift_y de B).
        use std::sync::Arc;
        let macros = Arc::new(MacroState::new());
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let w = {
            let m = macros.clone();
            let stop = stop.clone();
            std::thread::spawn(move || {
                let mut flip = false;
                while !stop.load(Ordering::Relaxed) {
                    if flip {
                        m.restore_all(&MacroFrameSnapshot {
                            speed: 1.0,
                            scale: 1.0,
                            shift: nalgebra::Vector3::new(1.0, 1.0, 1.0),
                            yaw: 1.0,
                            pitch: 1.0,
                            roll: 1.0,
                            radius_scale: 1.0,
                            height_offset: 1.0,
                        });
                    } else {
                        m.restore_all(&MacroFrameSnapshot {
                            speed: 2.0,
                            scale: 2.0,
                            shift: nalgebra::Vector3::new(2.0, 2.0, 2.0),
                            yaw: 2.0,
                            pitch: 2.0,
                            roll: 2.0,
                            radius_scale: 2.0,
                            height_offset: 2.0,
                        });
                    }
                    flip = !flip;
                }
            })
        };
        for _ in 0..10_000 {
            let s = macros.snapshot();
            let uniform = (s.shift.x - s.shift.y).abs() < 1e-10
                && (s.shift.y - s.shift.z).abs() < 1e-10
                && (s.yaw - s.pitch).abs() < 1e-10
                && (s.pitch - s.roll).abs() < 1e-10;
            assert!(uniform, "snapshot déchiré: {s:?}");
        }
        stop.store(true, Ordering::Relaxed);
        w.join().expect("writer thread");
    }
}
