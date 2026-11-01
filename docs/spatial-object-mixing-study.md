# STAGESPACE — tour de contrôle du mix orienté objet

Étude de positionnement : littérature scientifique, état de l'art, conduites-types,
audit capacité + ergonomie, gaps et roadmap.

---

## 1. Fondements perceptuels (littérature)

Ce que la recherche impose au design d'un système de positions pour mix objet :

### 1.1 Localisation dynamique

- **MAMA** (Minimum Audible Movement Angle — Harris & Sergeant 1971 ; Perrey &
  Nobbe 2001) : ~1–3° de déplacement minimum pour percevoir un mouvement ; la
  perception se dégrade avec la vitesse.
- **Localization blur** (Rakerd & Hartmann 1986) : au-delà d'un seuil de
  vitesse angulaire, l'image spatiale devient floue. La **vitesse angulaire
  perçue** (pas métrique) est le paramètre cardinal : un move à 8 m/s est
  illisible à 2 m, fluide à 15 m → métrique « legibility » implémentable.
- **Looming asymmetry** (Neuhoff 2001 ; Bach, Neuhoff et al. 2009) : l'approche
  est systématiquement surestimée (sous-estimation du temps de contact de
  15–40 %) avec réponse affective mesurable (GSR). Le **loom** est le seul
  geste spatial à signature émotionnelle prouvée — sous-exploité partout.
- **Vection** (Riecke et al.) : la rotation cohérente du champ entier induit
  l'auto-mouvement ; seuil de tolérance ~10–15 s. Puissant, à doser.
- **Distance perception** (Zahorik, Brungart & Bronkhorst 2005 ; Klatzky et
  al.) : compression systématique (~×0.7). Pour un recul perçu de 10 m, il
  faut ~14 m de trajet → *distance exaggeration factor* comme paramètre —
  absent de tous les outils commerciaux.
- **Front-back confusions** (Wightman & Kistler 1989) : résolues par
  micro-mouvements de tête ou asymétries spectrales/d'élévation. Les trajets
  front-back parfaitement symétriques sur le plan médian sont fragiles.
- **Multi-indicialité de la distance** (Begault 1991 ; DRR direct/réverbéré) :
  intensité + spectre + DRR + parallaxe de mouvement — la position seule est
  un indice faible → couplage position→reverb/send/absorption nécessaire.
- **Spatiomorphology** (Smalley 1986–2007) : source bonding, spatial texture,
  **gestural surrogacy** (remote/1er/2e/3e ordre). Le mouvement spatial en
  diffusion acousmatique *est* la structure formelle — le cadre théorique le
  plus profond du domaine.
- **Stream segregation** (Bregman 1990) : la continuité spatio-temporelle
  préserve l'identité de l'objet auditif ; les sauts la cassent. Le mécanisme
  `anchor:current`/`end:hold` de STAGESPACE est littéralement l'implémentation
  de Bregman — la continuité d'objet rendue opérationnelle.
- **Change blindness / attention** (Mack & Rock 1998) : un seul mouvement
  saillant est perçu — la règle « un seul objet bouge à la fois » est
  perceptuellement fondée.

### 1.2 Composition / dramaturgie spatiale

- **Kendall (2010)** : la spatialisation comme outil compositionnel —
  taxonomie des gestes (orbiter, approcher, disperser, converger).
- **Peters, Schacher (spatDIF, 2013)** : la trajectoire comme geste musical —
  une phrase avec accent/phrasing, pas un automate.
- **Vande Gorne** (espace du son, diffusion acousmatique) : la *partition de
  diffusion* — la conduite spatiale se note comme une partition.
- Stockhausen (Gruppen, Kontakte), Boulez (Répons) : le contrepoint spatial =
  rythmes trajectoires indépendants ; l'élévation comme registre.

---

## 2. État de l'art — benchmarks

