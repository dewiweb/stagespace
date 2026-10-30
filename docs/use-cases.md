# Cas d'usage — à amender/compléter

Deux scénarios de terrain validés et leurs limites ouvertes. Document vivant :
toute nouvelle exigence ou correction vient s'y ajouter.

---

## 1. Ingé son mix console + effets (conduite maîtresse = console)

**Scénario** : l'ingé pilote déjà sa console à ses scènes ; chaque snapshot/scène
émet un OSC, STAGESPACE exécute les cues spatiales en chasse. Le laptop ne sert
que pour le soundcheck et la surveillance.

**Ce qui est livré** : `/stagespace/{go,cue/next,prev,recall,panic,stop,park,unpark,arm,disarm,status,timecode}` + `/slot|slot/stop|solo` ; ack + feedback `cue/current|next` vers les 4 derniers contrôleurs ; `docs/console-integration.md` ; `examples/conduite-epilogue.*` ; fade optionnel sur `cue/recall` ; `set_osc_armed` (dry-run) pilotable par OSC.

**Limites ouvertes**
- Aucune console n'affiche le retour d'état → Companion/tablette pour la télémétrie ; **début livré** (`fda88ac`) : NOW/NEXT cue + chip TC dans la top bar de PerformView ; reste un panneau conduite dédié plus lisible à distance.
- Deux couches de gain (fader console vs `object_channels.gain`) — règle documentée : gain spatial réservé aux cues tracking/effets.
- Pas d'OSC learn pour brancher un fader/encoder en un geste.
- L'ack confirme la réception, pas l'exécution (recall asynchrone) — `cue/recall + fade court` reste la bonne pratique pour un hit.

---

## 2. Busking — concert non-timecodé (effets à l'inspiration)

**Scénario** : l'ingé prépare ses slots à la balance, puis tire/coupe/solo au
numéro en live. Tout doit être fondu et annulable.

**Ce qui est livré** : `playSlot`/`stopSlotWithFade` par UI + OSC (`/stagespace/slot|slot/stop|solo`, fades du slot respectés) ; layers parallèles ; `one_shot` pour les stingers ; macros `scale/shift/rotation/speed` et OSC-IN (`macro`, `channel`, `position`, handlers→signal) pour l'expression live ; `park` pour figer un objet repris à la main ; DRY-RUN pour répéter silencieusement.

**Limites ouvertes**
- Numérotation : `slot <n>` suit l'ordre `moveSlots` (création), pas `setlistOrder` — réordonner renomme les index ; **l'UI affiche le `#n` OSC dans PerformView** (alignement écran↔commande), reste à figer/documenter la sémantique.
- Pas de "bump momentané" hors `one_shot` (flash = laisser appuyé jusqu'au release n'existe pas).
- Le mapping fader→param demande un graphe signal pré-câblé (pas d'OSC learn).
- ~~Prochain incrément : pads numérotés + solo dans PerformView~~ **livré** (`fda88ac`) — badge `#n` par slot, bouton `S` solo dès que plusieurs moves jouent ; reste flash/solo visuels d'un vrai pad et learn.

### 2b — Variante WFS + couronne KNN (renderer externe)

**Scénario** : concert live — entrées instrus/voix mixées en **WFS** (Wave
Field Synthesis) sur alignement HP, plus un **bus KNN** vers une couronne de
HP autour du public. Le processeur spatial externe (Holophonix, SPAT, ADM-OSC
renderer…) possède tout le panning : STAGESPACE n'envoie que les
positions/trajectoires des objets.

**Mapping** : objets 1–N = mix WFS (sources ponctuelles dans le sweet spot),
objets N+1–24 = couronne KNN. Côté STAGESPACE c'est juste des index de tracks —
la séparation en bus vit chez le renderer. `Group`/partition dans les graphes
donne des sous-ensembles propres par bus.

**Spécificités**
- WFS : les moves doivent rester dans la zone couverte par l'alignement
  (sweet spot / hors-champ de l'array) — contrainte de *design du graphe*,
  pas du moteur.
- KNN couronne : `Circular`/`Rotate`/phase-spread = usage canonique ;
  `distance`/`gain` universels, `spread`/`aperture` selon profil/renderer.
- La chaîne audio n'est jamais touchée : park, manual position, slots, solo
  agissent uniquement sur les positions — le mix WFS/KNN continue tourner.
