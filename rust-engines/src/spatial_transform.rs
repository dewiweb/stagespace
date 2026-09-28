//! Primitives de transform spatial — **implémentation canonique unique**
//! (audit T2 : trois implémentations divergentes coexistaient — worker
//! per-move, post-process par défaut, chaîne compilée du graph global —
//! avec des conventions de clés et des ordres de rotation différents).
//!
//! Deux espaces coexistent délibérément :
//! - **Local** (worker `move_transform`) : pivot = centre de la
//!   trajectoire (~0), une seule translation `+ origin + shift` en sortie.
//! - **World** (merge, post-process) : pivot = `origin` de la scène
//!   (isobarycentre des tracks, ou isobarycentre live si node Barycenter).
//!
//! Toute opération "autour d'un pivot" est exprimée ici — les pipelines
//! n'ont plus que la composition à décrire, plus la sémantique.

use nalgebra::{Rotation3, Vector3};

/// Ordre canonique des rotations d'Euler : X puis Y puis Z
/// (`rz · ry · rx`). Avant T2 le post-process compilé utilisait
/// `rz · rx · ry` — les rotations ne commutent pas, le même graphe se
/// rendait différemment en sub-graph et en global.
pub fn euler_rotation(pitch_x: f64, yaw_y: f64, roll_z: f64) -> Option<Rotation3<f64>> {
    if pitch_x == 0.0 && yaw_y == 0.0 && roll_z == 0.0 {
        return None;
    }
    let rx = Rotation3::from_axis_angle(&Vector3::x_axis(), pitch_x);
    let ry = Rotation3::from_axis_angle(&Vector3::y_axis(), yaw_y);
    let rz = Rotation3::from_axis_angle(&Vector3::z_axis(), roll_z);
    Some(rz * ry * rx)
}

/// Scale autour d'un pivot : `pivot + (pos - pivot) ∘ scale`.
/// `scale` est per-axe — un scale uniforme passe `Vector3::repeat(k)`.
pub fn pivot_scale(pos: Vector3<f64>, pivot: Vector3<f64>, scale: Vector3<f64>) -> Vector3<f64> {
    pivot + (pos - pivot).component_mul(&scale)
}

/// Rotation autour d'un pivot.
pub fn pivot_rotate(pos: Vector3<f64>, pivot: Vector3<f64>, rot: &Rotation3<f64>) -> Vector3<f64> {
    pivot + rot * (pos - pivot)
}

/// Miroir autour d'un pivot — `plane` ∈ {"xy","xz","yz"}, `offset` dans
/// le repère du pivot. Délègue à `engines::modifiers::mirror`.
pub fn pivot_mirror(
    pos: Vector3<f64>,
    pivot: Vector3<f64>,
    plane: &str,
    offset: f64,
) -> Vector3<f64> {
    pivot + crate::engines::modifiers::mirror(pos - pivot, plane, offset)
}
