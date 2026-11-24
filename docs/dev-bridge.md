# Dev Bridge / Remote UI — backend réel dans un navigateur

Le bridge expose **le backend Tauri complet** (commands IPC + events)
sur HTTP+SSE. Le frontend React le consomme via un shim
`__TAURI_INTERNALS__` : tout ce que l'UI fait en webview passe par le
même dispatch IPC, le vrai `AppState`, le vrai `MergeRuntime` — OSC,
superviseur, plugins WASM compris.

Deux modes, **même code** (`src/bridge_server.rs`) :

- **In-app (remote UI)** — le bridge tourne *dans* l'application Tauri,
  en parallèle de la webview desktop. Activable à chaud depuis
  **Settings → Réseau → Remote UI** (persisté, ré-appliqué au boot) ou
  via `STAGESPACE_BRIDGE_BIND` au lancement. UI desktop + navigateurs
  distants pilotent **le même show vivant** — les events (`listen_any`)
  sont broadcast aux deux.
- **Headless (tests)** — `tests/dev_bridge.rs` construit une mock app
  (`MockRuntime`) et sert la même boucle : E2E réel depuis Puppeteer
  sans webview.

```
navigateur ──POST /invoke──▶ bridge_server ──webview.on_message──▶ dispatch IPC réel
navigateur ◀──SSE /events─── bridge_server ◀──listen_any────────── event_sink backend
```

`on_message` est le point d'entrée IPC réel des webviews Tauri
(`get_ipc_response` n'en est qu'un wrapper MockRuntime) : le remote
passe exactement par le chemin de la webview desktop — même
sérialisation, même `invoke_key`, même resolver.

## Lancer

### In-app (UI desktop + remote simultanés)

**Via Settings** — `Settings → Réseau → Remote UI` : toggle Enable +
bind `host:port` (`127.0.0.1` = cette machine seule, `0.0.0.0` = toutes
interfaces/LAN). Le réglage est persisté et **ré-appliqué au boot** —
l'opérateur distant ne reconfigure rien à chaque lancement. Start/stop
à chaud via `set_remote_ui` / `remote_ui_status` (IPC) : arrêt propre
des listeners SSE et des abonnements d'events (`unlisten`), sans
toucher la webview ni le moteur.

**Via env var** (startup override, ops/deploy) :

```bash
STAGESPACE_BRIDGE_BIND=0.0.0.0:4173 ./stagespace-tauri   # ou npm run tauri dev
# log : [BRIDGE] remote UI started on 0.0.0.0:4173 — no auth, trusted network only
```

Sans activation : le bridge ne démarre pas, coût nul. Un échec de bind
est remonté à l'UI (Settings) ou loggé (env) — jamais fatal pour l'app.

### Headless (tests E2E)

```bash
cd tauri-app/src-tauri
cargo test --test dev_bridge -- --ignored --nocapture
```

C'est un `#[test]` ignoré qui vit indéfiniment (le tuer avec Ctrl+C).
Un second lancement échoue sur `AddrInUse` : normal — vérifier
l'instance existante avec `curl -s -X POST …/invoke`. Bind par défaut
`127.0.0.1:4173`, même env var.

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

### Pilotage depuis la console — `window.__live`

En DEV, `main.tsx` installe `src/dev/e2eHooks.ts` qui expose les
**vraies instances** des stores Zustand sur `window.__live`
(`score`, `cues`, `graph`, `session`, `moveEditor`, `globalGraph`,
`signalGraph`, `showStatus`, `toasts`) :

```js
window.__live.score.getState().playScore()
window.__live.cues.getState().cues
```

⚠️ **Ne pas importer les stores depuis une eval/console** : en dev
Vite, chaque URL d'import produit un module distinct —
`/src/store/useScoreStore`, `/src/store/useScoreStore.ts` et l'URL
resolue `?t=` post-HMR créent trois stores Zustand **fantômes** que
l'app ne voit pas (écritures invisibles, lectures obsolètes). Les
stores doivent passer par le graphe de modules de l'app —
`e2eHooks.ts` en fait partie. Idem pour les utilitaires
(`scoreResolve`, `scoreSnapshot`…) : les appeler via les actions du
store ou l'UI, pas via un import eval.

Le hook est idempotent — un HMR réinstalle vers les nouvelles
instances. Dead-code éliminé en build production
(`import.meta.env.DEV` + import dynamique).

## UI distante (remote)