| Outil | Force | Ce que STAGESPACE en tire |
|---|---|---|
| **L-ISA** (L-Acoustics) | pan/width/elevation/distance par objet, snapshots DeskLink | object_channels ✓ ; distance-coupling à expliciter |
| **d&b Soundscape** | En-Scene positions + En-Space reverb couplée | zones ✓ ; position→send via signal graph |
| **TiMax SoundHub** | image definition par cue, PanSpace multi-touch, Tracker UWB | cues ✓ ; le park = protection image |
| **SPAT Revolution** (Flux) | source→room→master, prelisten binaural, multi-renderer | positions-only = compatible ; bounce à faire |
| **Spacemap Go** (Meyer) | spacemaps = proximity-weights entre enceintes | zones ✓ |
| **Holophonix** (Amadeus) | trajectoires embarquées + hardware | ancêtre direct — on dépasse (graphe compilé) |
| **4DSOUND/MONOM** | spatial dynamics, "instrument" | compression d'énergie spatiale — à faire |
| **Zactrack/BlackTrax** | tracking PSN/RTTrP | **protocole manquant** |
| **dearVR SPATIAL CONNECT** | positionnement VR+gestes | concept : dessin dans l'espace |
| **Sound Particles** | champs particules + physique | swarm ✓ proche |
| **Klang** | monitoring 3D IEM | monitoring spatial (pas juste rendu) |
| **Panoramix, Compass/SPARTA** | recherche libre (IRCAM, Aalto) | références implémentation |
| **Zirkonium, TOSC, spatDIF** | ancêtres éditeurs spatiaux | historique |

---

## 3. Les quatre conduites (`docs/conduites/`)

| Doc | Genre | Ce qu'elle exige |
|---|---|---|
| **A — ORBE** | Acousmatique, œuvre fixée | cue list + partition, gestes notés, park, canon, loom |
| **B — GRID** | DJ spatialisé | busking, solo, chaînage hold/anchor, TC, panic, soundcheck |
| **C — SILLAGE** | Théâtre dansé | follow-me PSN, tracking cues, park protecteur, dry-run |
| **D — TRAVERSE** | Multimédia 75' | vidéo TC maître, live parkés, generatif+cues+busking, media sync |

Couverture complète du domaine : composition (A), performance (B),
scénographie vivante (C), multimédia (D).

---

## 4. Audit capacité — moteur vs conduites

**Jouable intégralement : A** (ORBE).
**Jouable ~85 % : B, C, D** — deux trous fonctionnels :

| Gap | Bloque | Effort |
|---|---|---|
| **`anchor:follow`** — ancre qui suit la cible (orbit autour du mobile) | C, D | moyen — lire `last_position` par frame |
| **PSN/RTTrP ingest** — protocole industrie | C, D | moyen |
| Soundcheck walk | B | trivial |
| Media sync out (cue→trigger) | D | moyen |
| Confidence view / legibility meter | toutes | petit–moyen |
| Vection gesture | B | petit |

**Verdict capacité** : le moteur tient les 4 conduites. Le graphe compilé
`f(t)` + `anchor`/`hold` = continuité d'objet implémentée — en avance sur
l'état de l'art.

---

## 5. Audit ergonomie — l'opérateur dans la conduite

L'audit fonctionnel ne suffit pas : **la question est ce que l'opérateur
peut faire voir/faire en show.**

### Par conduite

