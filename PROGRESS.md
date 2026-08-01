# StageSPACE — État réel du projet

**Règle** : ce fichier reflète l'état RÉEL du code testé, pas les intentions.
Mis à jour à chaque session de travail.

---

## Dernière mise à jour : 2026-08-01 — Session Rust core v0.1

## État actuel

### ✅ Nouveau — Rust core HOLOFLOW

| Composant | Chemin | Test |
|-----------|--------|------|
| Rust IPC server | `rust-core/src/ipc.rs` | ✅ Socket Unix `/tmp/holoflow.sock`, JSON newline-delimited |
| OSC sender / receiver | `rust-core/src/osc.rs` | ✅ Envoi UDP `/track/1/xyz` reçu, decode validé |
| Playback engine | `rust-core/src/engine.rs` | ✅ `play_loop` 60fps, `circular` + `spiral` |
| LFO modulator | `rust-core/src/modulator.rs` | ✅ 5 waveforms, slots multiples |
| Python async client | `backend/rust_core_client.py` | ✅ `start_playback_async`/`stop_playback_async` |
| API intégration | `backend/api.py` | ✅ `POST /api/play` avec `use_rust=true` retourne session Rust |
| End-to-end | `tests/` + `curl` | ✅ `/api/play` → Rust core → OSC UDP:7788 validé |

### Moteurs f(t) supportés par le Rust core (Phase 2)
- `circular` ✅ (testé vs `math_engine.circular`)
- `spiral`
- `lissajous` ✅ (testé via `/api/play`)
- `figure8`
- `linear`

### Profils OSC supportés par le Rust core
- `holophonix` → `/track/{}/xyz`
- `adm_osc` → `/adm/obj/{}/cartpos`
- `generic_cartesian` → `/object/{}/xyz`
- `iem` → `/MultiEncoder/{}/aed`

### Comparaison Phase 2
- `circular` Python `math_engine` vs Rust `f(t)` : ✅ diff < 0.01 à t=1.5s
- Architecture `EngineParams` extensible avec `custom` HashMap
- Paramètre `duration` normalisé identique au moteur Python

### Phase 3 — Graph compiler ✅ démarrée
- Fichier : `rust-core/src/graph.rs`
- Types : `Node`, `Edge`, `Graph`, `CompiledGraph`, `Value`
- Validation : détection de cycles, références inconnues
- Compilation : tri topologique + évaluation f(t)
- Modifiers : `scale`, `offset`, `mix`
- Tests unitaires : graphe simple + détection cycle ✅

### Prochaines étapes
1. Phase 3.3 : ajouter les 10 moteurs restants en Rust f(t)
2. Intégrer le graph compiler au `PlaybackEngine` (runtime graphe au lieu de moteur unique)
3. Tests jitter/CPU Rust vs Python
4. Intégrer LFO + turbulence au `PlaybackEngine`

### ✅ Fonctionnel et testé

