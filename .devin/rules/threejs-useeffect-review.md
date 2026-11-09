---
trigger: always_on
---
# Règle : Review des useEffect dans le code Three.js

## Objectif

Les `useEffect` en React sont coûteux : ils se déclenchent à chaque changement de
dépendances, causent des re-renders, et peuvent créer des fuites mémoire si le
cleanup est oublié. Dans le contexte Three.js (render loop 60fps, objets GPU,
refs partagées), un `useEffect` mal placé peut dégrader les performances ou
créer des bugs subtils.

## Règle

**À chaque fois qu'on ajoute ou modifie un `useEffect` dans un fichier lié à
Three.js** (hooks, composants avec scène 3D, render loop), **review obligatoire**
pour vérifier s'il peut être remplacé par un mécanisme plus efficace.

### Alternatives à privilégier (par ordre de préférence)

1. **Ref sync inline** — Au lieu d'un `useEffect` qui sync une prop vers un ref,
   faire la sync directement dans le body du composant :

   ```tsx
   // ❌ Éviter
   useEffect(() => { positionsRef.current = positions; }, [positions]);

   // ✅ Préférer
   positionsRef.current = positions; // sync directe, pas de re-render
   ```

2. **useMemo / useCallback** — Pour les valeurs dérivées ou callbacks stables,
   préférer `useMemo` / `useCallback` plutôt qu'un `useEffect` qui met à jour un
   state.

3. **Event handler direct** — Au lieu d'un `useEffect` qui réagit à un changement
   de state, utiliser un event handler ou un callback directement au moment du
   changement.

4. **Zustand selector** — Au lieu d'un `useEffect` qui lit le store et sync vers
   un ref, utiliser un selector Zustand avec `useGraphStore((s) => s.xxx)` qui
   ne re-render que quand la valeur change.

5. **requestAnimationFrame** — Pour les mises à jour continues (positions,
   animations), utiliser la render loop existante (`useRenderLoop`) plutôt qu'un
   `useEffect` avec `setInterval` ou `requestAnimationFrame` séparé.

### Cas où un `useEffect` est justifié

Un `useEffect` reste légitime pour :

- **Setup one-shot avec cleanup** : création de la scène, renderer, caméra,
  OrbitControls — tout ce qui doit être créé une fois et disposé au unmount
- **Souscription à des events Tauri** : `listen("positions-update", ...)` avec
  cleanup `unlisten()`
- **ResizeObserver / IntersectionObserver** : avec cleanup dans le return
- **Effets de bord sur le DOM** : focus, scroll, measurement

### Checklist de review

Pour chaque `useEffect` dans du code Three.js, vérifier :

- [ ] **Peut-il être remplacé par une ref sync inline ?** (cas le plus fréquent)
- [ ] **A-t-il un cleanup ?** — Si oui, le cleanup dispose-t-il bien les objets
      Three.js (geometry, material, textures) ?
- [ ] **Ses dépendances sont-elles minimales ?** — Éviter `[...]` avec des objets
      qui changent à chaque render (créer des refs stables à la place)
- [ ] **Déclenche-t-il un re-render ?** — Si oui, est-ce nécessaire ? Un `setState`
      dans un `useEffect` cause un re-render supplémentaire
- [ ] **Tourne-t-il à 60fps ?** — Si oui, le déplacer dans la render loop
      existante (`useRenderLoop`) via un ref
- [ ] **Crée-t-il des objets Three.js ?** — Si oui, vérifier le cleanup pour
      éviter les fuites GPU

### Fichiers concernés

| Fichier | Rôle | Attention particulière |
|---------|------|------------------------|
| `useRenderLoop.ts` | Render loop 60fps | **JAMAIS** de deps React dans le `useEffect` principal — utiliser des refs internes |
| `useObjects3D.ts` | Création des sphères | Cleanup obligatoire (dispose geometry + material) |
| `useHolMarkers.ts` | Marqueurs .hol | Cleanup obligatoire |
| `useManipulateHandle.ts` | Handle + trajectory line | Cleanup obligatoire |
| `useManipulateMode.ts` | Handlers drag | Utiliser des refs pour éviter les stale closures |
| `useDrawMode.ts` | Handlers draw | Idem |
| `useInteractionModes.ts` | Toggle OrbitControls | Cleanup : restaurer les controls |
| `Scene3D.tsx` | Orchestration | Minimiser les `useEffect` — déléguer aux hooks |
| `TrajectoryVisualization.tsx` | Lignes de trajectoire | Cleanup des geometries |

### Exemple concret (déjà appliqué dans le codebase)

```tsx
// Dans useRenderLoop.ts — AVANT (bug potentiel)
const positionsRef = useRef(positions);
useEffect(() => {
  positionsRef.current = positions;
}, [positions]);  // ← useEffect inutile + re-render

// APRÈS (correct)
const positionsRef = useRef(positions);
positionsRef.current = positions;  // sync inline, pas de re-render
```

### Application

Cette règle s'applique :
- **À chaque ajout de `useEffect`** dans un fichier Three.js
- **À chaque review de code** touchant aux hooks Three.js
- **Lors d'un refactor** — profiter pour remplacer les `useEffect` inutiles par
  des ref syncs
