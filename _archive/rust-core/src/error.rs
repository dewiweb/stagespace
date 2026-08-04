//! Error types for HOLOFLOW Core

use std::fmt;
use std::io;

#[derive(Debug)]
pub enum HoloflowError {
    OscError(String),
    IpcError(String),
    EngineError(String),
    IoError(io::Error),
    SerializationError(serde_json::Error),
    InvalidParameter(String),
}

impl fmt::Display for HoloflowError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HoloflowError::OscError(msg) => write!(f, "OSC error: {}", msg),
            HoloflowError::IpcError(msg) => write!(f, "IPC error: {}", msg),
            HoloflowError::EngineError(msg) => write!(f, "Engine error: {}", msg),
            HoloflowError::IoError(err) => write!(f, "IO error: {}", err),
            HoloflowError::SerializationError(err) => write!(f, "Serialization error: {}", err),
            HoloflowError::InvalidParameter(msg) => write!(f, "Invalid parameter: {}", msg),
        }
    }
}

impl std::error::Error for HoloflowError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            HoloflowError::IoError(err) => Some(err),
            HoloflowError::SerializationError(err) => Some(err),
            _ => None,
        }
    }
}

impl From<io::Error> for HoloflowError {
    fn from(err: io::Error) -> Self {
        HoloflowError::IoError(err)
    }
}

impl From<serde_json::Error> for HoloflowError {
    fn from(err: serde_json::Error) -> Self {
        HoloflowError::SerializationError(err)
    }
}

pub type Result<T> = std::result::Result<T, HoloflowError>;