Le bridge répond `Access-Control-Allow-Origin: *` et le SSE broadcast
supporte **plusieurs clients simultanés** — plusieurs opérateurs sur
plusieurs postes pilotent le même backend en parallèle (ex. un sur Jeu,
un sur Conduite, + l'écran desktop local).

### Sur le LAN

Machine hôte (moteur + OSC OUT) :

```bash
STAGESPACE_BRIDGE_BIND=0.0.0.0:4173 npm run tauri dev &
# ou headless : STAGESPACE_BRIDGE_BIND=0.0.0.0:4173 cargo test --test dev_bridge -- --ignored

cd tauri-app/frontend
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
bind `127.0.0.1` suffit :

```bash
ssh -L 4173:127.0.0.1:4173 -L 5175:127.0.0.1:5175 user@hôte
# puis http://localhost:5175/?bridge=http://localhost:4173
```

## Limites

| Fonction | Headless (mock) | In-app (real) |
|---|---|---|
| Commands IPC, events, OSC IN/OUT, moves, cues, gestes | ✅ réel, identique webview | ✅ idem |
| Contenu du show (slots, cues, setlist, graphes) | ✅ sync live : `set_show_snapshot` pousse l'enveloppe + broadcast `show-state-changed` ; chaque client applique (voir § Sync) | idem |
| Pickers de fichiers (Save/Load, Import .hol) | ❌ pas de fenêtre dans la mock app | ⚠️ le dialog s'ouvre **sur l'écran de l'hôte** |
| `getVersion()` etc. (plugin app) | ⚠️ dégrade (`vdev`) | ✅ réel |
| Audio IN | capté côté hôte | idem (normal) |
| Fenêtres détachées `?view=…` | ✅ — un navigateur distant est une detached window de plus | idem |
| Sécurité | aucune auth — LAN de confiance ou tunnel SSH | idem |
| `set_remote_ui` (toggle) | refuse proprement — pas de webview Wry | ✅ start/stop à chaud |

## Sync du show entre clients

Le backend est le relais d'autorité de l'état *authoring* (slots, cues,
setlist, graphes — tout ce qui n'est pas runtime) :

1. Un client appelle `set_show_snapshot { clientId, envelope }` — le
   backend stocke l'enveloppe (`AppState.show_snapshot`) et émet
   `show-state-changed { clientId }` (webview + SSE).
2. Les **autres** clients reçoivent l'event → `get_show_snapshot` →
   appliquent l'enveloppe à leur store local.
3. Un client ignore l'event portant son propre `clientId` (anti-écho) ;
   un marqueur d'enveloppe comparable évite de ré-appliquer/pousser en
   boucle.

Sémantique : **last-writer-wins convergente** — si deux clients éditent
en même temps, la dernière enveloppe arrivée gagne (console model : le
fichier fait foi). Un remote ne peut pas écraser un show pendant le jeu
(même garde que le load normal).

Les pushs sortants passent par `utils/showSync.ts` (debounce) ; le pull
initial hydrate un navigateur frais au premier accès.

Évolution naturelle si le remote devient un usage show : token d'accès
(le serveur statique de `dist/` par le bridge — URL unique — serait le
suivant).

## Fichiers

- `tauri-app/src-tauri/src/bridge_server.rs` — listener HTTP, dispatch
  via `webview.on_message` (sérialisé sur un thread dédié), broadcast
  SSE, `RemoteUi` (start/stop, `unlisten` propre), `spawn_if_enabled`
  (env `STAGESPACE_BRIDGE_BIND`).
- `tauri-app/src-tauri/src/commands/remote_ui.rs` — `set_remote_ui` /
  `remote_ui_status` (validation du bind, erreurs typées).
- `tauri-app/src-tauri/tests/dev_bridge.rs` — même `serve` sur mock app.
- `tauri-app/src-tauri/src/lib.rs` — `spawn_if_enabled` appelé dans
  `.setup` après `setup_backend_runtime`.
- `tauri-app/frontend/public/tauri-bridge.js` — shim
  `__TAURI_INTERNALS__` activé par localStorage/`?bridge=`.
- `tauri-app/frontend/src/utils/showSync.ts` — orchestrateur de sync
  (subscribe `show-state-changed`, pull initial, push debouncé,
  anti-écho). Monté dans `App.tsx`.
- `tauri-app/frontend/src/utils/showSyncState.ts` — `SYNC_CLIENT_ID` +
  marqueurs d'enveloppe poussée/appliquée.
- `tauri-app/src-tauri/src/commands/file_io.rs` — `set/get_show_snapshot`
  (relais + broadcast `show-state-changed`).
- Events forwardés : liste `EVENTS` dans `bridge_server.rs` (ajouter
  ici tout nouvel event écouté par le frontend). `show-state-changed`
  y figure.
