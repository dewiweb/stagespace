# Contribuer à STAGESPACE

Merci de votre intérêt pour contribuer à STAGESPACE !
Voir aussi [AGENTS.md](AGENTS.md) pour les conventions détaillées.

## Développement

### Prérequis

- Rust 1.88+ (stable)
- Node.js 20+
- Deps système (Linux) : `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libasound2-dev patchelf`

### Installation

```bash
# Clone le repository
git clone https://github.com/dewiweb/stagespace.git
cd stagespace

# Build les moteurs Rust
cd rust-engines
cargo build

# Installe le frontend (requis par beforeBuildCommand)
cd ../tauri-app/frontend
npm install

# Lance l'application Tauri
cd ..
npm install
npm run tauri dev
```

### Structure du projet

```
stagespace/
├── rust-engines/          # Moteurs Rust purs
│   ├── src/
│   │   ├── engines/       # Moteurs de trajectoires
│   │   ├── runtime/       # Runtime temps réel + MergeRuntime
│   │   ├── compiler.rs    # Compilateur de graphe
│   │   ├── validator.rs   # Validation de graphe
│   │   ├── osc_sender.rs  # OSC out (+ canaux spatiaux étendus)
│   │   ├── osc_receiver.rs # OSC in (mappings, transforms, anti-loop)
│   │   ├── zones.rs       # Zones d'effets spatiaux
│   │   ├── kinematics.rs  # Modulations cinématiques
│   │   ├── audio.rs       # Audio IN (cpal + realfft)
│   │   ├── logging.rs     # Logging structuré
│   │   └── error.rs       # Gestion d'erreurs
│   └── Cargo.toml
├── tauri-app/
│   ├── src-tauri/         # Shell Tauri (Rust)
│   │   ├── src/           # Commands Tauri, AppState, CLI
│   │   └── tests/         # Tests E2E CLI (e2e_cli_test.sh)
│   └── frontend/          # UI React + TypeScript
│       ├── src/
│       │   ├── components/ # Composants React
│       │   └── store/      # Zustand store
│       └── package.json
├── _archive/              # Anciens prototypes (OSCAI, POC) — référence seulement
└── README.md
```

## Tests

### Tests Rust

```bash
cd rust-engines
cargo test --lib
cd ../tauri-app/src-tauri
cargo test --lib
bash tests/e2e_cli_test.sh   # tests E2E du workflow CLI
```

### Tests TypeScript

```bash
cd tauri-app/frontend
npm test           # vitest
npx tsc --noEmit   # type check
npm run lint       # eslint
```

## Style de code

### Rust

- Utiliser `cargo fmt` pour le formatage (vérifié en CI)
- Utiliser `cargo clippy --all-targets` pour les warnings (vérifié en CI, `-D warnings`)
- Suivre les conventions Rust standard
- Pas de `unwrap()` en production (modules de test uniquement)

### TypeScript

- Utiliser ESLint (vérifié en CI)
- Suivre les conventions TypeScript standard
- Utiliser des types stricts
- IPC Tauri via `safeInvoke` (`utils/tauri.ts`), pas `invoke` direct

## Ajouter un nouveau moteur

1. Créer un fichier dans `rust-engines/src/engines/`
2. Implémenter le trait `Engine`
3. Ajouter des tests unitaires
4. Ajouter le module dans `rust-engines/src/engines/mod.rs`
5. Ajouter le type dans le parser de graphe (`tauri-app/src-tauri/src/graph/`)
6. Ajouter le nœud dans le frontend (`nodeParamSchema.ts`, `NodeType` dans `store/types/`)

## Ajouter une nouvelle fonctionnalité

1. Ouvrir une issue pour discuter de la fonctionnalité
2. Fork le repository
3. Créer une branche pour votre fonctionnalité
4. Implémenter la fonctionnalité avec des tests
5. Soumettre une pull request

## Logging

STAGESPACE utilise `tracing` pour le logging. Voir `rust-engines/LOGGING.md` pour plus de détails.

## Gestion d'erreurs

STAGESPACE utilise `thiserror` pour la gestion d'erreurs. Voir `rust-engines/ERROR_HANDLING.md` pour plus de détails.

## Questions

Pour toute question, ouvrez une issue sur GitHub.
