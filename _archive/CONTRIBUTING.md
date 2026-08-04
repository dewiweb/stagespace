# Contribuer à HOLOFLOW

Merci de votre intérêt pour contribuer à HOLOFLOW !

## Développement

### Prérequis

- Rust 1.70+
- Node.js 18+
- npm ou yarn

### Installation

```bash
# Clone le repository
git clone https://github.com/dewiweb/stagespace.git
cd stagespace

# Build les moteurs Rust
cd rust-engines
cargo build

# Build l'application Tauri
cd ../tauri-app
npm install
npm run tauri dev
```

### Structure du projet

```
stagespace/
├── rust-engines/          # Moteurs Rust purs
│   ├── src/
│   │   ├── engines/       # Moteurs de trajectoires
│   │   ├── runtime.rs     # Runtime temps réel
│   │   ├── compiler.rs    # Compilateur de graphe
│   │   ├── validator.rs   # Validation de graphe
│   │   ├── osc_sender.rs  # OSC out
│   │   ├── osc_receiver.rs # OSC in
│   │   ├── audio.rs       # Audio IN
│   │   ├── logging.rs     # Logging structuré
│   │   └── error.rs       # Gestion d'erreurs
│   └── Cargo.toml
├── tauri-app/
│   ├── src-tauri/         # Shell Tauri (Rust)
│   │   ├── src/
│   │   │   └── lib.rs     # Commands Tauri
│   │   └── Cargo.toml
│   └── frontend/          # UI React + TypeScript
│       ├── src/
│       │   ├── components/ # Composants React
│       │   └── store/      # Zustand store
│       └── package.json
└── README.md
```

## Tests

### Tests Rust

```bash
cd rust-engines
cargo test --lib
```

### Tests TypeScript

```bash
cd tauri-app/frontend
npx tsc --noEmit
```

## Style de code

### Rust

- Utiliser `cargo fmt` pour le formatage
- Utiliser `cargo clippy` pour les warnings
- Suivre les conventions Rust standard

### TypeScript

- Utiliser ESLint et Prettier
- Suivre les conventions TypeScript standard
- Utiliser des types stricts

## Ajouter un nouveau moteur

1. Créer un fichier dans `rust-engines/src/engines/`
2. Implémenter le trait `Engine`
3. Ajouter des tests unitaires
4. Ajouter le module dans `rust-engines/src/engines/mod.rs`
5. Ajouter le type dans `rust-engines/src/graph.rs`
6. Ajouter le nœud dans le frontend `NodeEditor.tsx`

## Ajouter une nouvelle fonctionnalité

1. Ouvrir une issue pour discuter de la fonctionnalité
2. Fork le repository
3. Créer une branche pour votre fonctionnalité
4. Implémenter la fonctionnalité avec des tests
5. Soumettre une pull request

## Logging

HOLOFLOW utilise `tracing` pour le logging. Voir `LOGGING.md` pour plus de détails.

## Gestion d'erreurs

HOLOFLOW utilise `thiserror` pour la gestion d'erreurs. Voir `ERROR_HANDLING.md` pour plus de détails.

## Questions

Pour toute question, ouvrez une issue sur GitHub.