| Composant | Chemin | Test |
|-----------|--------|------|
| 15 moteurs trajectoires | `backend/math_engine.py` + `backend/physics_engine.py` | Testé en Python direct, résultats valides |
| API REST FastAPI | `backend/api.py` | Testé : GET `/`, POST `/api/generate-direct`, GET `/api/engines` |
| Orchestrateur graph | `backend/orchestrator.py` | Import OK, pas encore testé via API |
| OSC profiles (6) | `backend/osc_sender.py` | ✅ Envoi OSC réel testé — 10 paquets reçus UDP:7000. **ADM-OSC ajouté** `/adm/obj/[n]/cartpos` |
| Loop infini + macros | `backend/osc_sender.py` | ✅ `play_loop()` testé — loop, speed×2 à chaud, scale/shift thread-safe, stop() propre |
| Bridge OSC WebSocket | `osc-bridge/index.ts` | ✅ End-to-end validé — WS:8765 → UDP:9000 |
| OSC IN → macros | `backend/osc_receiver.py` | ✅ UDP:8001 — speed/scale/shift/stop depuis IHM physique |
| Swap moteur à chaud | `backend/osc_sender.py` + `api.py` | ✅ POST `/api/swap/{id}` — cut + crossfade N frames |
| n_objects à chaud | `backend/api.py` | ✅ POST `/api/resize/{id}` — 2→4→1 testé |
| Params moteur à chaud | `backend/api.py` | ✅ PATCH `/api/params/{id}` — radius 0.7→0.3 testé |
| OSC IN mapping configurable | `backend/osc_receiver.py` + `api.py` | ✅ POST `/api/osc-in/mapping` — SpaceMouse émulé `/track/1/x=0.5` → speed=2.0 |
| Presets + persistance | `backend/presets.py` + `api.py` | ✅ Snapshot/recall/list/delete + `presets.json` persisté sur disque |
| LFO modulateur interne | `backend/modulator.py` + `api.py` | ✅ POST `/api/lfo/{id}` — sine/triangle/square/saw/random, multi-slots, add/remove à chaud |
| Sync BPM / tap tempo | `backend/bpm.py` + `api.py` | ✅ tap tempo ±0.5BPM, sync speed sur N beats, MIDI clock 24PPQN via OSC IN |
| Réaction au son | `backend/audio_reactor.py` + `api.py` | ✅ `/audio/rms+bass+mid+high` → macros, min/max/smooth configurables |
| Turbulence | `backend/osc_sender.py` | ✅ PATCH `turbulence` 0..1 — bruit cohérent ×3.7 variance validé |
| Cuelist | `backend/cuelist.py` + `api.py` | ✅ GO/BACK/GOTO/reset + CRUD cues + macros par cue — end-to-end testé |

### 🟡 Présent mais non testé

| Composant | Chemin | Manque |
|-----------|--------|--------|
| Frontend React/TS | `frontend/src/` | npm install OK, rendu blanc en browser preview (WebGL), non testé en vrai navigateur |
| Node Editor | `frontend/src/components/NodeEditor.tsx` | Dépend du backend, non testé end-to-end |
| Runtime loop | `frontend/src/engine/runtime/Runtime.ts` | Logique présente, playback réel non vérifié |
| Macro controls | `frontend/src/components/MacroControls.tsx` | UI présente, liaison backend non testée |
| Cue system | `frontend/src/engine/osc/CueSystem.ts` | Code présent, non testé |
| Audio analyser | `frontend/src/engine/audio/AudioAnalyser.ts` | Code présent, non testé |

### ❌ Absent / à implémenter

