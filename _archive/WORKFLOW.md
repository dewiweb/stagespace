# Workflow Performance Live — HOLOFLOW

## Démarrage

### 1. Démarrer le backend Python
```bash
cd backend
./start.sh
```

Le backend démarrera sur `http://127.0.0.1:8080`

### 2. Démarrer le Rust core (optionnel)
```bash
cd rust-core
cargo run
```

Le Rust core démarrera et se connectera via IPC Unix socket.

### 3. Démarrer le frontend
```bash
cd frontend
npm run dev
```

Le frontend démarrera sur `http://localhost:3000`

---

## Workflow utilisateur

### 1. Créer des objets
1. Ouvrir LiveSimple (http://localhost:3000)
2. Cliquer sur "Patch" dans le header
3. Cliquer sur "+ New" dans la section Objects
4. Entrer un nom (ex: "Lead Vocal")
5. Choisir une couleur
6. Cliquer sur "Create"

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

## Architecture

```
LiveSimple → Backend API → Rust Core → OSC UDP
     ↓
TrajectoryVisualizer (Three.js)
     ↓
Patch Panel (objets + groupes)
```

**Flux de données :**
- Frontend communique avec Backend API via REST
- Backend communique avec Rust Core via IPC Unix socket
- Rust Core envoie OSC au récepteur

---

## Configuration OSC

### Par défaut
- Host : 127.0.0.1
- Port : 7788
- Profil : Holophonix

### Changer le profil
Dans LiveSimple, le profil peut être changé via l’API (non implémenté dans l’UI pour l’instant).

---

## Problèmes connus

### Backend ne démarre pas
- Vérifier que le venv est correctement configuré
- Vérifier que les dépendances sont installées
- Vérifier que le port 8080 n’est pas déjà utilisé

### Frontend ne communique pas avec le backend
- Vérifier que le backend tourne sur `http://127.0.0.1:8080`
- Vérifier que CORS est activé dans le backend

### Rust core ne démarre pas
- Vérifier que Rust est installé
- Vérifier que le port IPC `/tmp/holoflow.sock` n’est pas déjà utilisé
