# E2E findings — session tests réels (dev_bridge + Puppeteer)

> Backend headless réel (MergeRuntime, OSC receiver :8001, superviseur) +
> frontend Vite via shim __TAURI_INTERNALS__. Chaque entrée : constat +
> proposition.

## Déjà trouvé & fixé (dd02f6c, e5e7bc9)

- [x] Orphans post-recall — slots non rebindés aux ids snapshot → rebind par nom+preview
- [x] Spam console panic — N lignes → 1 ligne agrégée
- [x] `.setup()` jamais exécuté en mock app → `setup_backend_runtime` appelé à la main (event_sink, OSC receiver, superviseur)
- [x] `.filter()` dans sélecteur Zustand → re-render infini (draw mode crash) → useMemo sur ref stable

## À améliorer — notes au fil des tests

### UX / cohérence

1. **Drag manipulate sensible à la distance caméra** — drag plan XZ projeté
   envoie l'objet très loin quand la caméra est éloignée (−60m pour ~80px).
   → clamper la distance de drag, ou échelle log, ou drag relatif à la
   vitesse curseur (pas la position absolue sur le plan).

### À creuser (pas confirmés bugs)

- Accordion catégories templates : un `click()` DOM simple ne l'ouvre pas
  (a fallu la séquence pointer+mouse complète). À vérifier à la main.

### Environnement de test (pas des bugs app)

- `position sink send failed` = UDP connecté + ICMP unreachable sans
  spatializer — correct.
- MCP console output répète le dernier message en boucle — artefact outil.


## Bugs confirmés

2. **`park_object` ne fige pas la position émise** — `state="park"`,
   `parked:[0]` mais l'objet continue de suivre son move (drift 1.6m/1.2s
   ≈ vitesse orbit). `parked_objects` n'est consulté NULLE PART dans le
   chemin emit (`emit.rs`/`loop_core`/`frame_helpers`) — seulement dans
   `objectStates` et le scope des recalls. Doc `/stagespace/park` =
   "freeze". → Soit implémenter le hold (écrire la position courante dans
   `manual_positions` au park, ou un `frozen_positions` map consulté comme
   les manuels), soit corriger la doc. Sémantique console = hold attendu.

Précision sémantique park : AGENTS.md dit "freeze", le code dit
"sémantique Park des consoles = protection des recalls". Les deux sont
contradictoires avec l'observation (la position bouge toujours). Le
comportement console-standard = hold position + protection recalls.
À trancher produit, mais l'actuel n'est ni l'un ni l'autre complètement.

3. **Gel fuit par le signal graph** — les deltas de macros issus du
   signal graph global s'appliquent AUSSI aux positions manuelles/gelées
   (manual → pp → transforms). Un yaw modulé fait dériver une position
   "figée" (manual5 tournait autour de Y, magnitude conservée). Conséquence :
   `attention_focus`, `End:hold`, anchors, tape replay ne gèlent pas
   vraiment tant qu'un signal module une macro. Retest avec graph vide :
   manual5 strictement figé à [9,9,9] et attention parfait (obj2 figé,
   focus obj1 bouge). → Décision produit : les deltas signal devraient-ils
   s'appliquer aux objets manuels/gelés ? Pour la sémantique "freeze"
   (change blindness) : non — sinon tout le décor tourne sous l'effet.

4. **Le signal graph global backend survit au changement de show** —
   "Start empty" (nouveau show vide côté frontend) n'a pas poussé de
   signal graph vide : le graph de la session/show précédent continuait
   de moduler les macros. Runtime state leak cross-show. → la création/
   le chargement d'un show devrait réinitialiser macros + signal graph +
   canal modulations + venue map (ou documenter que ce sont des réglages
   "système" persistants — mais alors le UI doit les montrer).

5. **park = protection recalls seule, pas de freeze** — contrairement à
   attention (qui seed manual_positions), park n'écrit rien : l'objet
   garde sa trajectoire de move et l'état affiché est juste un label.
   Doc "freeze" ≠ impl. Soit implémenter le hold (seed last_canonical →
   manual_positions + flag distinct pour ne pas confondre avec manuels
   opérateur au unpark), soit fixer la doc.

### Réseau / sortie OSC

