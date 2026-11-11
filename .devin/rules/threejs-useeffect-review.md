# Rule: useEffect review in Three.js code

## Goal

`useEffect`s in React are expensive: they fire on every dependency
change, cause re-renders, and can create memory leaks if cleanup is
forgotten. In the Three.js context (60fps render loop, GPU objects,
shared refs), a misplaced `useEffect` can degrade performance or
create subtle bugs.

## Rule

**Every time a `useEffect` is added or modified in a Three.js-related file** (hooks, components with a 3D scene, render loop), a **mandatory review** verifies whether it can be replaced by a more efficient mechanism.

### Preferred alternatives (in order of preference)

1. **Inline ref sync** — Instead of a `useEffect` syncing a prop to a ref,
   do the sync directly in the component body:

   ```tsx
   // ❌ Avoid
   useEffect(() => { positionsRef.current = positions; }, [positions]);

   // ✅ Prefer
   positionsRef.current = positions; // direct sync, no re-render
   ```

2. **useMemo / useCallback** — For derived values or stable callbacks,
   prefer `useMemo` / `useCallback` over a `useEffect` that updates
   state.

3. **Direct event handler** — Instead of a `useEffect` reacting to a state
   change, use an event handler or a callback at the moment of the
   change.

4. **Zustand selector** — Instead of a `useEffect` reading the store and
   syncing to a ref, use a Zustand selector `useGraphStore((s) => s.xxx)`
   which only re-renders when the value changes.

5. **requestAnimationFrame** — For continuous updates (positions,
   animations), use the existing render loop (`useRenderLoop`) rather than a
   `useEffect` with `setInterval` or a separate `requestAnimationFrame`.

### Cases where a `useEffect` is justified

A `useEffect` remains legitimate for:

- **One-shot setup with cleanup**: scene creation, renderer, camera,
  OrbitControls — anything that must be created once and disposed on unmount
- **Tauri event subscriptions**: `listen("positions-update", ...)` with
  `unlisten()` cleanup
- **ResizeObserver / IntersectionObserver**: with cleanup in the return
- **DOM side effects**: focus, scroll, measurement

### Review checklist

For each `useEffect` in Three.js code, verify:

- [ ] **Can it be replaced by an inline ref sync?** (most frequent case)
- [ ] **Does it have a cleanup?** — If yes, does the cleanup properly
      dispose Three.js objects (geometry, material, textures)?
- [ ] **Are its dependencies minimal?** — Avoid `[...]` with objects
      that change every render (create stable refs instead)
- [ ] **Does it trigger a re-render?** — If yes, is it needed? A `setState`
      in a `useEffect` causes an extra re-render
- [ ] **Does it run at 60fps?** — If yes, move it into the existing
      render loop (`useRenderLoop`) via a ref
- [ ] **Does it create Three.js objects?** — If yes, check cleanup to
      avoid GPU leaks

### Affected files

| File | Role | Particular attention |
|---------|------|------------------------|
| `useRenderLoop.ts` | 60fps render loop | **NEVER** React deps in the main `useEffect` — use internal refs |
| `useObjects3D.ts` | Sphere creation | Cleanup mandatory (dispose geometry + material) |
| `useHolMarkers.ts` | .hol markers | Cleanup mandatory |
| `useManipulateHandle.ts` | Handle + trajectory line | Cleanup mandatory |
| `useManipulateMode.ts` | Drag handlers | Use refs to avoid stale closures |
| `useDrawMode.ts` | Draw handlers | Same |
| `useInteractionModes.ts` | OrbitControls toggle | Cleanup: restore controls |
| `Scene3D.tsx` | Orchestration | Minimize `useEffect`s — delegate to hooks |
| `TrajectoryVisualization.tsx` | Trajectory lines | Geometry cleanup |

### Concrete example (already applied in the codebase)

```tsx
// In useRenderLoop.ts — BEFORE (potential bug)
const positionsRef = useRef(positions);
useEffect(() => {
  positionsRef.current = positions;
}, [positions]);  // ← useless useEffect + re-render

// AFTER (correct)
const positionsRef = useRef(positions);
positionsRef.current = positions;  // inline sync, no re-render
```

### Application

This rule applies:
- **On every `useEffect` addition** in a Three.js file
- **On every code review** touching Three.js hooks
- **During a refactor** — take the opportunity to replace useless
  `useEffect`s with ref syncs
