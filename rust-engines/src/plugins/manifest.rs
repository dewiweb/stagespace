use serde::{Deserialize, Serialize};

/// Version de l'ABI host ↔ invité supportée par ce build.
/// Bump quand la signature `plugin_position` ou le layout des buffers change.
pub const HOST_ABI_VERSION: u32 = 1;

/// Taille max du JSON de params écrit dans le buffer statique du plugin.
/// Le plugin doit réserver un buffer `plugin_params_ptr` ≥ cette taille.
pub const MAX_PARAMS_BYTES: usize = 64 * 1024;

/// Catégorie de node fournie par le plugin.
/// v1 : engines purs uniquement (modifier/composite = ABI v2 — un modifier
/// exigerait de passer la closure upstream en mémoire wasm).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginKind {
    Engine,
}

/// Déclaration d'un paramètre exposé par le plugin — mêmes types que
/// `ParamDef` côté frontend (`NodeParamField` rend ces types génériquement).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginParamDef {
    pub key: String,
    #[serde(rename = "type")]
    pub param_type: String,
    #[serde(default)]
    pub default: serde_json::Value,
    #[serde(default)]
    pub min: Option<f64>,
    #[serde(default)]
    pub max: Option<f64>,
    #[serde(default)]
    pub step: Option<f64>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub options: Option<Vec<String>>,
    #[serde(default)]
    pub live: Option<bool>,
}

/// Manifeste `manifest.json` d'un bundle `.ssx`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub author: Option<String>,
    pub abi_version: u32,
    pub kind: PluginKind,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub params: Vec<PluginParamDef>,
    /// Capacités host demandées (audio, osc_in…) — deny par défaut, aucune
    /// n'est accordée en ABI v1.
    #[serde(default)]
    pub capabilities: Vec<String>,
}

/// Types de paramètres rendus par `NodeParamField` côté frontend.
const VALID_PARAM_TYPES: &[&str] = &["number", "boolean", "enum", "vec3", "text", "string"];

impl PluginManifest {
    /// Valide la cohérence du manifeste — appelé au chargement du bundle.
    /// Un manifeste invalide refuse le plugin sans affecter les autres.
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() || self.id.len() > 64 {
            return Err("id must be 1-64 chars".to_string());
        }
        if !self
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return Err(format!("id '{}' must be [a-zA-Z0-9_-] only", self.id));
        }
        if self.name.is_empty() {
            return Err("name must be non-empty".to_string());
        }
        if self.abi_version == 0 || self.abi_version > HOST_ABI_VERSION {
            return Err(format!(
                "abi_version {} not supported (host ABI = {})",
                self.abi_version, HOST_ABI_VERSION
            ));
        }

        let mut seen = std::collections::HashSet::new();
        for p in &self.params {
            if p.key.is_empty() {
                return Err("param key must be non-empty".to_string());
            }
            if !seen.insert(&p.key) {
                return Err(format!("duplicate param key '{}'", p.key));
            }
            if !VALID_PARAM_TYPES.contains(&p.param_type.as_str()) {
                return Err(format!(
                    "param '{}': unknown type '{}' (expected one of {:?})",
                    p.key, p.param_type, VALID_PARAM_TYPES
                ));
            }
            if p.param_type == "enum" && p.options.as_ref().is_none_or(|o| o.is_empty()) {
                return Err(format!("param '{}': enum type requires options", p.key));
            }
            if let (Some(min), Some(max)) = (p.min, p.max) {
                if min >= max {
                    return Err(format!("param '{}': min must be < max", p.key));
                }
            }
        }
        Ok(())
    }
}
