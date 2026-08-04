use crate::engines::{Engine, EngineParams};
use nalgebra::Vector3;

/// A point in a spline
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SplinePoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

/// A spline definition
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Spline {
    pub points: Vec<SplinePoint>,
    pub closed: bool,
    pub tension: f64,
}

/// Arc-length parameterization lookup table
pub struct SplineLUT {
    pub positions: Vec<Vector3<f64>>,
    pub arc_lengths: Vec<f64>,
    pub total_length: f64,
}

const LUT_STEPS: usize = 200;

/// Catmull-Rom interpolation between 4 control points
fn catmull_rom_segment(
    p0: Vector3<f64>,
    p1: Vector3<f64>,
    p2: Vector3<f64>,
    p3: Vector3<f64>,
    t: f64,
    tension: f64,
) -> Vector3<f64> {
    let a = tension;
    let t2 = t * t;
    let t3 = t2 * t;

    let c0 = -a * t3 + 2.0 * a * t2 - a * t;
    let c1 = (2.0 - a) * t3 + (a - 3.0) * t2 + 1.0;
    let c2 = (a - 2.0) * t3 + (3.0 - 2.0 * a) * t2 + a * t;
    let c3 = a * t3 - a * t2;

    c0 * p0 + c1 * p1 + c2 * p2 + c3 * p3
}

fn get_point(spline: &Spline, i: i32) -> Vector3<f64> {
    let n = spline.points.len() as i32;
    let idx = if spline.closed {
        ((i % n + n) % n) as usize
    } else {
        i.clamp(0, n - 1) as usize
    };
    let p = &spline.points[idx];
    Vector3::new(p.x, p.y, p.z)
}

fn evaluate_raw(spline: &Spline, u: f64) -> Vector3<f64> {
    let n = spline.points.len();
    if n == 0 {
        return Vector3::zeros();
    }
    if n == 1 {
        let p = &spline.points[0];
        return Vector3::new(p.x, p.y, p.z);
    }

    let num_segments = if spline.closed { n } else { n - 1 };
    let seg_f = u * num_segments as f64;
    let mut seg = seg_f.floor() as i32;
    let mut local_t = seg_f - seg as f64;

    if seg >= num_segments as i32 {
        seg = num_segments as i32 - 1;
        local_t = 1.0;
    }

    let p0 = get_point(spline, seg - 1);
    let p1 = get_point(spline, seg);
    let p2 = get_point(spline, seg + 1);
    let p3 = get_point(spline, seg + 2);

    catmull_rom_segment(p0, p1, p2, p3, local_t, spline.tension)
}

/// Build arc-length LUT for a spline
pub fn build_spline_lut(spline: &Spline) -> SplineLUT {
    let n = spline.points.len();
    if n < 2 {
        let p = if n == 1 {
            Vector3::new(spline.points[0].x, spline.points[0].y, spline.points[0].z)
        } else {
            Vector3::zeros()
        };
        return SplineLUT {
            positions: vec![p],
            arc_lengths: vec![0.0],
            total_length: 0.0,
        };
    }

    let mut positions = Vec::with_capacity(LUT_STEPS + 1);
    let mut arc_lengths = Vec::with_capacity(LUT_STEPS + 1);
    let mut total = 0.0;

    for step in 0..=LUT_STEPS {
        let u = step as f64 / LUT_STEPS as f64;
        let pos = evaluate_raw(spline, u);
        positions.push(pos);

        if step == 0 {
            arc_lengths.push(0.0);
        } else {
            let prev = positions[step - 1];
            total += (pos - prev).norm();
            arc_lengths.push(total);
        }
    }

    SplineLUT {
        positions,
        arc_lengths,
        total_length: total,
    }
}