6. **Un micro-bundle par message** — sortie = 56B/datagramme contenant un
   seul élément (`#bundle` + 1 msg) → ~64 datagrammes/frame = 3840 paquets/s
   à 60fps avec 64 objets. Fonctionnel mais coûteux (syscalls, buffers NIC,
   charge renderer). → vrai bundling par frame (tous les objets dans un
   seul datagramme), ou au moins par batch.

7. **Canaux spatiaux renvoyés chaque frame** — `/track/1/gain` part à 60Hz
   même sans changement de valeur. → delta-send des canaux (n'émettre que
   si |Δ| > ε) ; les positions bougent chaque frame, les canaux souvent
   non.

### OSC-IN (testé OK via vrais paquets :8001)

- `/stagespace/position 5 1 2 3` → manual pos ✓
- `/stagespace/park 7` / `unpark 7` ✓ · `/spatial 0.5` ✓
- `/attention 2` → gel des autres, `/attention/clear` → release ✓
- `/gesture explode 1.0` accepté ✓
- Sortie :9000 : `/track/N/xyz` + `/track/N/gain` confirmés réels.

### Robustesse IPC

8. **Clés inconnues des params nested ignorées silencieusement** —
   `add_channel_modulation` avec `objectIndex` (au lieu de `object_index`)
   accepte silencieusement et applique à TOUS les objets (`object: None`).
   `Option<T>` → None sans erreur. → `#[serde(deny_unknown_fields)]` sur
   les structs params, ou test contractuel des noms de clés frontend.

### Zones/modulations (OK)

- `add_zone` sphère/box ✓ (ZoneParams shape/a/radius/b/falloff/channels)
- `add_channel_modulation` source cinématique (speed/accel/jerk→canal) ✓
- `remove_*` par index ✓

### Résolu / non-bugs

- **"Flood" console panic = artefact MCP** — instrumentation in-page :
  `console.error` intercepté → exactement 1 appel (`emergencySlice.ts:52`)
  pendant que la sortie "Console output" du serveur puppeteer MCP répète
  la ligne ~6500×. Le dedup côté app fonctionne (1 ligne agrégée). Pas de
  fix nécessaire — mais attention à ne pas se fier à la sortie MCP brute
  pour compter des logs.
- `attention/clear` libère bien les 63 manuels seedés (test isolé).
- GO setlist duplique transitoirement le move pendant le crossfade —
  nominal (fade-out ancien + spawn nouveau).
- `/stagespace/slot` est 1-based (oscIndex) : `slot 0` → nack not-found,
  correct.

### Validé OSC-IN show-control (paquets UDP réels :8001)

position, park/unpark, spatial, attention/clear, gesture, rehearsal
record/stop/play/clear, soundcheck start/stop, timecode, slot n/stop n,
solo/unsolo, cue/arm+go.

### Validé divers

- Tape : `set_pos_tape_record` → `get_pos_tape` (entries t,{obj:pos}) →
  `play_pos_tape` rejoue le tracé (objets bougent sans move) ✓
- Rehearsal : capture/rejoue la séquence busking ✓
- Presets save/load/list/delete ✓
- Clavier : Space (toggle slot), Enter (GO crossfade), Esc (panic),
  `?` (cheatsheet visible) ✓
- Soundcheck : met tous les objets en `manual` pendant le probe —
  sémantique à confirmer (figer le décor OK, mais `stop` doit rendre
  les objets aux moves — à retester avec un move actif).

### À vérifier

- `soundcheck stop` après les tests : 64 objets restés `manual` (relicat
  de gesture aussi possible — test isolé à refaire).

### Validé suite

- `soundcheck` : 1 objet en probe `manual`, retour propre `move` à stop,
  0 manuel résiduel ✓
- `/stagespace/trackpos` : origin écrite ✓
- Ack/nack : `ack` sur accepté, `nack` sur not-found ; feedback
  `cue/current`+`cue/next` poussé au contrôleur ✓ — **mais 2 nack pour un
  même recall 99** (backend + frontend ?) → possible double-nack à tracer.
- Move weight/priority, track depths (Vec<f64> positionnel) : depth 0.3 →
  objet ramené à 30% de sa distance ✓