| Composant | Priorité V1 | Notes |
|-----------|-------------|-------|
| OSC bridge serveur (ws://8765) | **V1** | ✅ Opérationnel, end-to-end testé |
| Loop infini runtime backend | **V1** | ✅ `play_loop()` implémenté et testé |
| Profil ADM-OSC | **V1** | ✅ `AdmOscProfile` implémenté et testé |
| Contrôle paramètres à chaud | **V1** | ✅ PATCH `/api/macros/{id}` — speed×2 testé en live |
| Multi-target OSC | V2 | Envoyer simultanément à plusieurs processeurs |
| Performance surface UI | V2 | UI live dédiée (pas node editor) |

---

## Prochaine étape concrète (V1)

**Étape 1 ✅** — OSC réel validé (UDP:7000, generic_cartesian)
**Étape 2 ✅** — Loop infini + macros speed/scale/shift à chaud
**Étape 3 ✅** — Bridge WS:8765 → UDP end-to-end
**Étape 4 ✅** — Profil ADM-OSC `/adm/obj/[n]/cartpos`

**Étape 5 ✅** — POST `/api/play` — engine+params+profile+host+port → session_id
**Étape 6 ✅** — POST `/api/stop/{id}`, PATCH `/api/macros/{id}`, GET `/api/sessions`

**Étape 7 — Tester depuis le frontend**
Vérifier que l'OscPanel + MacroControls du frontend pilotent bien le backend via ces endpoints.

**Étape 8 ✅** — Mapping OSC IN configurable à chaud via `POST /api/osc-in/mapping`
- SpaceMouse émulé : `/track/1/x=0.5` → speed=2.0 via transform `1.0 + v*2.0`
- Pour le vrai spacemouse-osc : prefix=`/track`, output UDP:8001, mappings via API
- Supports transforms Python arbitraires : `abs(v)`, `v*0.5+0.5`, etc.

**Étape 9 ✅** — Presets + persistance
- Snapshot session live → preset nommé avec macros
- Recall preset → session immédiatement active, macros restaurées
- `presets.json` persisté, rechargé au démarrage

**Étape 10 ✅** — Patch + object_offset + groupes nommés
- `PatchManager` : objets OSC nommés (`kick`, `vocals`…) + groupes persistés dans `patch.json`
- `object_offset` dans `OSCSender` + `POST /api/play` : groupe fx (obj 5-6) → offset=4 → OSC sur `/object/5` et `/object/6`
- `POST /api/patch/groups/{name}/play` : lancer un groupe en un appel, offset calculé automatiquement
- Test end-to-end : 60 frames reçues, `/object/5` et `/object/6` présents, `/object/1` absent ✓

**Étape 11 ✅** — LivePanel SHOW/PREP (frontend connecté au core)
- Mode **SHOW** : cartes groupes colorées ▶ PLAY/■ STOP, macros du groupe sélectionné, TAP BPM géant, presets rappelables
- Mode **PREP** : sessions actives, play manuel, macros, LFO, presets, patch en lecture
- Tout parle directement à `localhost:8080` — zéro store local
- Règle 1 respectée : core OSC validé avant UI

**Étape 12 ✅** — Cuelist (GO/BACK/GOTO/reset)
- `CuelistManager` : liste ordonnée de cues, persistée dans `cuelist.json`
- Cue = groupes à lancer + macros par cue + fade_frames + stop_others
- `_execute_cue` : smart swap si groupe déjà actif, sinon nouveau play
- Endpoints : `GET /api/cuelist`, `POST /api/cuelist/go|back|reset`, `POST /api/cuelist/goto/{id}`, CRUD `/api/cuelist/cues`

**Prochaines décisions core** :
- Multi-target OSC (un groupe → 2 processeurs simultanés)
- Persistance complète par groupe (anchor + macros dans patch.json)
- UI cuelist dans le frontend (PREP : éditeur + SHOW : bouton GO géant)

---

## Architecture cible (validée)

### Rust core + Python API

```
Frontend (React/TS)
      │ HTTP/WS
Python API (FastAPI)          ← logique métier, sessions, presets, config
      │ IPC (Unix socket)
Rust OSC Engine (tokio+rosc)  ← play_loop μs-précis, LFO, turbulence, OSC IN/OUT
      │ UDP
  Holophonix / d&b DS100 / IEM / ...
```

**Règle de découpe :**
- Python : tout ce qui est configuration, persistance, API REST, logique métier
- Rust : tout ce qui touche au timing, aux frames OSC, à la précision temps réel

**Stratégie de migration :**
- Python actuel = spec de référence + prototype de validation
- Rust remplace `osc_sender.py` + `modulator.py` + `osc_receiver.py` feature par feature
- Interface IPC : JSON simple sur Unix socket — transparente pour le frontend
- Migration incrémentale, pas de big-bang rewrite

**Pourquoi :**
- GIL Python incompatible avec timing OSC précis à 60fps+ sous charge
- Bug deadlock threading.Lock/asyncio déjà rencontré en dev (session 5)
- Rust tokio : jitter < 100μs garanti, multi-target UDP sans overhead
- Rust extensible : nouveaux moteurs, profils OSC, types de bruit = sans toucher l'API

---

## Ports utilisés

| Service | Port | Protocole |
|---------|------|-----------|
| Backend API | 8080 | HTTP/WS |
| Frontend dev | 3000 | HTTP |
| OSC bridge | 8765 | WebSocket |
| OSC out (Holophonix) | 8000 | UDP |
| OSC out (IEM) | 9000 | UDP |
| OSC out (generic) | 7000 | UDP |