/// Evaluate spline at arc-length-uniform t ∈ [0,1]
pub fn evaluate_spline(lut: &SplineLUT, t: f64) -> Vector3<f64> {
    if lut.positions.len() <= 1 {
        return lut.positions.get(0).copied().unwrap_or_else(Vector3::zeros);
    }

    let t = t.clamp(0.0, 1.0);
    let target = t * lut.total_length;

    // Binary search
    let mut lo = 0usize;
    let mut hi = lut.arc_lengths.len() - 1;
    while lo < hi - 1 {
        let mid = (lo + hi) / 2;
        if lut.arc_lengths[mid] < target {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    let len_lo = lut.arc_lengths[lo];
    let len_hi = lut.arc_lengths[hi];
    let span = len_hi - len_lo;
    let blend = if span < 1e-10 { 0.0 } else { (target - len_lo) / span };

    let a = lut.positions[lo];
    let b = lut.positions[hi];
    a + (b - a) * blend
}

/// Parse a spline from JSON params.
/// `points` peut être soit un array JSON direct, soit une string JSON (sérialisée côté frontend).
fn parse_spline(params: &EngineParams) -> Option<Spline> {
    let points_json = params.extra.get("points")?;

    // Handle both cases: JSON string (from frontend) or direct JSON array
    let points_arr = if let Some(arr) = points_json.as_array() {
        arr.clone()
    } else if let Some(s) = points_json.as_str() {
        // It's a JSON string — parse it into an array
        let parsed: serde_json::Value = serde_json::from_str(s).ok()?;
        parsed.as_array()?.clone()
    } else {
        return None;
    };

    let points: Vec<SplinePoint> = points_arr
        .iter()
        .filter_map(|p| {
            let arr = p.as_array()?;
            if arr.len() >= 3 {
                Some(SplinePoint {
                    x: arr[0].as_f64()?,
                    y: arr[1].as_f64()?,
                    z: arr[2].as_f64()?,
                })
            } else {
                None
            }
        })
        .collect();

    if points.len() < 2 {
        return None;
    }

    let closed = params.extra.get("closed").and_then(|v| v.as_bool()).unwrap_or(false);
    let tension = params.extra.get("tension").and_then(|v| v.as_f64()).unwrap_or(0.5);

    Some(Spline {
        points,
        closed,
        tension,
    })
}

// ── DrawSpline engine ──────────────────────────────────────────────────────

pub struct DrawSpline;

impl Engine for DrawSpline {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let spline = parse_spline(params).unwrap_or(Spline {
            points: vec![
                SplinePoint { x: -0.5, y: 0.0, z: 0.0 },
                SplinePoint { x: 0.5, y: 0.0, z: 0.0 },
            ],
            closed: false,
            tension: 0.5,
        });
        let lut = build_spline_lut(&spline);
        let speed = params.extra.get("speed").and_then(|v| v.as_f64()).unwrap_or(1.0);
        let phase_offset = params.extra.get("phase_offset").and_then(|v| v.as_bool()).unwrap_or(true);

        let phase = if phase_offset {
            object_index as f64 / params.n_objects as f64
        } else {
            0.0
        };

        let tn = (speed * t / params.duration + phase) % 1.0;
        evaluate_spline(&lut, tn)
    }

    fn name(&self) -> &str {
        "draw_spline"
    }
}

// ── EvaluateSpline engine ──────────────────────────────────────────────────

pub struct EvaluateSpline;

impl Engine for EvaluateSpline {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let spline = parse_spline(params).unwrap_or(Spline {
            points: vec![
                SplinePoint { x: -0.5, y: 0.0, z: 0.0 },
                SplinePoint { x: 0.5, y: 0.0, z: 0.0 },
            ],
            closed: false,
            tension: 0.5,
        });
        let lut = build_spline_lut(&spline);
        let speed = params.extra.get("speed").and_then(|v| v.as_f64()).unwrap_or(1.0);
        let phase_offset = params.extra.get("phase_offset").and_then(|v| v.as_bool()).unwrap_or(true);

        let phase = if phase_offset {
            object_index as f64 / params.n_objects as f64
        } else {
            0.0
        };

        let tn = (speed * t / params.duration + phase) % 1.0;
        evaluate_spline(&lut, tn)
    }

    fn name(&self) -> &str {
        "evaluate_spline"
    }
}

// ── TrimSpline engine ──────────────────────────────────────────────────────

pub struct TrimSpline;

