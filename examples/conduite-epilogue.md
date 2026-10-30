# Conduite — « Épilogue »
**Pièce :** théâtre immersif ~25 min · **Système :** STAGESPACE → Holophonix, 24 objets · **Timecode :** OSC `/stagespace/timecode` (25 fps)

| TC | Cue | Action scénique | Spatialisation demandée | Fade | Déclenchement |
|----|-----|-----------------|--------------------------|------|----------------|
| 00:00:00 | 1 Pre-show | Salle ouverte, public s'installe | Orbite lente d'ambiance, les 24 objets en cercle bas, présence discrète | 8 s | TC |
| 00:00:30 | 2 Entrée musiciens | Les musiciens entrent en scène | Le cercle se resserre et monte progressivement | 10 s | TC |
| 00:02:15 | 3 Duo + halo | Duo de tête, ensemble derrière | 4 solistes en ligne devant + halo circulaire des 20 autres | 6 s | TC |
| 00:05:40 | 4 Tempête | Séquence de panique | Mouvement chaotique nerveux (bruit + déphasage) | 4 s | TC, puis **follow 20 s** |
| — | 5 Calme | Retour au calme | Formation lente | 12 s | **auto** (follow cue 4) |
| 00:09:00 | 6 Voix off | Narration par-dessus la scène | −3 dB sur les pistes 1–4, tout le reste continue de tourner | 5 s | TC |
| 00:11:30 | 7 Suspension | Effet de givre | Le mouvement se fige et dégage en rythme (LFO) | 2 s | TC |
| 00:20:00 | 8 Rideau | Final | Tout converge au centre, le groupe se compacte | 15 s | TC |

## Notes de plateau

- **Cue 6** est volontairement *tracking* : elle ne touche que le gain des pistes 1–4 et laisse la formation, le graphe global et les autres canaux intacts — la narration passe par-dessus sans casser la scène.
- **Cue 4→5** enchaîne automatiquement en 20 s : le metteur en onde la prévoit ; l'opérateur peut interrompre avec GO/prev si la scène rallonge.
- **Cue 8** bascule aussi le graphe global (pivot barycentre) — le resserrement se fait autour du vrai centre du groupe, pas du point (0,0,0).
- Réserve d'imprévus : spacemouse / OSC-IN pour reprendre une position à la main, `park` pour figer un objet hors de la conduite, `panic` en cas de pépin, DRY-RUN pour répéter sans émettre d'OSC.

*Document correspondant au fichier `conduite-epilogue.hfg` — chaque ligne ci-dessus y est traduite cue par cue.*
