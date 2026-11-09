---
trigger: always_on
---
# Règle : Modularisation des fichiers > 500 lignes

## Objectif

Garantir la maintenabilité du code en évitant les fichiers monolithiques. Tout fichier dépassant **500 lignes** doit être revu pour évaluer s'il peut être découpé en modules plus petits.

## Règle

### Seuil de review

- **> 500 lignes** : review obligatoire — évaluer si le fichier est modularisable
- **> 800 lignes** : refactor prioritaire — le fichier est presque certainement trop gros
- **> 1200 lignes** : refactor critique — découper impérativement avant d'ajouter toute nouvelle fonctionnalité

### Procédure de review

Quand un fichier dépasse 500 lignes, avant toute nouvelle modification ou ajout de fonctionnalité :

1. **Identifier les responsabilités** — Lister les responsabilités distinctes du fichier (ex: `lib.rs` gère les commands Tauri, le parsing de graphe, le lancement d'animations, les overrides, etc.)
2. **Évaluer le découpage** — Pour chaque responsabilité, déterminer si elle peut être extraite dans un module/fichier séparé sans casser l'API publique
3. **Prioriser** — Si le fichier est déjà en cours de modification, profiter de l'occasion pour extraire au moins une responsabilité
4. **Documenter** — Si le découpage est reporté, ajouter un commentaire `// TODO: modulariser — voir règle modularisation` en tête de fichier

### Critères de modularisation

Un fichier doit être découpé si :

- Il contient **plusieurs domaines fonctionnels** non liés (ex: commands Tauri + parsing JSON + logique métier)
- Il a **des sections clairement délimitables** par des commentaires séparateurs (`// ── Section ──`)
- Il mélange **différents niveaux d'abstraction** (ex: IPC + logique + UI)
- Les **imports** couvrent des domaines disparates
- Le fichier est **difficile à naviguer** sans search

### Quand NE PAS découper

- Le fichier est une **enum/struct definition** cohérente (ex: `graph.rs` avec tous les types du graphe)
- Le fichier est un **store Zustand** qui bénéficie d'être en un seul endroit pour la cohérence du state
- Le découpe créerait des **dépendances circulaires**
- Le fichier est **généré automatiquement**

### Cibles actuelles (août 2025)

| Fichier | Lignes avant | Lignes après Phase 4 | Statut | Action recommandée |
|---------|-------------|----------------------|--------|---------------------|
| `tauri-app/src-tauri/src/lib.rs` | 2178 | 361 | OK (<500) | Phases 1-4 faites (20 modules extraits). Termine ! |
| `tauri-app/frontend/src/store/useGraphStore.ts` | 1146 | 452 | OK (<500) | Phases 1-4 faites (13 slices + utils + types). Termine ! |
| `tauri-app/frontend/src/components/Scene3D.tsx` | 972 | 232 | OK (<500) | Phases 1-3 faites (8 hooks extraits). Termine ! |
| `rust-engines/src/runtime.rs` | 698 | 499 | OK (<500) | Phases 1-2 faites (5 modules extraits). Termine !

### Application

Cette règle s'applique :
- **Avant d'ajouter une fonctionnalité** dans un fichier > 500 lignes
- **Après une session de modifications** qui fait dépasser 500 lignes à un fichier
- **Lors d'un refactor** — profiter pour réduire la taille des fichiers touchés

### Outil de vérification

```bash
# Lister tous les fichiers > 500 lignes (hors deps, archives, builds)
find . -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.rs' -o -name '*.py' \) \
  -not -path '*/node_modules/*' -not -path '*/target/*' -not -path '*/dist/*' \
  -not -path '*/_archive/*' -not -path '*/venv/*' -not -path './frontend/*' \
  -exec wc -l {} + | sort -rn | awk '$1 > 500 && $2 != "total" {print}'
```
