//! Commandes CLI : sampling, perf stats, templates

use crate::cli_state;
use crate::graph_presets;

use super::helpers::parse_args;

pub fn cmd_sample(args: &[&str]) -> Result<String, String> {
    let opts = parse_args(args);
    let move_id = opts
        .get("move")
        .ok_or("Usage: sample --move <id> [--obj 0] [--samples 50] [--duration 4]")?;

    let object_index: usize = opts.get("obj").and_then(|s| s.parse().ok()).unwrap_or(0);
    let n_samples: usize = opts
        .get("samples")
        .and_then(|s| s.parse().ok())
        .unwrap_or(50);
    let duration: f64 = opts
        .get("duration")
        .and_then(|s| s.parse().ok())
        .unwrap_or(4.0);

    let state = cli_state::state();
    let movements = state.movements.lock().unwrap();
    let movement = movements
        .get(move_id)
        .or_else(|| {
            // Recherche case-insensitive
            let lower = move_id.to_lowercase();
            movements
                .iter()
                .find(|(k, _)| k.to_lowercase() == lower)
                .map(|(_, v)| v)
        })
        .ok_or_else(|| {
            format!("Move '{move_id}' not found. Use 'list-moves' to see active moves.")
        })?;

    let raw_samples =
        movement
            .runtime
            .sample_trajectory(object_index, n_samples.max(2), duration.max(0.1));
    drop(movements);

    // Appliquer le post-process global
    let mr = state.merge_runtime.lock().unwrap();
    let samples = mr.apply_post_process_to_samples(raw_samples, object_index);

    // Format: t, x, y, z (CSV)
    let mut out =
        format!("# move={move_id} obj={object_index} samples={n_samples} duration={duration}s\n");
    out.push_str("# t, x, y, z\n");
    for (t, x, y, z) in &samples {
        out.push_str(&format!("{t:.3}, {x:.6}, {y:.6}, {z:.6}\n"));
    }

    // Stats rapides
    if !samples.is_empty() {
        let xs: Vec<f64> = samples.iter().map(|s| s.1).collect();
        let ys: Vec<f64> = samples.iter().map(|s| s.2).collect();
        let zs: Vec<f64> = samples.iter().map(|s| s.3).collect();
        let x_range = xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
            - xs.iter().cloned().fold(f64::INFINITY, f64::min);
        let y_range = ys.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
            - ys.iter().cloned().fold(f64::INFINITY, f64::min);
        let z_range = zs.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
            - zs.iter().cloned().fold(f64::INFINITY, f64::min);
        out.push_str(&format!(
            "# range: x=[{x_range:.3}], y=[{y_range:.3}], z=[{z_range:.3}]\n"
        ));
    }

    Ok(out)
}

pub fn cmd_perf(_args: &[&str]) -> Result<String, String> {
    let state = cli_state::state();
    let merge_rt = state.merge_runtime.lock().unwrap();
    let stats = merge_rt.get_perf_stats();

    let movements = state.movements.lock().unwrap();
    let out = format!(
        "MergeRuntime:\n  fps: {:.1}\n  osc_rate: {:.1}\n  latency_ms: {:.2}\n  cpu_percent: {:.1}\n  active_moves: {}\n  osc_ids: {}\n",
        stats.fps,
        stats.osc_rate,
        stats.latency_ms,
        stats.cpu_percent,
        movements.len(),
        merge_rt.osc_ids().len()
    );
    Ok(out)
}

pub fn cmd_templates(_args: &[&str]) -> Result<String, String> {
    let templates = graph_presets::list_templates();
    let mut out = format!("{:<15} {}\n", "Template", "Description");
    out.push_str(&"─".repeat(50));
    out.push('\n');
    for (id, desc) in &templates {
        out.push_str(&format!("{id:<15} {desc}\n"));
    }
    Ok(out)
}
