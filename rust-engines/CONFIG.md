# Configuration

STAGESPACE utilise un système de configuration JSON pour définir les paramètres par défaut de l'application.

## Structure de la configuration

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

## Sections de configuration

### Runtime

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `default_fps` | f64 | 60.0 | FPS par défaut pour le playback |
| `default_duration` | f64 | 4.0 | Durée par défaut des trajectoires (secondes) |
| `max_objects` | usize | 1024 | Nombre maximum d'objets simulables |

### OSC

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `default_address` | String | "127.0.0.1" | Adresse OSC par défaut |
| `default_port` | u16 | 9000 | Port OSC par défaut |
| `default_profile` | String | "generic" | Profil OSC par défaut (iem, holophonix, ircam, generic, generic_polar, adm) |
| `default_object_offset` | u32 | 0 | Offset d'objet par défaut |

### Audio

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `default_source` | String | "microphone" | Source audio par défaut (microphone, file, stream) |
| `sample_rate` | u32 | 44100 | Fréquence d'échantillonnage |
| `fft_size` | usize | 1024 | Taille du buffer FFT |

### Graph

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `max_nodes` | usize | 1000 | Nombre maximum de nœuds dans un graphe |
| `max_edges` | usize | 5000 | Nombre maximum d'arêtes dans un graphe |
| `auto_validate` | bool | true | Validation automatique du graphe |

## Utilisation

### Charger la configuration par défaut

```rust
use stagespace_engines::Config;

let config = Config::default();
```

### Charger depuis un fichier

```rust
use stagespace_engines::Config;
use std::path::PathBuf;

let path = PathBuf::from("config.json");
let config = Config::load_from_file(&path)?;
```

### Sauvegarder dans un fichier

```rust
use stagespace_engines::Config;
use std::path::PathBuf;

let config = Config::default();
let path = PathBuf::from("config.json");
config.save_to_file(&path)?;
```

## Fichier de configuration par défaut

Un fichier `default_config.json` est fourni avec les valeurs par défaut. Vous pouvez le copier et le modifier pour créer votre propre configuration.

## Exemple de configuration personnalisée

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
