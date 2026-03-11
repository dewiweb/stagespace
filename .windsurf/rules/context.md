---
trigger: always_on
---
# Contexte du projet HOLOFLOW

## Résumé

**HOLOFLOW** est un moteur de trajectoires spatiales temps réel, piloté par un graphe de nœuds,
compilé en fonctions continues `f(t)` — destiné au contrôle OSC de sources audio spatialisées
(Holophonix, SPAT Revolution, IEM, tout récepteur OSC).

---

## Corpus d'inspiration — projets antérieurs

### `holophonix-animator` (`C:\Users\Administrateur\Documents\GitHub\holophonix-animator`)
- **Stack** : Electron + React + TypeScript + Three.js + Zustand
- **Apports retenus** :
  - Multi-track mode Barycentric (iso/centered/custom/shared)
  - Phase offset entre tracks d'un groupe
  - Formations automatiques (ligne, arc, cercle, grille)
  - Fade-in/out comme subanimation (→ remplacé par TimeFalloff)
  - Cue system (→ simplifié en V1 : snapshot de graphe + interpolation par track)
  - OSC bidirectionnel, batching, systèmes XYZ et AED
  - Moteur Electron main-process non throttlé (60 FPS)
- **Erreurs à ne pas reproduire** :
  - Documenter/architecturer avant d'implémenter (39 docs, fichiers .ts vides)
  - Surcomplexité prématurée (timeline DAW, 8×8 cues en V1)
  - Restructurations en cascade sans livrable fonctionnel

### `nodes-trajectories` / OSCAI (`C:\Users\Administrateur\Documents\GitHub\nodes-trajectories`)
- **Stack** : Python FastAPI + React Flow + Three.js + NumPy
- **Apports retenus** :
  - Architecture graph compiler propre avec pipeline de validation en 7 étapes
  - Détection de cycles (DFS GRAY/BLACK), compatibilité statique des comptages
  - Nœuds Mix / Group / Sequence
  - Moteurs math (circular, spiral, lissajous, figure8, linear, oscillation, perlin_noise, formation, converge, pendulum)
  - Moteurs physique (bouncing, spring, follow, swarm/Boids, avoidance)
  - Macro controls temps réel : TSpeed, Scale, Shift
  - 5 profils OSC : IEM, Holophonix, IRCAM Spat, Generic
- **Erreur à ne pas reproduire** :
  - Génération de tableaux statiques de frames au lieu de fonctions continues f(t)
  - Pas de vrai runtime temps réel

### `trajectoires-modern` (https://github.com/dewiweb/trajectoires-modern)
- **Stack** : Node.js + React + WebSocket
- **Apports retenus** :
  - Dessin libre → trajectoire (→ nœud DrawSpline dans HOLOFLOW)
  - Streaming OSC immédiat
  - Déploiement minimaliste comme référence de simplicité
- **Limite** : 8 sources fixes, pas extensible

### `holophonix-blender-addon` (`C:\Users\Administrateur\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\holophonix_blender_addon`)
- **Stack** : Python + Blender
- **Apports retenus** :
  - Import natif de projets Holophonix (.zip → manifest.json → .hol)
  - Modèles 3D réels Amadeus (speakers/tracks)
  - Conversion XYZ ↔ AED
  - Handlers OSC par track (input/output/bidirectionnel)
  - Résolution automatique holophonix.local
- **Limite** : couplage total à Blender, inutilisable standalone

### `Holophonix-chataigne-module` (https://github.com/dewiweb/Holophonix-chataigne-module)
- **Stack** : JSON/Chataigne
- **Apports retenus** :
  - Interpolation par courbe par track individuelle lors des transitions de cue
  - Anti-loop OSC (désactivation OSC-in pendant recall)
  - Choix exclusif XYZ vs AED (pas les deux simultanément)
  - Gestion flexible des Track IDs (numéro, plage, liste)
- **Limite** : enfermé dans l'écosystème Chataigne

