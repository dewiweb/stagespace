# Dev Bridge — backend réel dans un navigateur

Le dev bridge expose **le backend Tauri complet** (commands IPC + events)
sur HTTP+SSE, sans webview. Le frontend React le consomme via un shim
`__TAURI_INTERNALS__` : tout ce que l'UI fait en webview passe par le
même dispatch IPC, le vrai `AppState`, le vrai `MergeRuntime` — OSC,
superviseur, plugins WASM compris.

Usages : tests E2E réels (Puppeteer), debug frontend contre un backend
vivant, et **UI distante** — piloter STAGESPACE depuis un autre poste
du réseau via navigateur.

```
navigateur ──POST /invoke──▶ dev_bridge ──get_ipc_response──▶ vrai dispatch Tauri
navigateur ◀──SSE /events─── dev_bridge ◀──listen_any───────── event_sink backend
```

## Lancer

```bash
cd tauri-app/src-tauri
cargo test --test dev_bridge -- --ignored --nocapture
# [DEV-BRIDGE] backend headless prêt — 127.0.0.1:4173/invoke + /events
```

C'est un `#[test]` ignoré qui vit indéfiniment (jamais de `Ok` — le
tuer avec Ctrl+C). Un second lancement échoue sur `AddrInUse` : c'est
normal, l'instance existante est saine — vérifier avec
`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4173/events`
→ `200`.

Bind par défaut `127.0.0.1:4173`, surchargeable :

```bash
STAGESPACE_BRIDGE_BIND=0.0.0.0:4173 cargo test --test dev_bridge -- --ignored
```

## Côté frontend

Le shim `frontend/public/tauri-bridge.js` (chargé par `index.html` en
dev **et** en build de production) s'active dès que
`localStorage.stagespace_ipc_bridge` contient l'URL du pont. Deux façons
de l'armer :

- **Paramètre d'URL** (recommandé) :
  `http://<host>:5175/?bridge=http://<host>:4173` — persisté en
  localStorage puis retiré de l'URL. `?bridge=off` désactive.
- **Devtools** :
  `localStorage.stagespace_ipc_bridge = "http://<host>:4173"` puis reload.

Le shim route `invoke()` → `POST {bridge}/invoke`, `listen()` →
`EventSource {bridge}/events`, et les emits frontend restent locaux
(registry in-page, comme Tauri).

## UI distante (remote)

Le bridge répond `Access-Control-Allow-Origin: *` et le SSE broadcast
supporte **plusieurs clients simultanés** — plusieurs opérateurs sur
plusieurs postes peuvent piloter le même backend en parallèle (ex. un
sur Jeu, un sur Conduite).

### Sur le LAN

Machine hôte (celle qui fait tourner le moteur + l'OSC OUT) :

```bash
cd tauri-app/src-tauri
STAGESPACE_BRIDGE_BIND=0.0.0.0:4173 cargo test --test dev_bridge -- --ignored &

cd ../frontend
npm run dev -- --host          # vite sur 0.0.0.0:5175
# ou build statique : npm run build, servir dist/ par n'importe quel serveur
```

Poste distant (navigateur) :

```
http://<ip-hôte>:5175/?bridge=http://<ip-hôte>:4173
```

Une fois le `?bridge=` absorbé, l'URL propre peut être bookmarkée — le
lien survit aux reloads (localStorage).

### Hors LAN de confiance : tunnel SSH

Aucune auth ni chiffrement sur le bridge — ne jamais exposer `4173` en
`0.0.0.0` hors d'un réseau maîtrisé. Le tunnel est la voie sûre, et le
bind par défaut `127.0.0.1` suffit :

```bash
ssh -L 4173:127.0.0.1:4173 -L 5175:127.0.0.1:5175 user@hôte
# puis http://localhost:5175/?bridge=http://localhost:4173
```

## Limites

| Fonction | Statut via bridge |
|---|---|
| Commands IPC, events, OSC IN/OUT, moves, cues, gestes | ✅ réel, identique webview |
| Pickers de fichiers natifs (Save/Load Show, Import .hol) | ❌ le plugin dialog n'a pas de fenêtre dans la mock app — utiliser `/stagespace/show/load <path>` (OSC) ou un fichier côté disque de l'hôte |
| `getVersion()` etc. (plugin app) | ⚠️ dégrade proprement (`vdev`) |
| Audio IN | capté côté **hôte** (normal — le moteur est sur l'hôte) |
| Fenêtres détachées `?view=…` | ✅ — un navigateur distant est une detached window de plus |
| Sécurité | aucune auth — LAN de confiance ou tunnel SSH uniquement |

## Fichiers

- `tauri-app/src-tauri/tests/dev_bridge.rs` — listener HTTP, dispatch
  IPC sérialisé (`get_ipc_response` + mock webview), broadcast SSE.
- `tauri-app/frontend/public/tauri-bridge.js` — shim
  `__TAURI_INTERNALS__` activé par localStorage/`?bridge=`.
- Events forwardés : liste `EVENTS` dans `dev_bridge.rs` (ajouter ici
  tout nouvel event écouté par le frontend).