**A (diffusion)** : cue/current visible ✓ ; manque **audition avant émission**
(voir la cue suivante sans la jouer), **vue radar 2D fixe** (le 3D manipulable
n'est pas un outil de conduite), **marquage park** par objet.

**B (busking)** : slots jouables ~ ; manque **surface de jeu** (grille de
pads lisible à distance, états couleur playing/fading/solo'd), **indicateur
position manuelle** (« vous tenez cet objet »).

**C (théâtre)** : manque **source-de-contrôle par objet** (move/manuel/PSN/
park/hold — *pourquoi cet objet est là*, LE manque majeur), **santé PSN**
(age de la dernière trame — un flux coupé fige silencieusement), **diff de
scope** (ce que la tracking cue va écrire vs protéger).

**D (multimédia)** : manque **dashboard unique** (transport+pads+cues+santé
sur UN écran — aujourd'hui dispersé), **TC lock visible**, **log
opérationnel** (qui a GO quand, quel NACK).

### Les 5 manques transverses

1. **Source-de-contrôle par objet** — pourquoi il est là (move/manuel/PSN/
   park/hold) — badge couleur par objet. *La question que chaque opérateur
   pose 100 fois par show.*
2. **Vue radar 2D fixe** — plan fixe lisible vs 3D manipulable.
3. **Santé des flux** — PSN/TC/OSC : age dernière trame, lock, error rate —
   bandeau d'état, pas des toasts.
4. **Audition avant émission** — preview de cue (pas juste de move).
5. **Surface de jeu dédiée** — Conduite window = début ; pads/holds/solos
   conçus pour être *joués*, pas administrés.

**Verdict ergonomie** : le moteur tient les conduites ; l'**expérience
opérateur** ne les tient pas. On a la piste — pas encore la tour.

---

## 6. Gaps consolidés + roadmap

**Moteur (capacité)** — ordre :
1. `anchor:follow` (orbit dynamique — débloque C/D)
2. PSN/RTTrP ingest (tracking industrie)
3. Soundcheck walk, media sync out, vection gesture, confidence view

**Métier (outillage)** :
4. Legibility/looming/vection meters (vu-mètre perceptuel)
5. Distance reality layer (Zahorik ×1.4)
6. Auto-venue adaptation (même conduite, salles différentes — *le
   différenciateur absent du marché*)
7. Diffusion score view, trajectory library (Peters taxonomy), rehearsal
   capture, binaural bounce

**Ergonomie (la tour)** :
8. Source-de-contrôle par objet (le manque n°1)
9. Vue radar 2D, santé des flux, audition cue, surface de jeu

---

## 7. Bibliographie

**Perception spatiale**
- Harris, J.D. & Sergeant, R.L. (1971). "Monaural/binaural minimum audible
  angles for a moving sound source." *J. Speech Hearing Res.*
- Perrey, S. & Nobbe, S. (2001). "Minimum audible angle revisited." *JASA*.
- Rakerd, B. & Hartmann, W.M. (1986). "Localization of sound in rooms, II."
  *JASA*.
- Neuhoff, J.G. (2001). "Adaptive listener bias in auditory motion
  perception." *Nature*.
- Bach, D.R. et al. (2009). "Looming sounds as warning signals." *PNAS*.
- Zahorik, P., Brungart, D.S. & Bronkhorst, A.W. (2005). "Auditory distance
  perception in humans." *JASA*.
- Wightman, F.L. & Kistler, D.J. (1989). "Headphone simulation of free-field
  listening." *JASA*.
- Begault, D.R. (1991). "Preferred sound source increase in reverberant
  environments." *JAES*.
- Riecke, B.E. et al. — studies on auditory vection / self-motion.
- Blauert, J. (1997). *Spatial Hearing*. MIT Press.

**Théorie compositionnelle**
- Bregman, A.S. (1990). *Auditory Scene Analysis*. MIT Press.
- Smalley, D. (1986–2007). "Spectromorphology and spatiomorphology."
  *Organised Sound*.
- Kendall, G.S. (2010). "Spatialization as a compositional tool."
  *Organised Sound*.
- Peters, N. & Schacher, J. (2013). "SpatDIF — Spatial Sound Description
  Interchange Format." *ICMC*.
- Vande Gorne, A. — écrits sur l'espace du son / diffusion acousmatique.
- Truax, B. (2001). *Acoustic Communication*. Ablex.

**Outils / systèmes**
- Pulkki, V. (1997). "Virtual sound source positioning using VBAP." *JAES*.
- SPAT (Jot, IRCAM) · spatDIF · Zirkonium (Hannover WFS) · TOSC · MNTN ·
  OpenMixer · Compass/SPARTA (McCormack, Politis — Aalto) · Panoramix.
- L-ISA (L-Acoustics) · d&b Soundscape En-Scene/En-Space · TiMax SoundHub +
  Tracker · Meyer Spacemap Go · SPAT Revolution (Flux) · Holophonix
  (Amadeus) · 4DSOUND/MONOM · Sound Particles · dearVR SPATIAL CONNECT ·
  Klang:technologies · Usomo (Fraunhofer) · Sonic Emotion · Yamaha AFC.
- **PSN/RTTrP** — PosiStageNet : protocole industrie de tracking
  (BlackTrax, Zactrack, Follow-Me, StagePrecision).
- MPEG-H · ADM/S-ADM — object-based audio standards.
