# Rule: Modularization of files > 500 lines

## Goal

Ensure code maintainability by avoiding monolithic files. Any file exceeding **500 lines** must be reviewed to evaluate whether it can be split into smaller modules.

## Rule

### Review threshold

- **> 500 lines**: mandatory review — evaluate whether the file is modularizable
- **> 800 lines**: priority refactor — the file is almost certainly too large
- **> 1200 lines**: critical refactor — must be split before adding any new feature

### Review procedure

When a file exceeds 500 lines, before any new modification or feature addition:

1. **Identify the responsibilities** — List the file's distinct responsibilities (e.g.: `lib.rs` handles Tauri commands, graph parsing, animation launching, overrides, etc.)
2. **Evaluate the split** — For each responsibility, determine whether it can be extracted into a separate module/file without breaking the public API
3. **Prioritize** — If the file is already being modified, take the opportunity to extract at least one responsibility
4. **Document** — If the split is deferred, add a `// TODO: modularize — see modularization rule` comment at the top of the file

### Modularization criteria

A file should be split if:

- It contains **multiple unrelated functional domains** (e.g.: Tauri commands + JSON parsing + business logic)
- It has **clearly delimitable sections** marked by separator comments (`// ── Section ──`)
- It mixes **different abstraction levels** (e.g.: IPC + logic + UI)
- Its **imports** cover disparate domains
- The file is **hard to navigate** without search

### When NOT to split

- The file is a **coherent enum/struct definition** (e.g.: `graph.rs` with all the graph types)
- The file is a **Zustand store** that benefits from being in a single place for state coherence
- The split would create **circular dependencies**
- The file is **automatically generated**

### Completed work (2025)

| File | Lines before | Lines after | Status |
|---------|-------------|-------------|--------|
| `tauri-app/src-tauri/src/lib.rs` | 2178 | 361 | Done (20 modules extracted) |
| `tauri-app/frontend/src/store/useGraphStore.ts` | 1146 | 452 | Done (13 slices + utils + types) |
| `tauri-app/frontend/src/components/Scene3D.tsx` | 972 | 232 | Done (8 hooks extracted) |
| `rust-engines/src/runtime.rs` | 698 | split | Done (5 modules extracted) |
| `rust-engines/src/compiler.rs` | 1569 | `compiler/` 7 files | Done |
| `tauri-app/frontend/src/components/NodeEditor.tsx` | 985 | 747 | In progress — `useNodeInsertion` + `useGraphClipboard` extracted |

### Current targets (measured)

>1200 critical · >800 priority · >500 review. Test files excluded.

| File | Lines | Severity |
|------|-------|----------|
| `rust-engines/src/node_spec.rs` | 1439 | **critical** |
| `rust-engines/src/merge_runtime/loop_core.rs` | 1118 | priority |
| `rust-engines/src/validator.rs` | 1111 | priority |
| `rust-engines/src/runtime/mod.rs` | 1082 | priority |
| `tauri-app/src-tauri/src/cli/commands/moves.rs` | 933 | priority |
| `rust-engines/src/audio_capture.rs` | 922 | priority |
| `rust-engines/src/merge_runtime/transition.rs` | 882 | priority |
| `tauri-app/src-tauri/src/commands/merge_commands/move_management.rs` | 861 | priority |
| `tauri-app/frontend/src/components/panels/SpatialFxPanel.tsx` | 835 | priority |
| `rust-engines/src/osc_sender.rs` | 829 | priority |
| `rust-engines/src/signal_compiler.rs` | 818 | priority |
| `rust-engines/src/cuelist.rs` | 796 | review |
| `tauri-app/src-tauri/src/commands/cue_commands.rs` | 762 | review |
| `tauri-app/frontend/src/components/NodeEditor.tsx` | 747 | review |

### Application

This rule applies:
- **Before adding a feature** in a file > 500 lines
- **After a modification session** that pushes a file over 500 lines
- **During a refactor** — take the opportunity to reduce the size of touched files

### Verification tool

```bash
# List all files > 500 lines (excluding deps, archives, builds)
find . -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.rs' -o -name '*.py' \) \
  -not -path '*/node_modules/*' -not -path '*/target/*' -not -path '*/dist/*' \
  -not -path '*/_archive/*' -not -path '*/venv/*' -not -path './frontend/*' \
  -exec wc -l {} + | sort -rn | awk '$1 > 500 && $2 != "total" {print}'
```
