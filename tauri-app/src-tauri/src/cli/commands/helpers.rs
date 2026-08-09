//! Fonctions utilitaires partagées entre les commandes CLI

use std::collections::HashMap;

/// Parse les arguments d'une commande (key=value ou --key value)
pub fn parse_args(parts: &[&str]) -> HashMap<String, String> {
    let mut args = HashMap::new();
    let mut i = 0;
    while i < parts.len() {
        let part = parts[i];
        if let Some(rest) = part.strip_prefix("--") {
            // --key value ou --key=value
            if let Some((k, v)) = rest.split_once('=') {
                args.insert(k.to_string(), v.to_string());
            } else if i + 1 < parts.len() && !parts[i + 1].starts_with("--") {
                args.insert(rest.to_string(), parts[i + 1].to_string());
                i += 1;
            } else {
                args.insert(rest.to_string(), "true".to_string());
            }
        }
        i += 1;
    }
    args
}

/// Parse une liste de tracks : "1,2,3" ou "1-5" ou "all"
pub fn parse_track_list(s: &str, all_ids: &[u32]) -> Result<Vec<u32>, String> {
    if s == "all" || s.is_empty() {
        return Ok(all_ids.to_vec());
    }
    let mut result = Vec::new();
    for part in s.split(',') {
        let part = part.trim();
        if let Some((start, end)) = part.split_once('-') {
            let start: u32 = start
                .parse()
                .map_err(|_| format!("Invalid track ID: {start}"))?;
            let end: u32 = end
                .parse()
                .map_err(|_| format!("Invalid track ID: {end}"))?;
            for id in start..=end {
                result.push(id);
            }
        } else {
            let id: u32 = part
                .parse()
                .map_err(|_| format!("Invalid track ID: {part}"))?;
            result.push(id);
        }
    }
    Ok(result)
}

/// Convertit des OSC IDs en indices de tracks
pub fn osc_ids_to_indices(osc_ids: &[u32], all_ids: &[u32]) -> Vec<usize> {
    osc_ids
        .iter()
        .filter_map(|id| all_ids.iter().position(|a| a == id))
        .collect()
}
