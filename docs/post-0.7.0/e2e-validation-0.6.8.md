# Validation e2e des fixes UX 0.6.8 — handoff pour session Devin Local

> Écrit le 2026-11-27. Contexte : la release v0.6.8 est taguée/poussée (CI release en
> cours). Les 13 chantiers UX sont validés par tsc+vitest mais PAS encore par captures
> e2e. Ce doc permet à une session fraîche (browser pilotable) de faire la validation
> visuelle sans rechercher quoi que ce soit.

## 1. Infrastructure de test

```bash
# Bridge (backend headless HTTP/SSE sur :4173)
cd tauri-app/src-tauri
# ⚠ NE PAS recompiler : le nouveau binaire crash sur Windows
# (STATUS_ENTRYPOINT_NOT_FOUND 0xc0000139). Utiliser l'ancien binaire :
./target/debug/deps/dev_bridge-0555e6d1cd90251c.exe --ignored --nocapture
# (backend inchangé depuis — le bump 0.6.8 est pur frontend)

# Vite (frontend dev sur :5174)
cd tauri-app/frontend
node node_modules/vite/bin/vite.js --port 5174 --strictPort
# ⚠ Windows : le shim npm est cassé, invoquer node directement :
# "C:\Program Files
odejs
ode.exe"

# URL de test :
http://localhost:5174/?bridge=http://127.0.0.1:4173
```

Vérification : `curl localhost:4173/` → 200, `curl localhost:5174/` → 200.

## 2. Seeding — window.__live (clé de tout)

`src/dev/e2eHooks.ts` expose les VRAIES instances des stores sur `window.__live`
(dev only) : `score, cues, graph, session, moveEditor, globalGraph, signalGraph,
showStatus, toasts`. Usage dans le browser piloté via `eval` :

```js
// Objets visibles au radar SANS move (positions manuelles — namespace obj_index) :
window.__live.graph.getState().setManualPosition(0, [1.5, -1, 0])

// Injection directe de cue (shape Cue dans types/generated/Cue.ts) :
// setState Zustand direct — contourne storeCue dont le payload est lourd
window.__live.cues.setState({
  cues: [{
    id: 'e2e-1', name: 'E2E-CUE', description: '', cue_number: '1',
    graph: { nodes: [], edges: [] }, timestamp: Date.now(),
    macros: null, track_indices: [0], fade_duration: 2,
    global_graph: null, signal_graph: null, active_move_ids: [],
    per_track_depths: [], manual_positions: {}, spatial_macros: null,
    object_channels: null, channel_modulations: null, osc_mappings: null,
    zones: null, mode: 'Full', scope: { position: true, move: true },
    pre_wait: 0, follow: 0, timecode: null,
  }],
})

// Toast de test :
window.__live.toasts.getState() // push/add selon l'API du store
```

Navigation surfaces : `localStorage.setItem('ss-surface', 'jeu'|'conduite'|'score'|'atelier')`
+ reload. Welcome modal skip : `localStorage.setItem('stagespace-welcomed', '1')`.

## 3. Scénarios de validation par chantier

| Chantier | Scénario | Critère |
|---|---|---|
| **U9+U3** arm+audition | injecter cue → surface conduite → clic row | row outline armée, audition radar au CENTRE de la conduite, NEXT mis à jour |
| **U9 cross-surface** | armer dans conduite → surface jeu | la cue armée visible dans la top bar jeu (même armedCueId) |
| **U14** log | menu Show jeu → soundcheck start → conduite | entrées log présentes (avant fix : absentes) ; répéter N fois la même action → badge ×N |
| **U4** toasts | push toast → mesurer `getBoundingClientRect()` | bottom = 64px exactement (validé 2026-11-27 ✓), cap 3 + « +N more » |
| **U2** soundcheck menu | menu Show JEU (pas conduite — entries surface-dépendantes !) | « start » visible hors sonde, « STOP — sonde en cours » pendant, next/prev grisés hors sonde |
| **U11** trackpos | position manuelle → clic droit objet radar | item « Set origin here — obj N » présent dans le menu |
| **U6** legend radar | freeze (attention) + park un objet | legend : freeze hollow vs park plein, rendu points cohérent |
| **U15** slider spatial | `/stagespace/spatial` OSC externe puis regarder strip | slider reflète k externe (plus figé à 1) |
| **U1** orphelins | ⚠ nécessite un VRAI move backend — voir §4 | chip +N ⚠ cliquable → slots coquilles |

## 4. Pièges déjà rencontrés (ne pas reproduire les erreurs)

1. **Seeding cue par l'UI input React échoue** — l'injection d'événement `input`
   natif ne déclenche pas le state React correctement. Utiliser `cues.setState` direct.
2. **Soundcheck entries surface-dépendantes** — absentes du menu conduite, présentes
   en jeu. Tester en jeu.
3. **`setManualPosition` brute ne log pas** — le test U14 doit passer par les vrais
   chemins (menus, boutons) qui appellent les `doX` wrappers loggés.
4. **Activer un vrai move est complexe** — nécessite graphe+slot+activation backend.
   Piste non testée : `stagespace-cli` ou drag template→slot dans l'atelier.
5. **Browserless cloud ne peut pas atteindre localhost** — inutilisable ici.
6. **Deux pages browser = deux stores Zustand indépendants** — la synchro passe par
   localStorage/backend, pas par la mémoire. Ouvrir la 2e surface APRÈS le seeding.

## 5. Scripts puppeteer existants (référence / fallback)

`.scratch/puppeteer-audit/validate-fixes*.mjs` — sondes d'API et tentatives
précédentes avec résultats partiels (U4 validé). `ux-survey-live2.mjs` pour le
pattern multi-surfaces.