### `animation_nodes` (`C:\Users\Administrateur\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\animation_nodes`)
- **Stack** : Python + Cython + Blender
- **Apports retenus** :
  - **Compilation du graphe en code natif** (pas d'interprétation nœud par nœud à chaque frame) → principe fondateur du runtime HOLOFLOW
  - **Falloffs** : enveloppes d'influence spatiale/temporelle/audio applicables à tout paramètre
  - Splines comme trajectoires (SplineFromPoints, EvaluateSpline, avancement uniforme)
  - Loop nodes : itérateurs paramétriques dans le graphe
  - Script node : Python custom inline avec live reload
  - SoundFalloff / SoundSpectrum : audio → paramètre d'animation
  - DistributeMatrices : distribution d'objets sur chemin/surface
  - Modes d'exécution : DEFAULT / MONITOR / MEASURE / BAKE
- **Limite** : couplage total à Blender

### `NodeOSC` (`C:\Users\Administrateur\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\NodeOSC`)
- **Stack** : Python + Blender
- **Apports retenus** :
  - Mapping OSC → n'importe quel paramètre (modèle pour OSC IN dans HOLOFLOW)
  - Filtrage adresse + arguments
  - Protocoles multiples (oscpy + python-osc)

---

## Principes fondateurs de HOLOFLOW

### 1. f(t) au lieu de frames[]
Chaque moteur expose une fonction pure :
```typescript
position(t: number, objectIndex: number, params: EngineParams): Vector3
```
Pas de tableau précalculé. Le runtime appelle ça à chaque tick. Paramètres modifiables en temps réel sans recompilation de la trajectoire.

### 2. Le graphe compile une fois, tourne en continu
À chaque modification du graphe (connexion/déconnexion/changement de paramètre) : recompilation en une fonction composite. Entre deux compilations : le runtime tourne sans toucher au graphe.

### 3. Falloffs comme couche d'expression universelle
Un Falloff est une fonction `influence(t, position, context) → [0,1]` qui module n'importe quel paramètre de n'importe quel moteur. Remplace les subanimations statiques par un système générique.

### 4. DrawSpline comme nœud de première classe
Le dessin libre devient un nœud `DrawSpline` dont la sortie (spline) connecte à `EvaluateSpline` — compatible avec tout le reste du graphe. Pas un mode séparé.

### 5. Import .hol comme source de vérité
L'app lit les fichiers projet Holophonix (.hol) pour découvrir les tracks : IDs, noms, positions initiales, couleurs. Affiché directement dans le 3D preview.

### 6. Audio IN uniquement
- Entrée audio : détection BPM, amplitude par bande, spectre FFT
- Aucune sortie audio, aucun traitement audio
- Utilisable comme source dans le graphe (→ pilotage de Falloffs ou paramètres)

### 7. OSC uniquement (pas de MIDI)
- OSC out : envoi des positions calculées
- OSC in : réception de triggers de cues, overrides de paramètres, macro controls

---

## Catalogue de nœuds V1

### Structurels
`Objects` · `Duration` · `Output` · `Group` · `Mix` · `Sequence`

### Moteurs math
`circular` · `elliptical` · `spiral` · `lissajous` · `figure8` · `linear` · `oscillation` · `perlin_noise` · `formation` · `converge` · `pendulum` · `rose_curve` · `helix`

### Moteurs physique
`bouncing` · `spring` · `follow` · `swarm` · `avoidance`

### Splines
`DrawSpline` · `EvaluateSpline` · `TrimSpline` · `OffsetSpline`

### Falloffs
`TimeFalloff` · `PointDistanceFalloff` · `DirectionalFalloff` · `AudioAmplitudeFalloff`

### Modificateurs
`Scale` · `Rotate` · `Offset` · `PhaseShift` · `BarycentricGroup`

### Sources
`BPM` · `AudioAmplitude` · `AudioSpectrum` · `OSCInput`

---

## Stack technique

| Couche | Choix |
|--------|-------|
| Shell | Electron |
| UI | React 18 + TypeScript |
| Node editor | React Flow |
| 3D Preview | Three.js |
| State | Zustand |
| Styles | TailwindCSS |
| OSC | `osc` npm (UDP) |
| Audio IN | Web Audio API |
| Moteurs | TypeScript pur (pas de dépendance Python) |

---

## Périmètre V1 — hors scope explicite

- ❌ MIDI (définitivement abandonné)
- ❌ LLM / génération IA (définitivement abandonné)
- ❌ Timeline DAW → V2
- ❌ Grille cue 8×8 → V2 (cue list linéaire en V1)
- ❌ Packaging multi-plateforme → V2
- ❌ Intégration Blender (l'addon reste séparé, lit l'OSC out)

---

## Ordre de build — règle absolue : moteur d'abord, UI ensuite

```
S1  → Moteurs f(t) TypeScript pur + tests unitaires
S2  → Runtime Electron main-process (clock + OSC out)
S3  → Graph compiler (nœuds → fonction composite)
S4  → Node editor UI React Flow minimal
S5  → 3D Preview Three.js + import .hol
S6  → Falloffs (Time + PointDistance)
S7  → Audio IN (BPM + Amplitude)
S8  → OSC IN + Cue system minimal + polissage
```

**Rien n'est documenté tant que ça ne tourne pas.**
