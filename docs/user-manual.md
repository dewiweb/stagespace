# Manuel utilisateur — STAGESPACE

Moteur de **trajectoires et de position spatiale** : STAGESPACE ne produit pas de
son — il envoie en OSC les positions, canaux et modulations de vos objets audio
vers un renderer externe (Holophonix, SPAT Revolution, IEM, ADM-OSC, ou tout
récepteur OSC).

```
Graphe de nœuds → moteurs f(t) → merge 60fps → OSC → renderer → enceintes
```

---

## 1. Démarrage

1. Lancez l'app. Importez votre projet **`.hol`** (Holophonix) pour peupler les
   tracks, ou définissez des **OSC ids manuels** si vous n'avez pas de fichier.
2. Configurez **OSC out** (Toolbar) : adresse, port, profil du renderer
   (Holophonix / Spat / IEM / ADM / générique XYZ / générique AED).
3. Les positions de vos objets partent à **60 fps** dès qu'un move tourne.

### Modes d'affichage

| Vue | Pour quoi |
|-----|-----------|
| **Edit** (par défaut) | éditer graphes, nodes, paramètres, graphe global |
| **Perform** | piloter en live : setlist, layers, cues, pads |
| **Mode touch** (icône grip) | pads numérotés gros doigt pour tablette |
| **Conduite** | plein écran NOW/NEXT cue — bouton *Conduite* |
| **Conduite ⧉** | la même vue dans une **fenêtre détachable** (écran dédié FOH) |
| **Busking** | plein écran pads géants — bouton *Busking* |

---

## 2. Deux façons de travailler

### A. Conduite console — l'ingé pilote depuis sa console

La console émet des commandes OSC `/stagespace/*` ; STAGESPACE chasse.
Le laptop sert au soundcheck et à la surveillance — pas à piloter en live.

```
Snapshot console → OSC → STAGESPACE exécute la cue
                           ↘ feedback → ack/nack + cue courante
```

- **Cues** : snapshotez l'état (moves, canaux, graphes, macros, mappings) —
  *Full* = remplace tout, *Tracking* = ne touche que ce qui est enregistré
  (merge par index objet).
