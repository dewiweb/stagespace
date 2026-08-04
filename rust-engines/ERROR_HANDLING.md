# Gestion d'Erreurs

STAGESPACE utilise `thiserror` pour une gestion d'erreurs structurée et type-safe.

## Types d'Erreurs

### `StagespaceError`

Enum principal représentant toutes les erreurs possibles dans STAGESPACE:

| Variante | Description |
|----------|-------------|
| `ValidationFailed` | Erreur de validation du graphe |
| `CompilationFailed` | Erreur de compilation du graphe |
| `RuntimeError` | Erreur de runtime |
| `OscError` | Erreur OSC |
| `AudioError` | Erreur audio |
| `NetworkError` | Erreur de réseau (wraps `std::io::Error`) |
| `SerializationError` | Erreur de sérialisation (wraps `serde_json::Error`) |
| `ParseError` | Erreur de parsing |
| `InvalidParameter` | Erreur de paramètre invalide |
| `MissingNode` | Erreur de nœud manquant |
| `InvalidConnection` | Erreur de connexion invalide |
| `CycleDetected` | Erreur de cycle détecté |
| `LimitExceeded` | Erreur de limite dépassée |

## Type Alias

```rust
pub type Result<T> = std::result::Result<T, StagespaceError>;
```

## Exemple d'utilisation

```rust
use stagespace_engines::{StagespaceError, Result};

fn ma_fonction() -> Result<()> {
    if condition {
        Err(StagespaceError::InvalidParameter("n_objects doit être > 0".to_string()))
    } else {
        Ok(())
    }
}
```

## Conversion automatique

Les erreurs standards sont automatiquement converties en `StagespaceError`:

```rust
// std::io::Error → StagespaceError::NetworkError
let socket = UdpSocket::bind("0.0.0.0:0")?;

// serde_json::Error → StagespaceError::SerializationError
let data: serde_json::Value = serde_json::from_str(json_str)?;
```

## Erreurs dans les logs

Les erreurs sont automatiquement loggées avec leur message:

```rust
log_compilation_error(&error.to_string());
```

## Propagation d'erreurs

Utilisez l'opérateur `?` pour propager les erreurs:

```rust
fn compile_graph(graph: &Graph) -> Result<CompiledFunction> {
    validate(graph)?;
    let func = compile(graph)?;
    Ok(func)
}
```

## Erreurs personnalisées

Pour ajouter une nouvelle erreur, ajoutez une variante à `StagespaceError`:

```rust
#[derive(Debug, Error)]
pub enum StagespaceError {
    // ...
    #[error("Custom error: {0}")]
    CustomError(String),
}
```
