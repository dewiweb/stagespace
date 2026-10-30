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
- Aucune console n'affiche le retour d'état → Companion/tablette pour la télémétrie ; **prochain incrément : panneau "conduite" dédié** dans l'app.
- Deux couches de gain (fader console vs `object_channels.gain`) — règle documentée : gain spatial réservé aux cues tracking/effets.
- Pas d'OSC learn pour brancher un fader/encoder en un geste.
- L'ack confirme la réception, pas l'exécution (recall asynchrone) — `cue/recall + fade court` reste la bonne pratique pour un hit.

---

## 2. Busking — concert non-timecodé (effets à l'inspiration)

**Scénario** : l'ingé prépare ses slots à la balance, puis tire/coupe/solo au
numéro en live. Tout doit être fondu et annulable.

**Ce qui est livré** : `playSlot`/`stopSlotWithFade` par UI + OSC (`/stagespace/slot|slot/stop|solo`, fades du slot respectés) ; layers parallèles ; `one_shot` pour les stingers ; macros `scale/shift/rotation/speed` et OSC-IN (`macro`, `channel`, `position`, handlers→signal) pour l'expression live ; `park` pour figer un objet repris à la main ; DRY-RUN pour répéter silencieusement.

**Limites ouvertes**
- Numérotation : `slot <n>` suit l'ordre `moveSlots` (création), pas `setlistOrder` — réordonner renomme les index ; à figer ou documenter.
- Pas de "bump momentané" hors `one_shot` (flash = laisser appuyé jusqu'au release n'existe pas).
- Le mapping fader→param demande un graphe signal pré-câblé (pas d'OSC learn).
- **Prochain incrément : mode busking dans PerformView** — pads numérotés, flash/solo visuels, learn.
