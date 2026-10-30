# Intégration console — piloter STAGESPACE depuis le FOH

L'ingé son garde sa console comme **conduite maîtresse** : chaque scène/snapshot
console émet un message OSC, STAGESPACE exécute. Le laptop ne sert que pour le
soundcheck et la surveillance.

## Commandes (`/stagespace/*`, UDP vers `oscInPort`, défaut 8001)

| Message | Effet |
|---------|-------|
| `/stagespace/go` | GO setlist (= Enter) |
| `/stagespace/cue/next` · `/prev` | cue suivante / précédente |
| `/stagespace/cue/recall <n> [fade]` | recall par `cue_number` ou index ; `fade` optionnel écrase le fade stocké |
| `/stagespace/slot <n>` · `/slot/stop <n>` · `/solo <n>` | busking : joue / coupe / solo le slot d'`oscIndex` n (stable, 1-based, fades du slot) |
| `/stagespace/arm` · `/disarm` | ARM = envoi OSC ; DISARM = **dry-run** (répétition silencieuse) |
| `/stagespace/status` | renvoie cue courante/suivante au demandeur |
| `/stagespace/park <n>` · `/unpark <n>` | l'objet **index n (0-based)** échappe aux recalls (override manuel préservé) |
| `/stagespace/panic` · `/stop` | blackout / stop all |
| `/stagespace/timecode <s\|"HH:MM:SS:FF">` | timecode → chase (fps via `set_timecode_fps`) |

## Feedback envoyé au contrôleur

- `/stagespace/ack <addr>` — accusé sur chaque commande acceptée
- `/stagespace/nack <reason>` — commande rejetée : `busy: recall-in-progress`, `not-found: …` (ciblé sur l'expéditeur)
- `/stagespace/cue/current <n> <name>` et `/stagespace/cue/next <n> <name>` — à chaque changement de cue et sur `/stagespace/status`

Les 4 derniers contrôleurs reçoivent le feedback — la console ET une tablette
Companion peuvent écouter en même temps.

## Recettes par console

- **DiGiCo (SD/Quantum)** : External Control → OSC command par snapshot.
  `/stagespace/cue/recall 5` dans le snapshot = la cue spatiale suit la scène.
- **A&H dLive / Behringer X32** : string/TCP-UDP message par scène vers le port
  `oscInPort`. X32 envoie nativement des floats — compatibles.
- **QLab / Companion** : cue OSC par-dessus la conduite ; bouton « SAFETY »
  mappé sur `/stagespace/cue/recall S1`.
- **Timecode** : envoyer `/stagespace/timecode <s>` (~25 msg/s) et activer
  *TC chase* dans le panneau cues — locate + franchissement gérés.

## Ce qui reste sur le laptop

Édition des graphes, positions manuelles (SpaceMouse / OSC-IN `Position`),
monitoring 3D, store/édition de cues. En live, tout le pilotage de conduite est
possible sans toucher l'UI.