impl Engine for TrimSpline {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let spline = parse_spline(params).unwrap_or(Spline {
            points: vec![
                SplinePoint { x: -0.5, y: 0.0, z: 0.0 },
                SplinePoint { x: 0.5, y: 0.0, z: 0.0 },
            ],
            closed: false,
            tension: 0.5,
        });
        let lut = build_spline_lut(&spline);
        let speed = params.extra.get("speed").and_then(|v| v.as_f64()).unwrap_or(1.0);
        let phase_offset = params.extra.get("phase_offset").and_then(|v| v.as_bool()).unwrap_or(true);
        let trim_start = params.extra.get("trim_start").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let trim_end = params.extra.get("trim_end").and_then(|v| v.as_f64()).unwrap_or(1.0);

        let phase = if phase_offset {
            object_index as f64 / params.n_objects as f64
        } else {
            0.0
        };

        let tn = (speed * t / params.duration + phase) % 1.0;
        let trimmed = trim_start + tn * (trim_end - trim_start);
        evaluate_spline(&lut, trimmed)
    }

    fn name(&self) -> &str {
        "trim_spline"
    }
}

// ── OffsetSpline engine ────────────────────────────────────────────────────

pub struct OffsetSpline;

impl Engine for OffsetSpline {
    fn position(&self, t: f64, object_index: usize, params: &EngineParams) -> Vector3<f64> {
        let spline = parse_spline(params).unwrap_or(Spline {
            points: vec![
                SplinePoint { x: -0.5, y: 0.0, z: 0.0 },
                SplinePoint { x: 0.5, y: 0.0, z: 0.0 },
            ],
            closed: false,
            tension: 0.5,
        });
        let lut = build_spline_lut(&spline);
        let speed = params.extra.get("speed").and_then(|v| v.as_f64()).unwrap_or(1.0);
        let phase_offset = params.extra.get("phase_offset").and_then(|v| v.as_bool()).unwrap_or(true);
        let offset_x = params.extra.get("offset_x").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let offset_y = params.extra.get("offset_y").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let offset_z = params.extra.get("offset_z").and_then(|v| v.as_f64()).unwrap_or(0.0);

        let phase = if phase_offset {
            object_index as f64 / params.n_objects as f64
        } else {
            0.0
        };

        let tn = (speed * t / params.duration + phase) % 1.0;
        let mut pos = evaluate_spline(&lut, tn);
        pos.x += offset_x;
        pos.y += offset_y;
        pos.z += offset_z;
        pos
    }

    fn name(&self) -> &str {
        "offset_spline"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn create_params(n_objects: usize, duration: f64, extra: serde_json::Value) -> EngineParams {
        EngineParams {
            n_objects,
            duration,
            fps: 60.0,
            extra,
        }
    }

    #[test]
    fn test_catmull_rom_basic() {
        let spline = Spline {
            points: vec![
                SplinePoint { x: 0.0, y: 0.0, z: 0.0 },
                SplinePoint { x: 1.0, y: 0.0, z: 0.0 },
                SplinePoint { x: 1.0, y: 1.0, z: 0.0 },
                SplinePoint { x: 0.0, y: 1.0, z: 0.0 },
            ],
            closed: false,
            tension: 0.5,
        };
        let lut = build_spline_lut(&spline);
        assert!(lut.total_length > 2.0);

        let p0 = evaluate_spline(&lut, 0.0);
        let p1 = evaluate_spline(&lut, 1.0);
        assert!((p0.x - 0.0).abs() < 0.1);
        assert!((p1.y - 1.0).abs() < 0.1);
    }

    #[test]
    fn test_draw_spline() {
        let engine = DrawSpline;
        let params = create_params(
            1,
            4.0,
            json!({
                "points": [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0]],
                "closed": false,
                "tension": 0.5,
                "speed": 1.0
            }),
        );
        let pos = engine.position(0.0, 0, &params);
        assert!(pos.x.abs() < 0.2);
    }

    #[test]
    fn test_draw_spline_from_json_string() {
        // Simulate le frontend qui envoie points comme une string JSON sérialisée
        let engine = DrawSpline;
        let params = create_params(
            1,
            4.0,
            json!({
                "points": "[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 0.0]]",
                "closed": false,
                "tension": 0.5,
                "speed": 1.0
            }),
        );
        let pos = engine.position(0.0, 0, &params);
        assert!(pos.x.abs() < 0.2, "pos.x should be near 0 at t=0, got {}", pos.x);
    }
}
