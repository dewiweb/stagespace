# Comment l'utilisateur est censé interagir (théorie vs réalité)

## Ce que le backend permet (mais pas l'UI)

### Système de Patch
Le backend a un système complet pour gérer les objets et groupes :

1. **Créer des objets audio**
   ```http
   PUT /api/patch/objects/{osc_id}
   Body: { name, color, notes }
   ```
   - Exemple : objet 1 = "Lead Vocal", objet 2 = "Snare", etc.

2. **Créer des groupes d'objets**
   ```http
   PUT /api/patch/groups/{name}
   Body: { object_ids: [1, 2, 3], engine: "circular", params: {...}, profile: "holophonix" }
   ```
   - Exemple : groupe "Drums" = objets 1, 2, 3 avec moteur circular

3. **Lancer un playback pour un groupe**
   ```http
   POST /api/patch/groups/{name}/play
   ```
   - Le groupe utilise son moteur + paramètres configurés

### Ce que ça permet en théorie
- L'utilisateur définit ses objets audio (correspondance avec les tracks du récepteur OSC)
- L'utilisateur crée des groupes (ex: "Drums", "Vocals", "FX")
- L'utilisateur assigne un moteur à chaque groupe
- L'utilisateur lance le playback d'un groupe en 1 clic

---

## Ce que LiveSimple fait (réalité)

LiveSimple est **déconnecté** du système de patch :

1. **Sélectionne un moteur** (circular, spiral, etc.)
2. **Lance un playback** avec `n_objects: 1` (un seul objet générique)
3. **Ajuste les macros** (speed, turbulence, scale)

**Problèmes :**
- Pas de notion d'objets
- Pas de notion de groupes
- Pas de visualisation 3D des objets
- Pas de sélection d'objets
- Un seul objet (pas multi-objets)

---

## Ce que l'utilisateur devrait pouvoir faire (vision)

Pour une performance live, l'utilisateur devrait pouvoir :

1. **Voir ses objets** dans un visualiseur 3D
   - Les objets sont importés depuis le récepteur OSC (Holophonix, SPAT, etc.)
   - Chaque objet a une position initiale, une couleur, un nom

2. **Sélectionner un ou plusieurs objets**
   - Clic sur un objet dans le 3D
   - Shift+clic pour sélection multiple
   - Drag pour sélectionner une zone

3. **Appliquer une trajectoire** aux objets sélectionnés
   - Choisir un moteur (circular, spiral, etc.)
   - Ajuster les paramètres (speed, scale, etc.)
   - La trajectoire s'applique immédiatement

4. **Ajuster en temps réel**
   - Changer de moteur à chaud
   - Modifier les paramètres pendant le playback
   - Voir le résultat en 3D en temps réel

5. **Sauvegarder des presets**
   - Sauvegarder la configuration (objets + moteur + paramètres)
   - Rappeler un preset en 1 clic

---

## Ce qui manque dans l'UI actuelle

1. **Import de patch**
   - Pas d'import depuis le récepteur OSC
   - Pas de création manuelle d'objets
   - Pas de gestion de groupes

2. **Visualisation 3D**
   - LiveSimple n'a pas de visualiseur 3D
   - TrajectoryVisualizer existe mais n'est pas intégré à LiveSimple
   - Pas de sélection d'objets dans le 3D

3. **Sélection d'objets**
   - Pas d'interface pour sélectionner des objets
   - Pas de notion de multi-objets
   - Pas de groupes

4. **Intégration**
   - LiveSimple communique avec `/api/play` (session unique)
   - Ne communique pas avec `/api/patch` (objets + groupes)
   - Déconnecté du reste du système

---

## Proposition de refonte

Pour correspondre à ta vision (performance live), il faut :

1. **Intégrer TrajectoryVisualizer dans LiveSimple**
   - Afficher les objets en 3D
   - Permettre la sélection d'objets

2. **Ajouter un panneau de gestion de patch**
   - Import depuis le récepteur OSC
   - Création manuelle d'objets
   - Gestion de groupes

3. **Connecter LiveSimple au système de patch**
   - Utiliser `/api/patch/groups/{name}/play` au lieu de `/api/play`
   - Permettre de créer des groupes depuis la sélection d'objets
   - Sauvegarder les configurations comme presets

4. **Simplifier l'interface**
   - Supprimer NodeEditor (trop complexe pour le live)
   - Garder seulement LiveSimple avec 3D + patch
   - Réduire le header à l'essentiel

---

## Résumé

**Problème fondamental :**
- Le backend a un système de patch (objets + groupes)
- LiveSimple ne l'utilise pas
- L'utilisateur ne peut pas créer/sélectionner/gérer des objets

**Solution :**
- Intégrer le système de patch dans LiveSimple
- Ajouter un visualiseur 3D avec sélection d'objets
- Connecter tout pour permettre une vraie performance live
