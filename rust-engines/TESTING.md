# Tests

STAGESPACE utilise une suite de tests complète pour assurer la qualité du code.

## Types de tests

### Tests unitaires

Les tests unitaires testent des composants individuels isolés.

- **Moteurs** : chaque moteur a des tests pour vérifier les positions calculées
- **Validator** : tests de validation de graphes
- **Compiler** : tests de compilation de graphes
- **Runtime** : tests de création et de playback
- **Audio** : tests de traitement audio
- **Config** : tests de configuration

### Tests d'intégration

Les tests d'intégration testent l'interaction entre plusieurs composants.

- **Compilation complète** : test de la compilation d'un graphe complet
- **Profils OSC** : test de tous les profils OSC
- **Sérialisation** : test de la sérialisation/désérialisation de graphes
- **Configuration** : test de la configuration JSON

## Exécuter les tests

### Tous les tests

```bash
cd rust-engines
cargo test --lib
```

### Tests spécifiques

```bash
# Tests d'intégration uniquement
cargo test --lib integration_tests

# Tests de configuration uniquement
cargo test --lib config_tests

# Tests d'un moteur spécifique
cargo test --lib circular
```

### Tests avec sortie détaillée

```bash
cargo test --lib -- --nocapture
```

### Tests avec backtrace

```bash
RUST_BACKTRACE=1 cargo test --lib
```

## Couverture de tests

Actuellement, STAGESPACE a **519 tests** qui couvrent :

- 22 moteurs (tests unitaires)
- Validation de graphes
- Compilation de graphes
- Runtime et playback
- Audio IN
- OSC IN/OUT
- Configuration
- Sérialisation

## Ajouter un nouveau test

### Test unitaire

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_my_function() {
        let result = my_function();
        assert_eq!(result, expected);
    }
}
```

### Test d'intégration

```rust
#[test]
fn test_integration_scenario() {
    // Setup
    let mut graph = Graph::new();
    
    // Act
    let compiled = Compiler::compile(&graph);
    
    // Assert
    assert!(compiled.is_ok());
}
```

## Bonnes pratiques

1. **Noms descriptifs** : utilisez des noms de tests qui décrivent ce qui est testé
2. **AAA pattern** : Arrange, Act, Assert
3. **Tests isolés** : chaque test doit être indépendant
4. **Assertions claires** : utilisez des messages d'erreur explicites
5. **Edge cases** : testez les cas limites et les erreurs

## CI/CD

Les tests sont exécutés automatiquement dans le pipeline CI/CD pour s'assurer que chaque commit ne casse pas la fonctionnalité existante.
