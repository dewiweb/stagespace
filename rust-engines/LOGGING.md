# Logging Structuré

STAGESPACE utilise `tracing` pour un logging structuré et performant.

## Initialisation

Le logging est initialisé automatiquement au démarrage de l'application Tauri via `init_logging()`.

## Configuration

Le niveau de logging peut être configuré via la variable d'environnement `RUST_LOG`:

```bash
# Debug level
RUST_LOG=debug npm run tauri dev

# Info level (par défaut)
RUST_LOG=info npm run tauri dev

# Error level uniquement
RUST_LOG=error npm run tauri dev

# Pour un module spécifique
RUST_LOG=stagespace_engines=debug npm run tauri dev
```

## Fonctions de logging disponibles

### Runtime
- `log_runtime_init(fps, n_objects)` - Initialisation du runtime
- `log_playback_start(duration, osc_profile)` - Début du playback
- `log_playback_stop()` - Arrêt du playback

### Compilation
- `log_graph_compilation(node_count, edge_count)` - Début de la compilation
- `log_compilation_success(duration_ms)` - Compilation réussie
- `log_compilation_error(error)` - Erreur de compilation

### OSC
- `log_osc_message(address, data_len)` - Message OSC envoyé
- `log_osc_error(error)` - Erreur OSC
- `log_osc_received(address, handler)` - Message OSC reçu

### Audio
- `log_audio_state(bpm, amplitude)` - État audio
- `log_audio_error(error)` - Erreur audio

## Exemple d'utilisation

```rust
use stagespace_engines::{log_runtime_init, log_playback_start};

// Dans le runtime
log_runtime_init(60.0, 12);
log_playback_start(4.0, "holophonix");
```

## Logs en production

En mode release, les logs sont désactivés par défaut pour optimiser les performances. Pour activer les logs en production:

```bash
RUST_LOG=info npm run tauri build
```
