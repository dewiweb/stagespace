# UI Actuelle — Explication claire

## Structure de l’interface

L’application a **2 modes principaux** accessibles via le header :

### 1. Mode Live (par défaut)
- Affiche **LiveSimple** — interface minimaliste pour performance live
- Grille de moteurs (Circle, Spiral, Lissajous, etc.)
- Sliders macro (Speed, Turbulence, Scale)
- Bouton Play/Stop
- Presets rapides

### 2. Mode Editor
- Affiche **NodeEditor** — éditeur de graphes de nœuds
- **TrajectoryVisualizer** — visualisation 3D des trajectoires
- **Panels latéraux** (activables via boutons dans le header) :
  - MacroControls (contrôles macro)
  - OscPanel (configuration OSC)
  - AudioPanel (audio IN)
  - CuePanel (cue list)
  - HolImport (import .hol)

---

## Header (Blender-style)

Le header contient les éléments suivants (de gauche à droite) :

1. **Logo** — OSCAI
2. **Onglets de mode** — Node Editor | Live
3. **Viewport slider** — ajuste la hauteur de la visualisation 3D (mode Editor)
4. **Playback** — Stop | Play/Pause
5. **Macro Controls** — bouton Settings
6. **OSC Settings** — bouton Radio avec indicateur de connexion
7. **Import .hol** — bouton FileInput
8. **Save graph** — bouton Save
9. **Load graph** — bouton FolderOpen
10. **Cue List** — bouton ◈ avec compteur
11. **Audio IN** — bouton Mic avec indicateur de statut
12. **Compile status** — pill en bas à droite (compiling, ok, error)

---

## Composants existants

### LiveSimple
- Grille de 12 moteurs
- Sliders macro
- Bouton Play/Stop
- Status bar

### NodeEditor
- Palette de nœuds (gauche)
- Canvas React Flow (centre)
- MiniMap (bas droite)
- Controls (zoom, fit)
- Panel de compilation (bas centre)

### TrajectoryVisualizer
- Visualisation 3D Three.js
- Affichage des trajectoires
- Caméra orbitale

### Panels latéraux
- **MacroControls** — sliders pour modifier les paramètres en temps réel
- **OscPanel** — configuration OSC (host, port, profile)
- **AudioPanel** — configuration audio IN (BPM, amplitude)
- **CuePanel** — cue list pour transitions
- **HolImport** — import de projets Holophonix

---

## Workflow typique

### Mode Live (performance)
1. Sélectionner un moteur dans la grille
2. Cliquer sur Play
3. Ajuster les sliders macro en temps réel
4. Cliquer sur Stop

### Mode Editor (création)
1. Choisir "Node Editor" dans le header
2. Ajouter des nœuds depuis la palette
3. Connecter les nœuds
4. Compiler le graphe
5. Visualiser le résultat dans TrajectoryVisualizer
6. Sauvegarder le graphe

---

## Problèmes actuels

1. **Complexité** — Trop de boutons dans le header (12+ boutons)
2. **Confusion** — Pas clair ce que chaque bouton fait
3. **Manque d’onboarding** — Pas de guide pour les nouveaux utilisateurs
4. **Labels en anglais** — Pas cohérent avec le reste du projet
5. **Pas de tooltips** — Difficile de comprendre la fonction de chaque bouton

---

## Proposition de simplification

### Option 1 : Réduire le header
- Garder seulement les boutons essentiels (Play/Stop, Settings, Save/Load)
- Déplacer les autres dans un menu déroulant
- Ajouter des tooltips explicatifs

### Option 2 : Créer un guide d’utilisation
- Ajouter un bouton "Help" dans le header
- Afficher un panel d’aide au premier chargement
- Expliquer chaque section de l’interface

### Option 3 : Simplifier l’interface
- Fusionner Mode Live et Mode Editor
- Créer une interface unifiée plus simple
- Réduire le nombre de panels

---

## État actuel du code

- **App.tsx** — contient la logique de navigation entre les modes
- **LiveSimple.tsx** — interface live minimaliste
- **NodeEditor.tsx** — éditeur de graphes
- **TrajectoryVisualizer.tsx** — visualisation 3D
- **Panels** — MacroControls, OscPanel, AudioPanel, CuePanel, HolImport

---

## Prochaine étape

Tu veux que je :
1. Crée un guide d’utilisation pour expliquer l’UI ?
2. Simplifie le header en réduisant le nombre de boutons ?
3. Crée une interface unifiée plus simple ?
4. Documente chaque composant en détail ?
