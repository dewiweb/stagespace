# Structured Logging

STAGESPACE uses `tracing` for structured, performant logging.

## Initialization

Logging is initialized automatically when the Tauri application starts via `init_logging()`.

## Configuration

The logging level can be configured via the `RUST_LOG` environment variable:

```bash
# Debug level
RUST_LOG=debug npm run tauri dev

# Info level (default)
RUST_LOG=info npm run tauri dev

# Error level only
RUST_LOG=error npm run tauri dev

# For a specific module
RUST_LOG=stagespace_engines=debug npm run tauri dev
```

## Available logging functions

### Runtime
- `log_runtime_init(fps, n_objects)` - Runtime initialization
- `log_playback_start(duration, osc_profile)` - Playback start
- `log_playback_stop()` - Playback stop

### Compilation
- `log_graph_compilation(node_count, edge_count)` - Compilation start
- `log_compilation_success(duration_ms)` - Successful compilation
- `log_compilation_error(error)` - Compilation error

### OSC
- `log_osc_message(address, data_len)` - OSC message sent
- `log_osc_error(error)` - OSC error
- `log_osc_received(address, handler)` - OSC message received

### Audio
- `log_audio_state(bpm, amplitude)` - Audio state
- `log_audio_error(error)` - Audio error

## Usage example

```rust
use stagespace_engines::{log_runtime_init, log_playback_start};

// In the runtime
log_runtime_init(60.0, 12);
log_playback_start(4.0, "holophonix");
```

## Production logs

In release mode, logs are disabled by default to optimize performance. To enable logs in production:

```bash
RUST_LOG=info npm run tauri build
```
