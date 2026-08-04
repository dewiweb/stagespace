# Refonte LiveSimple — Performance Live

## Changements effectués

### 1. Intégration TrajectoryVisualizer
- Ajouté `TrajectoryVisualizer` dans LiveSimple
- Affichage 3D des objets en haut à gauche
- Permet de visualiser les trajectoires en temps réel

### 2. Système de patch intégré
- Bouton "Patch" dans le header (panneau collapsible)
- Chargement du patch depuis `/api/patch` au montage
- Affichage des groupes (nom, nombre d'objets, moteur)
- Affichage des objets (nom, ID)
- `handlePlayGroup` pour lancer un groupe en 1 clic

### 3. UI pour créer des objets
- Modal "Create Object" avec nom + couleur
- Bouton "+ New" dans la section Objects
- `handleCreateObject` pour créer un objet via API
- Génération automatique de l'OSC ID

### 4. UI pour créer des groupes
- Modal "Create Group" avec nom + moteur
- Bouton "+ New" dans la section Groups
- Sélection d'objets par clic (toggle)
- `handleCreateGroup` pour créer un groupe depuis la sélection
- Validation (nom requis, objets requis)

### 5. Layout réorganisé
- **Gauche** : TrajectoryVisualizer + grille de moteurs
- **Droite** : Sliders macro + panneau Patch
- Plus adapté à la performance live

### 6. App.tsx simplifié
- Suppression de NodeEditor
- Suppression de tous les panels latéraux
- Suppression du mode switcher (Editor/Live)
- Architecture unifiée pour performance live

---

## Workflow utilisateur

### 1. Créer des objets
1. Cliquer sur "Patch" dans le header
2. Cliquer sur "+ New" dans la section Objects
3. Entrer un nom (ex: "Lead Vocal")
4. Choisir une couleur
5. Cliquer sur "Create"

### 2. Sélectionner des objets
- Cliquer sur un objet pour le sélectionner/désélectionner
- Les objets sélectionnés ont une bordure bleue

### 3. Créer un groupe
1. Sélectionner les objets (clic sur chaque objet)
2. Cliquer sur "+ New" dans la section Groups
3. Entrer un nom (ex: "Drums")
4. Choisir un moteur (ex: "Circular")
5. Cliquer sur "Create"

### 4. Lancer le playback
1. Cliquer sur un groupe dans la section Groups
2. Le playback démarre automatiquement
3. Ajuster les macros en temps réel (Speed, Turbulence, Scale)
4. Cliquer sur "STOP" pour arrêter

---

## Architecture cible

```
LiveSimple → Backend API → Rust Core → OSC UDP
     ↓
TrajectoryVisualizer (Three.js)
     ↓
Patch Panel (objets + groupes)
```

**Simplification :**
- Un seul runtime (Rust Core)
- Une seule interface (LiveSimple)
- Un seul flux de données
