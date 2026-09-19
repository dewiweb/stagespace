//! Helpers de parsing tolérant pour les params de nodes graphe.
//!
//! Les params arrivent du frontend en JSON, mais les champs `text` de
//! l'éditeur sont stockés en string — une liste peut donc être `[0,2,4]`
//! (array) ou `"0,2,4"` / `"[0,2,4]"` (string). Ces helpers acceptent les
//! deux formes, comme le fait `DrawSpline` pour `points`.

use serde_json::Value;

/// f64 depuis un nombre ou une string numérique (`"1.5"` → 1.5).
/// String vide → None.
pub fn flex_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => {
            let s = s.trim();
            if s.is_empty() {
                None
            } else {
                s.parse::<f64>().ok()
            }
        }
        _ => None,
    }
}

/// f64 depuis `params[key]` — absent/null/vide → `default`.
pub fn param_f64_or(params: &Value, key: &str, default: f64) -> f64 {
    params.get(key).and_then(flex_f64).unwrap_or(default)
}

/// bool depuis un booléen ou une string (`"true"`, `"1"`, `"yes"`).
pub fn flex_bool(v: &Value) -> Option<bool> {
    match v {
        Value::Bool(b) => Some(*b),
        Value::String(s) => match s.trim().to_lowercase().as_str() {
            "true" | "1" | "yes" | "on" => Some(true),
            "false" | "0" | "no" | "off" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

/// Vec3 `[f64; 3]` depuis un array ou une string (`"0,1,2"` ou `"[0,1,2]"`).
pub fn flex_vec3(v: &Value) -> Option<[f64; 3]> {
    let parse_arr = |a: &[Value]| -> Option<[f64; 3]> {
        if a.len() == 3 {
            Some([flex_f64(&a[0])?, flex_f64(&a[1])?, flex_f64(&a[2])?])
        } else {
            None
        }
    };
    match v {
        Value::Array(a) => parse_arr(a),
        Value::String(s) => {
            let s = s.trim();
            // Essayer JSON d'abord ("[0,1,2]"), sinon CSV ("0,1,2")
            if let Ok(Value::Array(a)) = serde_json::from_str::<Value>(s) {
                return parse_arr(&a);
            }
            let parts: Vec<f64> = s
                .split(',')
                .filter_map(|p| p.trim().parse::<f64>().ok())
                .collect();
            if parts.len() == 3 {
                Some([parts[0], parts[1], parts[2]])
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Liste d'indices usize depuis un array ou une string
/// (`"0,2,4"`, `"[0,2,4]"`). String vide → None (= tous).
pub fn flex_usize_list(v: &Value) -> Option<Vec<usize>> {
    let parse_arr = |a: &[Value]| -> Vec<usize> {
        a.iter()
            .filter_map(|x| x.as_u64().map(|n| n as usize))
            .collect()
    };
    match v {
        Value::Array(a) => Some(parse_arr(a)),
        Value::String(s) => {
            let s = s.trim();
            if s.is_empty() {
                return None;
            }
            if let Ok(Value::Array(a)) = serde_json::from_str::<Value>(s) {
                return Some(parse_arr(&a));
            }
            Some(
                s.split(',')
                    .filter_map(|p| p.trim().parse::<usize>().ok())
                    .collect(),
            )
        }
        _ => None,
    }
}

/// usize optionnel depuis un nombre ou une string (vide → None).
pub fn flex_usize(v: &Value) -> Option<usize> {
    match v {
        Value::Number(n) => n.as_u64().map(|x| x as usize),
        Value::String(s) => {
            let s = s.trim();
            if s.is_empty() {
                None
            } else {
                s.parse::<usize>().ok()
            }
        }
        _ => None,
    }
}

/// Map canal→valeur depuis un objet JSON ou une string
/// (`"gain=0,spread=1"` ou `'{"gain":0}'`). Pairs invalides ignorés.
pub fn flex_f64_map(v: &Value) -> Vec<(String, f64)> {
    match v {
        Value::Object(map) => map
            .iter()
            .filter_map(|(k, x)| flex_f64(x).map(|f| (k.clone(), f)))
            .collect(),
        Value::String(s) => {
            let s = s.trim();
            if s.is_empty() {
                return Vec::new();
            }
            if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(s) {
                return map
                    .iter()
                    .filter_map(|(k, x)| flex_f64(x).map(|f| (k.clone(), f)))
                    .collect();
            }
            s.split(',')
                .filter_map(|pair| {
                    let (k, x) = pair.split_once('=')?;
                    Some((k.trim().to_string(), x.trim().parse::<f64>().ok()?))
                })
                .collect()
        }
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn flex_f64_forms() {
        assert_eq!(flex_f64(&json!(1.5)), Some(1.5));
        assert_eq!(flex_f64(&json!("1.5")), Some(1.5));
        assert_eq!(flex_f64(&json!("")), None);
        assert_eq!(flex_f64(&json!("abc")), None);
        assert_eq!(flex_f64(&json!(null)), None);
    }

    #[test]
    fn flex_vec3_forms() {
        assert_eq!(flex_vec3(&json!([1, 2, 3])), Some([1.0, 2.0, 3.0]));
        assert_eq!(flex_vec3(&json!("[1,2,3]")), Some([1.0, 2.0, 3.0]));
        assert_eq!(flex_vec3(&json!("1, 2, 3")), Some([1.0, 2.0, 3.0]));
        assert_eq!(flex_vec3(&json!([1, 2])), None);
        assert_eq!(flex_vec3(&json!("bad")), None);
    }

    #[test]
    fn flex_usize_list_forms() {
        assert_eq!(flex_usize_list(&json!([0, 2, 4])), Some(vec![0, 2, 4]));
        assert_eq!(flex_usize_list(&json!("0,2,4")), Some(vec![0, 2, 4]));
        assert_eq!(flex_usize_list(&json!("[0,2,4]")), Some(vec![0, 2, 4]));
        assert_eq!(flex_usize_list(&json!("")), None);
        assert_eq!(flex_usize_list(&json!(null)), None);
    }

    #[test]
    fn flex_f64_map_forms() {
        let m = flex_f64_map(&json!({"gain": 0.5, "spread": 1}));
        assert_eq!(m.len(), 2);
        let m = flex_f64_map(&json!("gain=0,spread=1"));
        assert_eq!(
            m,
            vec![("gain".to_string(), 0.0), ("spread".to_string(), 1.0)]
        );
        let m = flex_f64_map(&json!("{\"gain\":0.25}"));
        assert_eq!(m, vec![("gain".to_string(), 0.25)]);
        assert!(flex_f64_map(&json!("")).is_empty());
    }

    #[test]
    fn flex_bool_forms() {
        assert_eq!(flex_bool(&json!(true)), Some(true));
        assert_eq!(flex_bool(&json!("false")), Some(false));
        assert_eq!(flex_bool(&json!("on")), Some(true));
        assert_eq!(flex_bool(&json!("nope")), None);
    }
}
