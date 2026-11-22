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

## Passe visuelle UX (screenshots live, 1600×950)

**Lisible / validé** : 3 surfaces aux vocations distinctes et cohérentes
(Atelier = construction, Conduite = conduite de cues gros boutons NOW/NEXT,
Jeu = pads busking + radar) ; état live toujours visible (badge 1 LIVE,
moves live, perf status bar réelle) ; toasts d'erreur parlants
("OSC destination unreachable — nothing is listening on :9000") ; hint
profil spatializer utile ("holophonix sends: gain — other channels
produce silence").

**Points d'amélioration UX notés** :
- Radar Jeu : cluster minuscule au centre (pas d'auto-zoom sur le rayon
  du champ) — peu exploité quand les objets orbitent à ~2m dans une vue 5m.
- Pad "hold=bump" : jargon non explicité pour l'opérateur.
- Panneau FX : plusieurs inputs sans label visible (0,0,0 / 2 / 0.1 / 0.5),
  labels tronqués (`spread (no`, `obj (al`, `min (-`) — formulaire dense.
- Badge NOW sur layer Spline Path ambigu alors qu'1 seul move joue.

## Session 3 — campagne UI élément par élément (réel)

**Toolbar Atelier** : surfaces ×3 (tooltips descriptifs), Expert toggle,
undo/redo présents, save/load .hfg présents, LIVE→`get_osc_armed`
true→false→true réel, `?`→cheatsheet, PANIC→0 moves + log agrégé,
Esc ferme le modal SANS paniquer (priorité modal correcte).

**Onglets SHOW** : Moves / Cues / FX / Score / Log — tous rendent leur
propre panneau. (Faux positif initial = mauvais sélecteur de test.)

**Canvas** : palette Select/Manipulate/Assign/Draw — Draw désactivé à
juste titre sans node dessinable ; footer contextuel par mode ;
Manipulate drag déjà prouvé E2E ; **Assign : mode actif + hint footer,
mais le pick d'objet n'a pas été déclenché en synthétique — à confirmer
à la main (cible de clic potentiellement petite)**.

**Macros sliders** : Speed 1→2.5 → drift ×~5 réel. **Cues** : ARM toggle,
dblclick recall (respawn réel), store OK. **FX** : zone via formulaire
UI → `list_zones` backend ; modulation → `list_channel_modulations`.

**Conduite** : CUE GO / Prev / Next → recalls réels ; CONSOLE présent.
**Jeu** : STOP ALL → 0 moves ; pad tap relance (pointer events requis) ;
ATTN = release désactivé sans stase (correct) ; SPATIAL k=0.5 compresse
réellement le champ (1.47 vs 2.0). Settings modal complet.

**À noter** : pads réagissent au pointerdown, pas au click simple —
cohérent tactile mais à savoir ; bottom chips Jeu (Params/Playback/
Tracks/Audio/OSC IN/Global) visibles, non détaillées.

## Session 4 — campagne UI point par point, 2e vague (réel)

**Slots (MovesTable)** : rename inline par dblclick sur le nom (input +
Enter) ✔ ; reorder setlist ▲/▼ (colonne SET change, tri visuel = ordre
de création — à noter) ✔ ; toggle Mode Live→Preview (« pas d'OSC out ») ✔ ;
chooser tracks (popover) ✔ ; template select 33 presets + plan xz/xy/yz ✔ ;
popover Macros (Speed/Scale/Shift/Rot/Fade « Applied on launch and GO ») ✔ ;
delete → modale « Delete « name » ? Slot graph, tracks and macros are
lost — cannot be recovered » + confirm réel (ligne supprimée) ✔ ;
remove-from-setlist (SET → vide) ✔ ; Edit graph → Expert Node Editor ✔.

**Score panel** : 2 sections — SCORE (commandes horodatées, replay
partition) + TAPE (positions 30 Hz), chacune ⏺ rec / ⏹ / ▶ / ↓ export /
↑ import + texte explicatif clair (.sscore.json partageable, bounce chez
renderer externe).

**Inspector chips (Jeu + Atelier)** : Params/Playback/Tracks/Audio/
OSC IN/Global — tous rendus. Playback = Speed + direction (forward/
backward/pingpong) + fades In/Out + mode loop/oneshot + end revert/hold +
anchor origin/current/follow (toggles actifs réels). Tracks presets
All→8/8, None→0/8, Odd→4/8 réel. Audio form = Source(BPM/RMS/Bass/Mid/
High) + Target(10 macros) + Intensity + Lissage. OSC IN = mappings +
Add + LEARN ; Add vide → toast « Address + destination required »
(validation propre).

**Settings modal** : 5 onglets réels — Réseau (OSC OUT host/port/6 profils
+ OSC IN + /media), Tracking (PSN multicast/port/map/axes), Salle (venue
scale/offset/yaw — payload OSC only, canonique préservé), Show (merge
mode + liste tracks), Audio (« No device listed — start the microphone
once to enumerate » = empty state honnête en headless).

**Verrou config OSC** : changement de port refusé pendant le jeu
(toast warning, input revient) ; accepté à l'arrêt ; **backend re-ciblé
réellement :9001 — paquets /track/N/xyz reçus par un vrai listener UDP**.

**Assign pick — VALIDÉ** : en édition, clics sur les objets du 3D Preview
togglent les tracks (compteur N/64 change : 4→3→4→2→1→0). Le handler est
sur l'overlay pointerdown du canvas — les events doivent viser
elementFromPoint, pas le canvas WebGL.

### Bugs trouvés cette session → FIXÉS

- **Audio mod `source:''` briquait le slot** : un mod persisté avec une
  source inconnue (show étranger/corrompu) faisait échouer TOUT
  `activate_move` (`unknown variant ''`). Fix : `normalizeSlot` filtre
  les mods invalides (source/target hors enums) — slot relancé en réel,
  console.error une fois. `moveSlotsTypes.ts`.

- **Boucle de hot-swap à 0 track** : vider les tracks d'un move LIVE
  (deselect All, assign, None) poussait `update_move_graph_merged`
  n_objects=0 → échec backend → ~16k console.error/s (mesuré in-page,
  boucle réelle). Deux chemins patchés : `setSlotTracks` (warn + early
  return) et `updateGraphLive` (skip + warn-once via flag). Vérif :
  3 deselects → 0 erreur backend, 1 warning toast.

### Améliorations notées

- Tri visuel MovesTable = ordre de création alors que SET affiche
  l'ordre setlist — une ligne peut afficher « #1 » avec SET=2. Dérouter
  possible : envisager tri par SET ou un indicateur.
- `0/8` tracks affiché quand None — un slot à 0 track ne peut pas
  jouer : le bouton Launch devrait se désactiver / avertir avant le
  backend (à l'arrêt c'est un état d'édition légitime).
- Le toast « PANIC partially failed — N position reset(s) lost » est
  correct mais apparaît aussi quand la destination OSC est simplement
  absente en test — message OK en prod.

## Session 5 — chaîne audio réelle (fooyin → PipeWire → app)

**Setup** : fooyin joue sur la sortie analog ; source PipeWire par défaut
= `alsa_output…analog-stereo.monitor` ; `start_audio_capture` device
`pulse` → capture réelle.

**`get_audio_state` vivant** : amplitude {bass 0.08–0.47, mid, high, rms},
bpm ~164–192 (confidence ~0.45), spectrum FFT 1024 bins — valeurs
variables à chaque échantillon, corrélées à la musique.

**Audio mod end-to-end** : injecté `bass→radius_scale ×1.5` sur move live
via `update_animation_state` → les 4 objets du move respirent ENSEMBLE
avec la basse (r : 2.55→3.31→2.57→3.30→0.70 en suivant l'enveloppe
bass, lag = smoothing 0.3 attendu). Puis ajouté un 2e mod via le formulaire
UI (+ Add audio mod → selects réels) → « Bass → Radius » affiché avec
sliders Intensity/Lissage — write-through live confirmé.

**Dégradation propre** : `stop_audio_capture` → audio_state tout null →
rayon retombe exactement à la base 2.00 (mod contribue 0, pas
d'offset résiduel, pas d'erreur).

**Visuel** : Jeu — pad OrbTest « LIVE » avec les 32 tracks listées,
panneau Audio « Bass → Radius » + Intensity/Lissage, radar alimenté,
STOP ■ OrbTest actif.

### Notes audio

- `list_audio_devices` expose les devices hôte cpal (jack/pipewire/
  pulse/default/hw…) — pour capter la sortie il faut `pulse`/`pipewire`
  ET la source par défaut sur le monitor. Le panneau Audio dit
  « Start the microphone once to enumerate » : le cas capture-de-sortie
  (monitor) n'est pas expliqué — à documenter pour l'opérateur.
- Un mod poussé backend-direct (update_animation_state) n'apparaît pas
  dans la liste du slot (état persisté ≠ état live) — séparation
  honnête, cohérente avec l'archi backend-authoritative.
- BPM conf ~0.45 sur le morceau testé — utilisable mais pas rock-solid
  pour sync critique (attendu pour un détecteur temps réel).

---

## Session 5 — Sélecteur de source audio : Settings sur le mauvais univers

### Bug trouvé (cassé de bout en bout)

L'onglet **Settings → Audio** énumérait les devices via
`navigator.mediaDevices.enumerateDevices()` — l'API du webview. Ses
`deviceId` (UUID opaques par origine) n'ont **aucun sens pour cpal** :
`start_audio_capture` fait `parse::<usize>()` (index d'énumération) →
tout choix ≠ « System default » → `device not found`. L'AudioPanel, lui,
utilisait déjà `list_audio_devices` (backend) — deux implémentations
divergentes du même sélecteur.

### Fix

`SettingsModal.tsx` : énumération remplacée par
`invoke('list_audio_devices')` — même source cpal que `AudioPanel`,
IDs identiques, select rend `d.id`/`d.name`.

### Preuve réelle (fooyin toujours en lecture)

- Settings → Audio liste maintenant les vrais devices cpal :
  `0=jack, 1=pipewire, 2=pulse, 3=default, 12=hw:CARD=Generic_1,DEV=0…`
- Sélection `pulse` (value `2`) → `localStorage.stagespace-audio-device="2"`
- `start_audio_capture(deviceId:"2")` → capture OK,
  `get_audio_state` vivant : bass 0.12, rms 0.09, **bpm 197 @ conf 0.78**,
  spectrum 1024 bins
- « System default » → `deviceId:null` → `default_input_device` →
  capture OK (bass 0.22)
- `deviceId:"999"` (absent) → erreur IPC propre, pas de capture fantôme

### Cross-platform (réponse design)

`cpal::default_host()` : ALSA (Linux, → PipeWire via compat), CoreAudio
(macOS), WASAPI (Windows). Le `device_id` persiste un **index
d'énumération** — volatil au replug ; le backend compense déjà en
re-résolvant **par nom** (`reconnect_device_index`) quand le stream meurt.
Limite restante : l'index persisté peut pointer sur un autre device après
un changement de config matérielle — la résolution par nom au démarrage
serait plus robuste (amélioration future côté backend).

---

## Session 5b — Audit UX/UI (heuristique + parcours cognitif)

Audit complet dans `docs/ux-audit.md` (12 pistes classées). Points
saillants : 5 noms pour le même concept (move/slot/pad/layer/animation),
« LIVE » à 4 sens, trois systèmes de GO qui se recouvrent, deux listes
Moves face à face, catégories de nodes par implémentation, jargon exposé
(hold=bump, unverified, trk).

## Session 6 — Correctifs UX (findings C1–C6 + quick wins)

Suite du deep-dive UX (`docs/ux-audit.md`) — les findings de conception
sont fixés et prouvés en réel.

### C1 — Renommage silencieux par template ✔ FIXÉ

Cliquer un template sur un slot écrasait `slot.name` (`name: preset.name`
dans `setSlotTemplate`) — le nom custom disparaissait et divergeait du
mouvement live. Fix : le nom n'est remplacé que s'il est encore le nom
auto `Move N`. Prouvé : slot renommé `ZZTest` → template `Spiral`
appliqué → le nom reste `ZZTest` (avant : devenait `Spiral`).

### C2 — Chip ARM cues = dry-run OSC global ✔ FIXÉ

L'onglet Cues affichait `ARM`/`DRY-RUN` pour le même état que le `LIVE`
de la toolbar — un mini-chip dans un panneau local pouvait couper toutes
les sorties OSC. Fix : le chip affiche `LIVE`/`DRY-RUN` avec un tooltip
explicite — vocabulaire identique aux deux endroits.

### C3 — Track IDs : validation avec feedback ✔ FIXÉ

`abc;;9` était parsé silencieusement en `[9]` (63 IDs perdus). Fix :
`handleOscIdsChange` rejette les tokens non-numériques, affiche
« Ignored — invalid entries: … » sous le champ, garde la dernière liste
valide. Prouvé : erreur visible, disparue au retour valide, store intact.

### C4 — Suppression de node invisible ✔ FIXÉ

Le menu contextuel node ne proposait que des « runnable examples » ;
la suppression était clavier-only non documentée. Fix : entrée
« ✕ Delete node » ajoutée au menu (passe par `removeByIds` — re-heal des
chaînes inclus). Prouvé : clic droit node → entrée rendue.

### C5 — Gestes composés sans UI ✔ FIXÉ

`explode`/`converge`/`orbit`/`front` n'existaient qu'en OSC-IN. Fix :
4 boutons dans `GestureStrip` (Jeu), `doGesture(name, 3.0)` — la force
par défaut du protocole. Désactivés quand aucun objet n'est émis (hint
explicite). Prouvé : EXPLODE cliqué → obj 0-5 propulsés radialement
(`[-1.73,0,1.0] → [3.14,0,1.13]`…), amortissement balistique observé.

### C6 — Faux onglet « 3D PREVIEW » ✔ FIXÉ

Le label dans la rangée des vues Free/Top/Front/Side ressemblait à un
onglet désactivé. Fix : stylisé en libellé (`· 3D PREVIEW`, select-none,
opacité réduite) + tooltip expliquant comment interagir.

### Quick wins

- **Pads — mur de numéros** : `formatTrackIds` condense les tracks en
  plages (`1-32` au lieu de 64 chiffres), les tracks parkés ⏸ gardent
  leur marqueur, tooltip = liste complète + rappel tap/hold.
- **Tooltips PERFORM** : Fwd/Bwd/Ping et Loop/One-shot expliqués
  (« joue à rebours », « une fois puis termine — voir End »).
- **Log opérationnel** : `formatLogLabel` mappe les noms de fonctions
  (`doTape` → « Position tape », `doTcChase` → « TC chase »…) dans les
  deux vues de log (Conduite + ShowLogPanel).

### Vérifs

- `npx tsc -b` propre, 485/485 vitest, lint 0 erreur
- E2E réel : geste balistique mesuré, rename préservé, validation
  visible, chip LIVE unifié, entrée delete rendue

## Session 7 — Cohérence inter-surfaces (Atelier ↔ Jeu)

Suite des findings UX sur l'invariant entre surfaces.

- **Panneau gauche** : défaut 256→520px (table = 503px mesurés), migration
  douce pour les valeurs persistées = ancien défaut, scroll-x si resserré.
- **Sélection de move** : l'Inspector a maintenant un `<select>` permanent
  (« ◆ Global » = désélection explicite — avant : toggle invisible sur la
  cellule # de la table). La mini-liste MOVES dupliquée est supprimée.
- **Pad → édition** : tap sur le NOM du pad sélectionne le move pour le
  drawer sans le lancer (corps = transport pur). Avant : sélectionnable
  seulement via la ligne setlist ou en le lançant. Ring indigo sur le pad
  sélectionné.
- **Vocabulaire scopes** : `Perform`→`Playback`, merge macros →
  `Global macros` (vs `Macros` = scope move) — les deux surfaces parlent
  le même langage.
- **Constat** : pads transport ≠ sélection est CORRECT en multi-pad
  (retour utilisateur) — le drawer resterait instable sinon. Le transport
  canonique (`PLAY · <sélection>`) émerge naturellement en top-center.

Reste : hiérarchie des GO (3 systèmes), `editing:` chip discret,
NOW qui ignore les buskés.

## Session 8 — NOW busked, hiérarchie GO, chip editing

Corrections de la session précédente, vérifiées en réel :

- **NOW inclut les buskés** (`playingNames` ajouté au contrat
  `ConduiteViewState` + broadcast `conduite:state`) : sans cue courante,
  NOW = noms des moves live (`ZZTest +3 · busked — no current cue`)
  au lieu de `—`. Preuve : 4 moves lancés hors cue, capture montrant
  NOW/4 moves live cohérents.
- **RECALL = amber** : le bouton qui tue la scène entière était violet
  neutre comme la navigation. Désormais amber — la couleur code le
  risque (CUE GO vert = avance, RECALL amber = remplace tout,
  PANIC rouge = tue).
- **`editing:` cliquable** : le chip du LiveDrawer est un bouton
  `✕` — désélection explicite (retour Global), symétrique au
  `◆ Global` de l'Inspector. Avant : seule désélection = bouton
  `All` invisible sans move live.

Reste : les trois GO (CUE GO / SETLIST GO / RECALL) cohabitent sans
hiérarchie visuelle de risque au-delà de la couleur ; `NOW` affiche les
noms mais un cue courant + buskés simultanés ne montre encore que le
cue (les buskés restent dans le compteur « N moves live »).
- **Orphelins visibles** : la top bar Jeu affiche `N LIVE +K ⚠` (amber)
  — avant, un mouvement orphelin (recall/deactivate raté) émettait
  sans apparaître dans le compteur slots. Le `3 live` du StatusBar
  (vérité backend) devient auto-expliqué. Prouvé : 2 slots + 1
  orphelin → `2 LIVE +1 ⚠`.
- **Circle/Circular unifié** : le preset s'appelait `Circle` mais
  créait un node `Circular` (type contractuel backend). Presets
  alignés sur les types : `Circular`, `Elliptical`, `RoseCurve`,
  `Circular + X`. Les noms descriptifs (Pursuit→Follow,
  Gravity Well→PointDistanceFalloff) restent — ce sont des
  configurations nommées, pas des quasi-doublons.
- **NOW + buskés sous cue** : `+ <noms> busked` en sous-titre quand
  un cue courant coexiste avec des layers buskées.
