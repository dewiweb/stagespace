# Error Handling

STAGESPACE uses `thiserror` for structured, type-safe error handling.

## Error Types

### `StagespaceError`

Main enum representing all possible errors in STAGESPACE:

| Variant | Description |
|----------|-------------|
| `ValidationFailed` | Graph validation error |
| `CompilationFailed` | Graph compilation error |
| `RuntimeError` | Runtime error |
| `OscError` | OSC error |
| `AudioError` | Audio error |
| `NetworkError` | Network error (wraps `std::io::Error`) |
| `SerializationError` | Serialization error (wraps `serde_json::Error`) |
| `ParseError` | Parsing error |
| `InvalidParameter` | Invalid parameter error |
| `MissingNode` | Missing node error |
| `InvalidConnection` | Invalid connection error |
| `CycleDetected` | Detected cycle error |
| `LimitExceeded` | Exceeded limit error |

## Type Alias

```rust
pub type Result<T> = std::result::Result<T, StagespaceError>;
```

## Usage example

```rust
use stagespace_engines::{StagespaceError, Result};

fn my_function() -> Result<()> {
    if condition {
        Err(StagespaceError::InvalidParameter("n_objects must be > 0".to_string()))
    } else {
        Ok(())
    }
}
```

## Automatic conversion

Standard errors are automatically converted to `StagespaceError`:

```rust
// std::io::Error → StagespaceError::NetworkError
let socket = UdpSocket::bind("0.0.0.0:0")?;

// serde_json::Error → StagespaceError::SerializationError
let data: serde_json::Value = serde_json::from_str(json_str)?;
```

## Errors in logs

Errors are automatically logged with their message:

```rust
log_compilation_error(&error.to_string());
```

## Error propagation

Use the `?` operator to propagate errors:

```rust
fn compile_graph(graph: &Graph) -> Result<CompiledFunction> {
    validate(graph)?;
    let func = compile(graph)?;
    Ok(func)
}
```

## Custom errors

To add a new error, add a variant to `StagespaceError`:

```rust
#[derive(Debug, Error)]
pub enum StagespaceError {
    // ...
    #[error("Custom error: {0}")]
    CustomError(String),
}
```
