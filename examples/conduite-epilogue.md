# Conduite — « Épilogue »
**Pièce :** théâtre immersif ~1 h 25 (deux actes + entracte + rappel) · **Système :** STAGESPACE → Holophonix, 24 objets · **Timecode :** OSC `/stagespace/timecode` (25 fps)

| TC | Cue | Action scénique | Spatialisation demandée | Fade | Déclenchement |
|----|-----|-----------------|--------------------------|------|----------------|
| 00:00:00 | 1 Pre-show | Salle ouverte, public s'installe | Orbite lente d'ambiance, les 24 objets en cercle bas | 8 s | TC |
| 00:09:30 | 2 Houselights | Moitié des feux | Dip −6 dB général, la formation continue | 5 s | TC |
| 00:10:00 | 3 Ouverture | Rideau | Le cercle se resserre et monte progressivement | 10 s | TC |
| 00:14:00 | 4 Duo + halo | Duo de tête, ensemble derrière | 4 solistes en ligne + halo circulaire des 20 autres | 6 s | TC |
| 00:19:30 | 5 Tempête | Séquence de panique | Mouvement chaotique nerveux (bruit + déphasage) | 4 s | TC, puis **follow 20 s** |
| — | 6 Calme | Retour au calme | Formation lente | 12 s | **auto** (follow cue 5) |
| — | 7 Transition acte | Fin de scène, annonce d'entracte | Pendule régulier en attente | 6 s | **GO manuel** (sur appel) |
| 00:30:00 | 8 Entracte | Pause | Ambiance large et lente | 8 s | TC |
| 00:40:00 | 9 Reprise acte 2 | Les artistes reviennent | Hélice ascendante | 8 s | TC |
| 00:45:00 | 10 Vague | Scène onirique | Rose curve | 6 s | TC |
| 00:50:00 | 11 Lissajous | Duo de scène 2 | Entrelacs | 6 s | TC |
| 00:55:00 | 12 Essaim | Chaos organique | Boids | 4 s | TC |
| 01:00:00 | 13 Percussions | Passage rythmé | Bounce | 2 s | TC |
| 01:04:00 | 14 Suspension | Effet de givre | Freeze/défreeze en rythme (LFO) | 2 s | TC |
| 01:10:00 | 15 Montée finale | Dernière accélération | Spirale ascendante | 6 s | TC |
| 01:16:00 | 16 Rideau | Final | Convergence au centre, groupe compact | 15 s | TC |
| — | 17 Rappel | Bis | Retour d'orbite d'ambiance | 8 s | **GO manuel** (sur appel) |
| 01:25:00 | 18 Post-show | Sortie de salle | Dip −6 dB léger, ambiance continue | 6 s | TC |
| — | **S1 SAFETY** | **Secours** | Orbite neutre, niveaux plats | 3 s | **manuel** `/stagespace/cue/recall S1` |

## Notes de plateau

- **Cues 2 et 18** sont *tracking* (scope = canaux seulement) : elles modulent les niveaux sans toucher la formation, le graphe global ou les autres catégories — la conduite lumière/vidéo reste indépendante.
- **Cue 5→6** enchaîne automatiquement en 20 s ; l'opérateur peut interrompre avec GO/prev si la scène rallonge.
- **Cue 16** bascule aussi le graphe global (pivot barycentre) : le resserrement se fait autour du vrai centre du groupe.
- **Cue 17 (Rappel) et cue 7 (Transition)** sont volontairement sur GO manuel — elles dépendent de l'appel plateau, pas d'un temps.
- **S1** : cue de secours à numérotation alphabétique, rappelable par `cue/recall S1` depuis n'importe quelle console OSC — reprend le contrôle en 3 s si la conduite dérape.
- Réserve d'imprévus : `park` pour figer un objet hors des cues (ex. enceinte en panne), spacemouse/OSC-IN pour une position à la main, `panic` en cas de pépin, DRY-RUN pour répéter sans émettre d'OSC, locate TC pour reprendre en cours de route (seek dans la trajectoire).

*Document correspondant au fichier `conduite-epilogue.hfg` — chaque ligne ci-dessus y est traduite cue par cue (vérifié : TC, fade, mode, follow concordants).*