- `set_venue_config` (scale/offset/yaw) : transform appliqué au payload
  OSC, `emitted_positions` reste canonique (par design) ✓
- `get_perceptual_metrics` : legibility réelle ~90°/s ✓
- `set_psn_config` : obj0 → état `psn` (tracker_map 1→0) ✓
- show/load via OSC : accepté (moves restent — load passe par le frontend,
  pas de kill implicite vérifié)
- PSN/venue/depths/modulations/zones/tape/rehearsal/presets/soundcheck/
  cue-feedback : tous fonctionnels

## Synthèse

**3 findings majeurs (comportement produit)**
1. Gel fuit par les deltas de signal graph (manual/hold/attention/tape
   tournent sous un yaw modulé) — sémantique "freeze" cassée si signal actif.
2. Signal graph global survit au changement de show — état backend qui
   leak cross-show, invisible côté UI.
3. `park` ne fige pas la position (label seul) — doc "freeze" ≠ impl.

**Findings techniques**
4. Nested IPC params : clés inconnues ignorées → effet inattendu
   (modulation appliquée à tous les objets au lieu d'un seul).
5. Sortie OSC : micro-bundle/message → 3840 datagrammes/s ; canaux
   renvoyés chaque frame même inchangés.
6. Double-nack possible sur commande invalide (à tracer).

**Artefacts de test (pas des bugs app)**
- Flood console panic = répétition du collecteur MCP (1 seul appel réel).
- `position sink send failed` = UDP connecté + ICMP unreachable.

---

## Session 2 — fixes + retests réels (bridge dev_bridge + shim)

### Résolu et vérifié E2E

| Finding | Fix | Vérif E2E |
|---|---|---|
| **#1 gel sous deltas** — en fait PLUS PROFOND : la chaîne pp **compilée** (`compile_post_process`, active dès qu'un graphe global existe) ne consultait **jamais** `manual_positions` → park/attention/hold/tape/manuel **entièrement bypassés** sous graphe global | `PostProcessContext.base_macros` + substitution manual + split frozen/live (base vs eff macros) dans le pp compilé ; idem `default_post_process_fn` ; frozen layers transition | `park 0` sous LFO→yaw : drift **0.0000 m** (avant : 1.06 m/1.5 s) ; `manual [9,9,9]` exact |
| **#3 park = label** | `park_object` seed `last_canonical→manual` ; `attention_focus` skip les parkés (release ne casse pas le hold) | drift **0.0000 m**, unpark relâche |
| **#2 reset show** | `loadShowEnvelope` : sections absentes → reset déterministe (signal graph vide poussé backend, macros, FX, OSC) | code review + persistance |
| **#6 double-nack** | racine : shim `tauri-bridge.js` sans `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener` → `_unlisten` jetait TypeError avant l'invoke → **fuite de TOUS les listeners** (StrictMode/HMR) ; ajout + `__listeners` debug | fresh page : 1 cmd → **1** nack ; `show-control` listeners : 1 (était 2→8 cumulés) |
| **#4 clés IPC ignorées** | `deny_unknown_fields` sur structs params imbriqués | `objectIndex` invalide → erreur IPC au lieu de scope élargi |
| **#5 OSC channels** | delta-send approx_eq ε — canaux inchangés non renvoyés | unit + code review |

### Nouveaux findings session 2

7. **Stale `movementId` après restart backend** — le slot persisté affiche
   "playing" (boutons Stop) alors que le runtime est vide ; la sync ne
   tournait que sur l'event `active-moves-update` (changements seuls).
   Fix : reconcile `refreshMovements+syncSlotMovements` au mount du
   listener. Limite : si le backend est down au mount, le stale reste
   jusqu'au prochain event (acceptable — indicateur backend-down présent).
8. **`osc-armed-changed` ×3 / `conduite:cmd` ×2 listeners** — multi-mounts
   légitimes (useShowStatusStore + useOscArmed ; App + ConduitePage), pas
   des fuites.
9. **Rebind slots post-recall** — respawn sous id snapshot rebindé par
   nom unique + isPreview (testé ×1 et ×2 moves).
10. **Log panic dédupé** — N rejections reset → 1 ligne agrégée ; le
    "flood" était l'artefact collecteur MCP.