- **Conduite détachable** (bouton **⧉**) : NOW/NEXT/*then* en très gros,
  timers `pre_wait`/`follow`, TC, voyant **CONSOLE ●** (le lien console se voit
  à l'œil), **PARKED**, PANIC. Posée sur un écran dédié au FOH.
- **Voyant CONSOLE** : vert = dernière commande show-control < 5 s.
- **NACK** : toute commande refusée (`busy`, `not-found`) est renvoyée à
  l'expéditeur — la console sait quand quelque chose n'a pas été exécuté.

### B. Busking — concert non-timecodé, à l'inspiration

Les slots se préparent à la balance, se tirent au numéro ou au doigt.

- **Pads** : mode touch ou Busking — *tap* = play/stop, **hold ≥350 ms =
  bump momentané** (joue tant que tenu), **S** = solo, fades du slot.
- **UNSOLO** : rejoue les slots coupés par le dernier solo — le solo n'est
  plus une fin en soi.
- **Layers** : les moves jouent en parallèle — superposez un essaim sur une
  orbite.
- **Numérotation stable** : `#n` affiché = `oscIndex` — le numéro programmé
  en console ne change pas si vous réordonnez les slots.
- **STOP ALL** : coupe tous les moves en fondu (moins brutal que PANIC).
- **Expression live** : macros (scale/shift/rotation/speed), positions
  manuelles, faders externes via OSC-IN mappings.

---

## 3. Référence OSC show-control (`/stagespace/*`)

Port entrant = `oscInPort` (défaut 8001). Préfixe réservé — ces messages sont
interceptés avant vos mappings utilisateur.

| Message | Effet |
|---------|-------|
| `/stagespace/go` | GO setlist (= Entrée) |
| `/stagespace/cue/next` · `/prev` | cue suivante / précédente |
| `/stagespace/cue/recall <n> [fade]` | cue par numéro/nom ou index ; `fade` optionnel |
| `/stagespace/slot <n>` · `/slot/stop <n>` · `/solo <n>` | busking : joue / coupe / solo le slot d'`oscIndex` n |
| `/stagespace/unsolo` | restore des slots coupés par le dernier solo |
| `/stagespace/park <i>` · `/unpark <i>` | objet index *i* (0-based) hors recalls |
| `/stagespace/arm` · `/disarm` | envoi OSC / **dry-run** (répétition silencieuse) |
| `/stagespace/status` | renvoie cue courante/suivante au demandeur |
| `/stagespace/timecode <s \| "HH:MM:SS:FF">` | timecode → chase (fps 24/25/30 configurable) |
| `/stagespace/panic` · `/stop` | blackout / stop all |

**Feedback au contrôleur** : `ack` sur chaque commande acceptée ; `nack
<reason>` sur rejet ; `cue/current` et `cue/next` à chaque changement et sur
`status`. Les 4 derniers contrôleurs reçoivent le feedback (console + tablette
en même temps).

### Raccourcis clavier

`Space` play/stop du slot sélectionné · `Enter` GO setlist · `Shift+Enter`
recall cue suivante · `Backspace` cue précédente · `Esc` **panic** ·
`Ctrl+Z`/`Y` undo/redo

---

## 4. OSC-IN mappings + Learn

Brancher un fader externe sur un paramètre — drawer *OSC IN* (PerformView) :

| Destination | Effet |
|-------------|-------|
| `handler:name` | valeur stockée — lisible par le signal graph |
| `macro:scale` (shift/yaw/speed…) | macro du merge — tous les moves live |
| `channel:gain:3` (gain/spread/distance/presence…) | canal de l'objet 3 |
| `position:2` | position manuelle de l'objet 2 (override) |

- **LEARN** : tapez une destination, cliquez LEARN, bougez le fader — l'adresse
  se remplit seule (timeout 10 s).
- **Valeurs live** affichées à côté de chaque mapping — le fader bouge = le
  chiffre bouge.
- ✎ édite le mapping (adresse/destination/transform pré-remplis — Add
  remplace à même adresse) ; checkbox `enabled` coupe sans supprimer.

---

## 5. Sécurité live

- **Panic (Esc)** : stoppe tous les moves + renvoie les positions origine.
  Passe même pendant la suppression anti-loop.
- **Dry-run / ARM** : tout tourne, rien ne part au renderer — répétition
  silencieuse sans déranger le son.
- **Park** : un objet repris à la main échappe aux recalls — voyant PARKED
  dans la topbar et la conduite ; clic → unpark individuel ou tout.
- **Objets manuels** : toute position déplacée à la main (3D, SpaceMouse,
  OSC-IN `position:`) est un override — visible sur la vue 3D.

---

## 6. Dépannage

| Symptôme | Cause probable | Vérifier |
|----------|----------------|----------|
| Objet qui ne bouge plus aux recalls | Park oublié | Chip **PARKED** topbar/conduite |
| "J'ai appuyé et rien ne s'est passé" | Recall en cours ou slot/cue inexistant | `/stagespace/nack` renvoyé au contrôleur |
| Console ne répond pas | Lien OSC mort | Voyant **CONSOLE ●** gris = >5 s sans commande |
| `TC lost` | Pas de message `/stagespace/timecode` depuis >1 s | Source TC et port `oscInPort` |
| Move qui joue en silence | Tracks demandées hors liste OSC | Le CLI/app refuse désormais explicitement |
| Pas d'OSC sortant en répète | Dry-run actif | Bouton ARM / `OscArmToggle` |

## 7. Conduite d'exemple

`examples/conduite-epilogue.hfg` (+ `.md`) : spectacle ~1 h 25, 19 cues,
14 moves, deux actes + entracte — TC, follow, tracking, safety cue S1.
Importez-le pour explorer tous les mécanismes.
