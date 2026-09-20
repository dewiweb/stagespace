//! Erreur IPC typée — `{"code":"...","message":"..."}` sur le wire au lieu
//! d'une string opaque. Le frontend wrappe en `BackendError` (code stable
//! matchable, message lisible dans les toasts).
//!
//! Migration incrémentale : les commands gardent leurs helpers internes en
//! `String` et classifient à la frontière via `IpcError::classify`.

use serde::Serialize;

/// Erreur de commande sérialisée vers le frontend.
/// `code` : snake_case stable — le frontend peut matcher dessus.
/// `message` : lisible, affiché dans les toasts.
#[derive(Debug, Clone, Serialize)]
pub struct IpcError {
    pub code: &'static str,
    pub message: String,
}

impl IpcError {
    /// Paramètres invalides / requête mal formée.
    pub fn validation(message: impl Into<String>) -> Self {
        Self {
            code: "validation",
            message: message.into(),
        }
    }

    /// Ressource introuvable (move, cue, fichier…).
    pub fn not_found(message: impl Into<String>) -> Self {
        Self {
            code: "not_found",
            message: message.into(),
        }
    }

    /// Conflit d'état (id déjà actif, doublon, génération obsolète).
    pub fn conflict(message: impl Into<String>) -> Self {
        Self {
            code: "conflict",
            message: message.into(),
        }
    }

    /// Opération refusée parce qu'une autre est en cours (recall…).
    pub fn busy(message: impl Into<String>) -> Self {
        Self {
            code: "busy",
            message: message.into(),
        }
    }

    /// Erreur d'I/O (fichier, socket, port).
    pub fn io(message: impl Into<String>) -> Self {
        Self {
            code: "io",
            message: message.into(),
        }
    }

    /// Erreur interne (compile, spawn, panic contenu…).
    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            code: "internal",
            message: message.into(),
        }
    }

    /// Classifie un message d'erreur legacy — frontière entre les helpers
    /// internes `String` et le contrat IPC typé. Heuristique volontairement
    /// conservative : en cas de doute → `internal`.
    pub fn classify(message: &str) -> Self {
        let m = message.to_lowercase();
        let code = if m.contains("not found") || m.contains("unknown") || m.contains("no cue") {
            "not_found"
        } else if m.contains("already") || m.contains("duplicate") || m.contains("generation") {
            "conflict"
        } else if m.contains("in progress") || m.contains("busy") {
            "busy"
        } else if m.contains("failed to read")
            || m.contains("failed to write")
            || m.contains("network")
            || m.contains("socket")
            || m.contains("bind")
            || m.contains("connect")
        {
            "io"
        } else if m.contains("invalid")
            || m.contains("usage:")
            || m.contains("missing")
            || m.contains("maximum")
        {
            "validation"
        } else {
            "internal"
        };
        Self {
            code,
            message: message.to_string(),
        }
    }
}

impl std::fmt::Display for IpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for IpcError {}

/// Conversion à la frontière : un `Err(format!(...))` legacy devient un
/// IpcError classifié — permet de migrer les signatures de commands sans
/// réécrire chaque site d'erreur interne.
impl From<String> for IpcError {
    fn from(message: String) -> Self {
        Self::classify(&message)
    }
}

impl From<&str> for IpcError {
    fn from(message: &str) -> Self {
        Self::classify(message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_maps_known_patterns() {
        assert_eq!(IpcError::classify("Move 'x' not found").code, "not_found");
        assert_eq!(
            IpcError::classify("Move 'x' is already active").code,
            "conflict"
        );
        assert_eq!(IpcError::classify("Cue recall in progress").code, "busy");
        assert_eq!(IpcError::classify("Failed to read file").code, "io");
        assert_eq!(IpcError::classify("Invalid port").code, "validation");
        assert_eq!(IpcError::classify("something exploded").code, "internal");
    }

    #[test]
    fn serializes_as_typed_object() {
        let e = IpcError::busy("recall in progress");
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["code"], "busy");
        assert_eq!(v["message"], "recall in progress");
    }
}
