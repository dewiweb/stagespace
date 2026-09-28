//! Erreur IPC typée — `{"code":"...","message":"..."}` sur le wire au lieu
//! d'une string opaque. Le frontend wrappe en `BackendError` (code stable
//! matchable, message lisible dans les toasts).
//!
//! Migration incrémentale : les commands gardent leurs helpers internes en
//! `String` et classifient à la frontière via `IpcError::classify`.

use serde::Serialize;
use ts_rs::TS;

/// Erreur de commande sérialisée vers le frontend.
/// `code` : snake_case stable — le frontend peut matcher dessus.
/// `message` : lisible, affiché dans les toasts.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct IpcError {
    #[ts(type = "string")]
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
}

impl std::fmt::Display for IpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for IpcError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_typed_object() {
        let e = IpcError::busy("recall in progress");
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["code"], "busy");
        assert_eq!(v["message"], "recall in progress");
    }
}
