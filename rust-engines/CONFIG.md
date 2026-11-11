# Configuration

STAGESPACE uses a JSON configuration system to define the application's default parameters.

## Configuration structure

```json
{
  "runtime": {
    "default_fps": 60.0,
    "default_duration": 4.0,
    "max_objects": 1024
  },
  "osc": {
    "default_address": "127.0.0.1",
    "default_port": 9000,
    "default_profile": "generic",
    "default_object_offset": 0
  },
  "audio": {
    "default_source": "microphone",
    "sample_rate": 44100,
    "fft_size": 1024
  },
  "graph": {
    "max_nodes": 1000,
    "max_edges": 5000,
    "auto_validate": true
  }
}
```

## Configuration sections

### Runtime

| Parameter | Type | Default | Description |
|-----------|------|--------|-------------|
| `default_fps` | f64 | 60.0 | Default FPS for playback |
| `default_duration` | f64 | 4.0 | Default trajectory duration (seconds) |
| `max_objects` | usize | 1024 | Maximum number of simulatable objects |

### OSC

| Parameter | Type | Default | Description |
|-----------|------|--------|-------------|
| `default_address` | String | "127.0.0.1" | Default OSC address |
| `default_port` | u16 | 9000 | Default OSC port |
| `default_profile` | String | "generic" | Default OSC profile (iem, holophonix, ircam, generic, generic_polar, adm) |
| `default_object_offset` | u32 | 0 | Default object offset |

### Audio

| Parameter | Type | Default | Description |
|-----------|------|--------|-------------|
| `default_source` | String | "microphone" | Default audio source (microphone, file, stream) |
| `sample_rate` | u32 | 44100 | Sample rate |
| `fft_size` | usize | 1024 | FFT buffer size |

### Graph

| Parameter | Type | Default | Description |
|-----------|------|--------|-------------|
| `max_nodes` | usize | 1000 | Maximum number of nodes in a graph |
| `max_edges` | usize | 5000 | Maximum number of edges in a graph |
| `auto_validate` | bool | true | Automatic graph validation |

## Usage

### Load the default configuration

```rust
use stagespace_engines::Config;

let config = Config::default();
```

### Load from a file

```rust
use stagespace_engines::Config;
use std::path::PathBuf;

let path = PathBuf::from("config.json");
let config = Config::load_from_file(&path)?;
```

### Save to a file

```rust
use stagespace_engines::Config;
use std::path::PathBuf;

let config = Config::default();
let path = PathBuf::from("config.json");
config.save_to_file(&path)?;
```

## Default configuration file

A `default_config.json` file is provided with the default values. You can copy and modify it to create your own configuration.

## Example custom configuration

```json
{
  "runtime": {
    "default_fps": 120.0,
    "default_duration": 8.0,
    "max_objects": 2048
  },
  "osc": {
    "default_address": "192.168.1.100",
    "default_port": 8000,
    "default_profile": "holophonix",
    "default_object_offset": 1
  },
  "audio": {
    "default_source": "file",
    "sample_rate": 48000,
    "fft_size": 2048
  },
  "graph": {
    "max_nodes": 2000,
    "max_edges": 10000,
    "auto_validate": true
  }
}
```
