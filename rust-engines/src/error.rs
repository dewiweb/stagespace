use thiserror::Error;

/// Erreur principale de STAGESPACE
#[derive(Debug, Error)]
pub enum StagespaceError {
    /// Erreur de validation du graphe
    #[error("Graph validation failed: {0}")]
    ValidationFailed(String),

    /// Erreur de compilation du graphe
    #[error("Graph compilation failed: {0}")]
    CompilationFailed(String),

    /// Erreur de runtime
    #[error("Runtime error: {0}")]
    RuntimeError(String),

    /// Erreur OSC
    #[error("OSC error: {0}")]
    OscError(String),

    /// Erreur audio
    #[error("Audio error: {0}")]
    AudioError(String),

    /// Erreur de réseau
    #[error("Network error: {0}")]
    NetworkError(#[from] std::io::Error),

    /// Erreur de sérialisation
    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),

    /// Erreur de parsing
    #[error("Parse error: {0}")]
    ParseError(String),

    /// Erreur de paramètre invalide
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),

    /// Erreur de nœud manquant
    #[error("Missing node: {0}")]
    MissingNode(String),

    /// Erreur de connexion invalide
    #[error("Invalid connection: {0}")]
    InvalidConnection(String),

    /// Erreur de cycle détecté
    #[error("Cycle detected in graph")]
    CycleDetected,

    /// Erreur de limite dépassée
    #[error("Limit exceeded: {0}")]
    LimitExceeded(String),
}

/// Type de résultat pour STAGESPACE
pub type Result<T> = std::result::Result<T, StagespaceError>;
