# Testing

STAGESPACE uses a comprehensive test suite to ensure code quality.

## Test types

### Unit tests

Unit tests test isolated individual components.

- **Engines**: each engine has tests verifying computed positions
- **Validator**: graph validation tests
- **Compiler**: graph compilation tests
- **Runtime**: creation and playback tests
- **Audio**: audio processing tests
- **Config**: configuration tests

### Integration tests

Integration tests test the interaction between multiple components.

- **Full compilation**: testing compilation of a complete graph
- **OSC profiles**: testing all OSC profiles
- **Serialization**: graph serialization/deserialization tests
- **Configuration**: JSON configuration tests

## Running the tests

### All tests

```bash
cd rust-engines
cargo test --lib
```

### Specific tests

```bash
# Integration tests only
cargo test --lib integration_tests

# Configuration tests only
cargo test --lib config_tests

# Tests for a specific engine
cargo test --lib circular
```

### Tests with verbose output

```bash
cargo test --lib -- --nocapture
```

### Tests with backtrace

```bash
RUST_BACKTRACE=1 cargo test --lib
```

## Test coverage

STAGESPACE currently has **519 tests** covering:

- 22 engines (unit tests)
- Graph validation
- Graph compilation
- Runtime and playback
- Audio IN
- OSC IN/OUT
- Configuration
- Serialization

## Adding a new test

### Unit test

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

### Integration test

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

## Best practices

1. **Descriptive names**: use test names that describe what is being tested
2. **AAA pattern**: Arrange, Act, Assert
3. **Isolated tests**: each test must be independent
4. **Clear assertions**: use explicit error messages
5. **Edge cases**: test boundary cases and errors

## CI/CD

Tests run automatically in the CI/CD pipeline to ensure each commit doesn't break existing functionality.
