# État de l'art — Trajectoires spatiales, effets et interfaces pour l'audio immersif en live

Document de recherche consolidé — analyse du paysage logiciel, de la littérature
académique (HAL, NIME, ICMC, DAFx, JAES, JIM) et positionnement stratégique de
STAGESPACE. Version approfondie.

---

## PARTIE I — Génération de trajectoires spatiales

### 1.1 Cartographie : quatre familles d'outils

```
FAMILLE A : RENDERERS (spatialisation + audio natif)
  Holophonix, SPAT Revolution, L-ISA, d&b Soundscape DS100,
  SpatGRIS, Sound Trajectory, Panoramix, Zirkonium, SSR, ViMiC,
  TiMax SoundHub/panLab, FletcherMachine (Adamson),
  Yamaha AFC Image, 4DSOUND, Meyer Spacemap Go, Klang
  → rendu audio ET interface de positionnement
  → convergence 2024-25 : tous intègrent un "trajectory engine"

FAMILLE B : SÉQUENCEURS/AUTEURS de trajectoires (pas d'audio)
  IanniX, ossia score, ControlGRIS, Grapes 3D,
  ToscA/OSCAR, Trajectory Score Library, Wwise Automation
  → positions/OSC vers un moteur externe

FAMILLE C : MOTEURS GÉNÉRATIFS / AGENTS AUTONOMES
  Egregore (chdh), champs vectoriels Carpentier/Gerzso (IRCAM),
  PolyNodes (sonicLAB), Spatbox, L-ISA FX Engine, ImmLib,
  ambicontrol (ICST/Schacher)
  → mouvements émergents plutôt que trajectoires dessinées

FAMILLE D : ÉCOSYSTÈMES D'INTEROPÉRABILITÉ
  ADM-OSC, OSCQuery, SpatDIF, PosiStageNet, RTTrPM (BlackTrax),
  En-Bridge, Chataigne, libmapper, Open Stage Control
  → ponts, standards, normalisation éditeurs ↔ renderers
```

### 1.2 Famille A — Renderers avec mouvement intégré

| Outil | Trajectoires | Génératif | Live | Limite pour STAGESPACE |
|-------|--------------|-----------|------|------------------------|
| SPAT Revolution | LFOs + trajectoires dessinées, absolu/relatif, ping-pong | Non | Référence | Moteur d'animation fermé, pas de graphe nodal |
| L-ISA Controller | Snapshots + FX Engine (3.0) réactif | Oui (récent) | Broadcast-grade | Propriétaire, lié au hardware |
| Holophonix | Motion Engine : linear + génératif + boids | En dév. | Oui | Trajectoires simples, pas de composition nodale |
| Sound Trajectory (TripinLab) | Chemins dessinés 3D + sampler + listener mobile | Non | Studio+live | Ambisonic only. Code v2 publié GPL (hal-04950075) |
| SpatGRIS + ControlGRIS | Trajectoires via plugin DAW | Partiel (audio-réactif v4) | Oui | Préréglages fixes |
| Sound Particles | Particle systems | Oui (physique) | Post-prod | Pas temps réel live |
| Panoramix (IRCAM/STMS) | Post-prod workstation | Non | Non | Post-production |
| Zirkonium (ZKM) | Événements mathématiques + timeline | Partiel | Oui | macOS only |
| SSR | WFS/HOA/binaural, scènes temps réel | Non | Oui | Rendu, pas d'auteur de mouvement |
| **ViMiC** (CIRMMT/RPI) | **Microphones virtuels** dans une salle virtuelle | Non | Oui | Paradigme inversé — voir §1.6 |
| **TiMax SoundHub/panLab** | Dynamic delay-matrix + trajectoires dessinées + Tracker | Partiel | Référence théâtre | Matrice propriétaire, pas de graphe |
| **FletcherMachine** (Adamson) | Trajectory engine intégré + reverb ×3 + binaural | Partiel | Oui (1.3 ms, 128×128) | Hardware dédié, traj. par objet non composables |
| **Yamaha AFC Image** | 128 objets, zones HP (×32), reverb 3D, tracking | Partiel | Oui | Écosystème Yamaha (RIVAGE/CL/QL) |
| **4DSOUND** | Objets dimensionnels (taille/forme/comportement), particules, script Python | Oui | Oui (installations) | Système+venue liés, pas de standard ouvert |
| **Meyer Spacemap Go** | Maps spatiales nodales sur Galaxy | Partiel | Oui | Lié hardware Meyer |
| **Klang** | In-ear monitoring immersif | Non | Oui | Binaural IEM, pas trajectoires |

**Points clés de la passe 2** :

- **TiMax** (Out Board, UK) est le renderer-show-control de référence en
  théâtre : sa *dynamic delay-matrix* spatialise par délais (pas par gains),
  la localisation survit hors sweet spot ; **TrackerD4** (UWB AoA+TDoA)
  sort en OSC, PosiStageNet, sACN/Art-Net (via Stage Precision) → pont
  natif vers SoundHub, Soundscape, L-ISA, GrandMA, disguise, ETC Eos.
  **TiMax TimeLine** orchestre cues MIDI/MTC/Follow-On/XML-UDP + OSC
  bidirectionnel vers QLab, SSL, Grapes, panLab. Et signal fort 2025 :
  **TiMax MCP** — premier renderer spatial avec intégration Model Context
  Protocol (AI assistant). L'interopérabilité show-control est leur ADN.
- **FletcherMachine** (Adamson) : moteur objet amplitude+time localization,
  jusqu'à 3 moteurs de reverb autonomes, **trajectory engine intégré**,
  contrôle console/DAW/VST, ADM-OSC natif + MIDI/OSC/PSN/RTTrPM, hiérarchie
  leader/follower multi-remote, binaural head-tracked. La convergence
  renderer ↔ tracking ↔ show-control est déjà là.
- **Yamaha AFC Image** : 128 objets, **speaker zoning** (32 zones) — un
  objet peut être restreint à un sous-ensemble de HP ; conversion
  automatique des mouvements DAW vers le layout réel ; contrôle depuis les
  consoles RIVAGE/CL/QL ; tracking d'objets. **AFC Enhance** : la salle
  elle-même comme effet (voir §2.9).
- **4DSOUND** (Amsterdam/Berlin) : le plus radical — la source n'est pas un
  point mais un **objet dimensionnel** (taille, forme, comportement) ;
  "sound holograms" via 20+ formes algorithmiques à particules, scripting
  Python, layouts asymétriques arbitraires, framework NAP. Conceptualise
  ce que notre `formation`/`spread` effleure : la *dimension* de la source
  comme paramètre de composition.
- **Spacemap Go** (Meyer/Galaxy) : panning nodal par "maps" spatiales
  sur iPad — preuve que le paradigme nodal est adopté en produit pro,
  mais toujours enfermé dans un écosystème hardware.

### 1.3 Famille B — Séquenceurs de trajectoires

| Outil | Paradigme | Limite |
|-------|-----------|--------|
| IanniX | Score poly-temporel : cursors + curves + triggers, B-splines | Pas de traitement du signal, pas d'agents |
| ossia score | Timeline interactive + nodal, Path generator | Généraliste |
| Grapes 3D | Matrice de clips (8×8) × 64 tracks | Pas de génératif, pas de graphe |
| ControlGRIS | Plugin DAW, préréglages | Pas de composition |
| **ToscA/OSCAR** (IRCAM, Carpentier) | Plugin DAW : 32 params automatisables → OSC | Canal de transport, pas de moteur |
| **Trajectory Score Library** (Babouri, Antescofo) | Fonctions paramétriques → courbes → Spat5/SpatGRIS | Langage synchrone, courbe d'apprentissage |
| **Wwise 3D Position Automation** | Animation paths, emitter/automation/listener, ShareSets | Fermé, orienté jeu vidéo |
| **ambicontrol** (ICST) | Behaviors + trajectoires breakpoints XML + chaînes logiques | Objet Max interne ICST |

**Point clé** : ToscA résout le problème historique — les DAW ont des timelines
mais un multicanal faible ; Max/Pd spatialisent mais n'ont pas de timeline.
C'est exactement le gap que comble aussi STAGESPACE : ni DAW ni patcher, un
moteur de mouvement dédié.

### 1.4 Famille C — Génératif : les modèles formels

**La taxonomie mathématique des moteurs de trajectoire** (synthèse de la
littérature) :

1. **Paramétriques** : chaque coordonnée = fonction du temps (LFOs). Spatbox,
   TSL/Antescofo, nos engines orbitaux. Prévisible, contrôlable, ennuyeux à
   l'usage prolongé.
2. **Chemin parcouru** : courbe dessinée + loi de vitesse. IanniX (B-splines),
   DrawSpline, ambicontrol (breakpoints XML), Wwise (animation paths). Expressif
   mais figé.
3. **Agent-based** : règles locales → mouvement émergent. Steering (seek/flee/
   arrive/wander/pursuit/path-following/obstacle-avoidance), boids (séparation/
   alignement/cohésion — Reynolds 1987), vector fields (Carpentier/Gerzso).
   Perpétuel, organique, jamais répétitif.
4. **Hiérarchique vs émergent** — Schacher (NIME 2007, "Gesture Control of
   Sounds in 3D Space") : LA formalisation de référence. Les sources ont des
   propriétés d'objets physiques ; le mouvement se manipule par transforms
   géométriques standard (rotation, translation, scaling) appliquées via des
   relations **hiérarchiques** (arbre : un parent entraîne ses enfants —
   notre `BarycentricGroup`/formations) ou **émergentes** (comportements
   locaux qui produisent une organisation globale — notre `swarm`/merge).
5. **Parameter fields** (ImmLib, Negrão) : patterns spatiaux contrôlés par des
   fonctions mathématiques définies sur une surface — sources élargies/diffuses
   par décorrélation de copies. Équivalent audio de nos Falloffs.
6. **Score poly-temporel** (IanniX) : temps, espace et vitesse de curseur sont
   des dimensions indépendantes — un même chemin peut être parcouru à plusieurs
   vitesses simultanées par des curseurs différents.

### 1.5 Antérieurs directs nouvellement identifiés

- **ToscA → OSCAR** (IRCAM) : pont automation↔OSC, modèle pour nos canaux de
  contrôle étendus (32 params exposés, mapping file XML, bundles, polling rate).
- **Trajectory Score Library** : fonctions paramétriques en langage synchrone
  (Antescofo) → synchronisation des trajectoires aux événements musicaux. Le
  concept "trajectoire synchronisée au tempo/événement" — notre BPM-reactor est
  plus simple mais moins précis.
- **ambicontrol** (ICST) : behaviors (rotation, translation, random walk borné)
  + trajectoires breakpoint + **chaînes logiques de modules** — l'ancêtre
  direct de la composition nodale de mouvement.
- **ViMiC** (Braasch/Peters/McAdams, JAES 2005, CMJ 2008) : **paradigme
  inversé** — au lieu de bouger les sources, on déplace des microphones
  virtuels dans une salle virtuelle ; simule techniques microphoniques
  coïncidentes/spacées. → node `VirtualMic` ? La position de l'écoute comme
  objet de composition.
- **ImmLib** (Negrão, SuperCollider) : parameter fields — pattern spatial =
  fonction sur surface ; décorrélation → sources élargies. Modèle pour des
  Falloffs audio-domain.
- **abclib** (Bonardi, CICM Paris 8) : bibliothèque Faust — générateurs de
  trajectoires + processus spatiaux (décorrélateurs, delays, granulateurs,
  ring-mod) en modes syn/fx. 20 ans de recherche musique mixte.

### 1.6 Psychoacoustique du mouvement — le chaînon manquant

C'est la partie la plus importante pour le design des moteurs :

- **MAMA** (Minimum Audible Movement Angle, Perrott & Musicant 1977,
  Perrott & Tucker 1988) : 8.3° à 90°/s → 21.2° à 360°/s. La résolution
  spatiale dynamique **chute avec la vélocité**.
- **Seuil de pertinence** : sous ~32°/s, peu de dégradation ; au-delà, le
  mouvement devient flou. Un mouvement fin à 200°/s est imperceptible.
- **Onset displacement** : l'apparition d'une source en mouvement est perçue
  **déplacée dans la direction du mouvement**, proportionnellement à la
  vélocité — le son arrive "devant" où il est. Les attaques de trajectoires
  ont un biais directionnel systématique.
- **Fréquence** : résolution dynamique mauvaise entre 1300-2000 Hz, meilleure
  sous 1000 Hz (comme la localisation statique).
- **Borne CNMAT** (OSC best practices) : le taux de contrôle utile d'un effet
  spatial est **0-50 Hz**. Au-delà de ~10 Hz, une directivité rotative cesse
  d'être perçue comme rotative — **fusion perceptive** en timbre (c'est la
  fondation psychoacoustique de la SMS, §2.4.F).
- **Self-motion** : l'auditoire détecte mieux le mouvement de sa propre tête
  que celui des sources (Brimijoin 2014) — argument pour le tracking listener.

**Implications directes pour STAGESPACE** :
1. Les trajectoires rapides sont perceptivement **floues**, pas précises —
   les orbites SMS exploitent ça comme feature.
2. Le 60 FPS de notre runtime dépasse largement la résolution perceptive ;
   c'est le réseau/renderer qui borne, pas l'oreille.
3. Nodes `PerceptualVelocity` : convertir vitesse spatiale en °/s autour du
   listener pour rester dans la bande perceptible utile.
4. La compensation d'onset-displacement pourrait être un node (avancer la
   phase spatiale d'une attaque).

### 1.7 La tradition de diffusion acousmatique — contexte culturel

La France a une tradition de **performance spatiale live** antérieure à tout
ce qui précède :

- **Acousmonium** (Bayle, GRM, 1974) : 60-80 haut-parleurs différenciés +
  console de diffusion. La **diffusion** = interprétation live : le
  "projectionniste" route/équilibre le média fixé sur l'orchestre de HP.
  "A successful concert depends on the risks taken live."
- **Tutschku** : débat interprétation vs reproduction — former des
  **interprètes spécialisés**, pas juste des opérateurs.
- **"Fractured acousmatic"** (method for diffusion) : compositions fixées +
  structures de performance flexibles → liberté d'interprétation.
- **Stansbie** (ontologie) : la performance acousmatique comme entreprise
  agent-centrée et intentionnelle.
- **Landy / Intention-Réception** (zenodo.18898493) : les auditeurs
  perçoivent la spatialisation **relativement au contenu sonore et à la
  dramaturgie** — le mouvement spatial doit servir une narration, pas exister
  pour lui-même.
- **ESPRO** (IRCAM) : salle à acoustique variable (périactes, RT 0.4-4s) +
  264 HP WFS + 75 HP HOA. Objectif originel de Spat (1993) : "manipulable
  **sans connaissance de la technologie** avec un nombre illimité de HP"
  (Warusfel) — le design goal fondateur, valable pour nous.

**Lecture** : STAGESPACE s'inscrit dans cette filiation — c'est une **console
de diffusion générative** : là où le projectionniste jouait des faders sur un
média fixé, l'opérateur STAGESPACE joue des graphes de mouvement. La cuelist
+ panic + keyboard = le cockpit du projectionniste moderne.

### 1.8 Différenciation de STAGESPACE

Ce que personne d'autre ne fait :
1. **Graphe nodal compilé en f(t) continue** (Lithe l'a prouvé, aucun produit)
2. **Post-process global sur le merge** ("master bus spatial" génératif)
3. **Multi-mouvements parallèles + merge strategies**
4. **Macros spatiales hiérarchiques**
5. **Audio-reactor natif Rust**
6. **Middleware multi-profil** (Holophonix, IEM, IRCAM Spat, ADM-OSC, génériques)
7. **Cue list atomique + keyboard + panic** (cockpit régisseur)

### 1.9 Ce que le renderer fait de nos positions — algorithmes de panning

Notre sortie (xyz/aed + canaux) est interprétée par des algorithmes de
rendu très différents — comprendre leurs propriétés conditionne ce qu'on
envoie :

- **VBAP** (Pulkki 1997) : panning par paires/triplets de HP. Standard
  industriel (MPEG-H). Limite connue : sauts de gain au passage des arêtes
  de triplets → un cercle continu produit des micro-sauts perceptibles ;
  le spread perçu fluctue pendant le mouvement. → Nos trajectoires
  rapides amplifient ce défaut.
- **MDAP** : VBAP + sources fantômes multiples → spread variable continu.
- **DBAP** (Lossius, ICMC 2009 — moteur de **SpatGRIS**) : distances aux
  HP, **aucun sweet spot**, layouts irréguliers/arbitraires. C'est
  l'algorithme de la diffusion acousmatique moderne — adapté aux setups
  non-canoniques où vit l'utilisateur.
- **AllRAP / Ambisonics Equivalent Panning** : loudness stable + largeur
  réglable — proche du "spread" ambisonique.
- **Delay-matrix** (TiMax) : localisation par **temps** plutôt que gains —
  plus robuste pour tout l'auditoire, mais dépendant de la matrice
  calibrée.
- **WFS / HOA / binaural** : synthèse de champ complet / harmoniques
  sphériques / HRTF — les paramètres spatiaux n'ont pas la même
  sémantique (W = pression, coefficients ACN vs position objet).

**Conséquence** : la sémantique de nos canaux étendus (`spread`,
`distance`, `aperture`) n'est **pas universelle** — chaque renderer la
traduit dans son modèle. La matrice de capacités par profil (P1) doit
documenter cette traduction, pas seulement l'adresse OSC.

---

## PARTIE II — Effets audio live en environnements spatiaux

### 2.1 Le déplacement conceptuel

```
PARADIGME 1 : l'effet traite le SIGNAL          (delay sur la piste)
PARADIGME 2 : l'effet est attaché à la SOURCE   (le son "porte" sa reverb)
PARADIGME 3 : l'effet habite l'ESPACE           (la zone réverbère ce qui la traverse)
PARADIGME 4 : l'effet EST le mouvement          (la trajectoire produit le timbre)
```

### 2.2 A. Effets "gratuits" du mouvement (Chowning 1971)

Cues angulaires (panning), distance (direct/réverb + absorption air), vélocité
(Doppler). Dodge (eContact 10.3) : le Doppler comme détuneur — bug ou feature,
paramètre de composition. Implémentations : IEM RoomEncoder, dearVR PRO 2,
Steilacoom (DXARTS).

### 2.3 B. Facteurs perceptuels (IRCAM Spat, Jot & Warusfel 1995)

Presence, brillance, room presence, early width, ASW, radiation (directivité,
orientation, aperture). Tous en OSC sur SPAT Revolution → canaux de contrôle
exploitables par le graphe. Le modèle perceptuel = vecteur de params DSP.

### 2.4 C-F. Transformations de champ, SFFX, granulaire, SMS

- **Transforms ambisoniques** (ambix, ATK, Zotter & Frank) : rotation, miroir,
  dominance, focus/push, directivity, warp — sur le champ entier.
- **SFFX** : FOAFX (RISD), Sluicer (NIME 2024 — effets verrouillés à des
  coordonnées, le son traversant la zone est transformé), Beamix (secteurs
  beamformés + chaînes FX), IEM DirectionalCompressor, COMPASS sidechain.
- **Granulaire spatial** : GRM SpaceGrain, IEM GranularEncoder, spatial grains,
  Faust granulator (hal-04849708).
- **SMS** (Cadambi, ICMC 2015) : orbites >20 Hz → FM/AM/granulation par fusion
  perceptive. **La borne CNMAT 0-50 Hz la fonde scientifiquement** : au-delà
  de la fusion, la modulation spatiale devient timbre — c'est précisément ce
  que la SMS exploite comme effet.
- **Paramétrique** (McCormack, COMPASS) : décomposition multi-source+ambiant →
  warping directionnel, listener translation, source tracking, spatial
  sidechain. compass_sidechain = une scène modifiée par l'analyse d'une autre.

### 2.5 Effets distribués et salle-instrument

Spatial delay/feedback/looping/compression (thèse UCSB), Auxtrument (chambres
réelles distantes en réseau), CAVIAR (IRs artificielles live, CCRMA 2025),
Performing Performance Spaces (NIME 2026), L-ISA Room Engine, En-Space,
interpolation Spat entre salles.

### 2.6 Engineering temporel — la couche fiabilité

- **OSC timetags** (Freed) : 64-bit NTP, atténuation de jitter, relativistic
  clocks pour réseaux ad-hoc sans master NTP.
- **Simple Sync OSC** (CNMAT 2015) : master/slave → 166µs WiFi, 100µs Ethernet,
  localisation acoustique 1.8mm stddev.
- **AES11** : sync inter-canaux ±5% par échantillon — les artefacts de phase
  dans les arrays sont un vrai problème.
- **µOSC** : jitter millimétrique dégradant les flux capteurs.
- **NetMusic3D** : compensation de clock drift, <5ms latence logicielle.
- **Bande passante gestuelle** : ~68 bits/sec d'information temporelle pour un
  geste humain — nos flux de données sont surdimensionnés perceptuellement.

**Implications** : positions à 60 Hz OK ; les shows multi-apps veulent une
horloge commune (timetags ou Ableton Link) ; monitoring du jitter utile en
perf-stats.

### 2.7 Extensions concrètes pour STAGESPACE

1. **Canaux de contrôle étendus** : spread/distance/gain/presence/lfe —
   position + N paramètres par objet (modèle ToscA).
2. **Node `Zone`/`FieldGate`** : volumes 3D → trigger/rampe/gradient → params
   OSC. Le SFFX côté contrôle.
3. **Nodes cinématiques** : Velocity/Acceleration/Jerk → modulateurs.
4. **Node `Proximity`** : distances inter-objets → couplage, ducking.
5. **Mode SMS** sur orbites + rate limiting adaptatif.
6. **Node `VirtualMic`** (ViMiC) : composer la position de l'écoute.
7. **OSC timetags / Ableton Link** pour sync multi-app.

### 2.8 Positionnement : orchestrateur d'effets spatiaux

STAGESPACE = **compositeur/orchestrateur d'effets spatiaux** : les renderers
sont les instruments, le graphe nodal est la partition qui dit quand, où et
comment transformer le son dans l'espace et le temps.

### 2.9 Acoustique active — la salle elle-même comme paramètre

La "salle-instrument" (§2.5) a une filiation industrielle mûre — les
systèmes d'**acoustique active** contrôlent la réverbération réelle du
lieu par réseaux micros→DSP→HP :

- **Meyer Constellation** (sur moteur NADIA) : contrôle du temps de
  réverbération, des réflexions précoces, du "volume cubique effectif" —
  presets par scène, régénératif + in-line hybride.
- **Müller-BBM VIVACE** : scénarios acoustiques rappelables
  (symphonique/opéra/parole), micros en scène et salle.
- **CSTB Carmen** : "mur virtuel actif" — approche physique française,
  plusieurs salles équipées.
- **Yamaha AFC Enhance** : approche régénérative (boucle feedback
  contrôlé) OU in-line (convolution) ; peut appliquer l'ambiance aux sons
  du public en temps réel.
- **d&b En-Space**, **LARES** (ancêtre), **L-ISA Room Engine** : salles
  convolutives pilotables par automation.

**Conséquence pour STAGESPACE** : dans un lieu équipé d'acoustique active,
"la salle" est un paramètre de cue au même titre que les positions. Un
node `Room` (sélection de scénario acoustique par cue/zone) s'intègre
naturellement — l'orchestrateur d'effets étendu au bâtiment.

### 2.10 Le marché des plugins "mouvement réactif" — validation commerciale

Sound Particles a packagé le paradigme **audio→position** en plugins VST —
preuve de marché pour notre audio-reactor :

- **Energy Panner** : intensité → position (pan ou sliding mode).
- **Brightness Panner** : spectre/pitch/MIDI → trajectoire 3D définie.
- **Beat Panner** : séquenceur de panning **sync tempo**.
- **Space Controller Studio** : le smartphone comme pointeur 3D → DAW.
- **Doppler** / **Air** : émulation physique distance/atmosphère de
  référence (moteur Sound Particles).
- **inDelay**, **Density**, **GrainDust** : FX spatiaux granulaires.
- **E4L (Envelop for Live)** : toolkit M4L open-source ambisonic —
  encodeurs + décodeur custom + AuraVerb + **ADM-OSC out** + lien
  EnvelopLX (lumière LED synchronisée au son spatial !).

**Lecture** : le réactif est validé commercialement mais verrouillé dans
des plugins mono-format. STAGESPACE fait la même chose **entre** DAW et
renderers, en OSC, sans toucher l'audio — avec le graphe comme langage de
réaction au lieu de presets.

---

## PARTIE III — Interfaces homme-machine (HCI)

### 3.1 Le modèle formel du contrôle gestuel spatial

**Schacher (NIME 2007)** est la référence : mapping geste→mouvement par
propriétés d'objets physiques + transforms géométriques + relations
hiérarchiques/émergentes. Chaîne : device → préconditionnement/normalisation
(namespace OSC) → analyse (dimensionnalité) → mapping → behaviors → sortie.

**Marshall et al. (ICMC 2006)** : GDIF, spatialisation par les performeurs
eux-mêmes. **Bukvic** : NISME — intuitif/naturel + scalable/adaptable.
**Quiroz** : isotonique/isométrique/élastique.

### 3.2 libmapper — l'infrastructure de mapping de référence

IDMIL (Sinclair, Malloch, Wanderley) : réseau décentralisé de signaux I/O,
mappings dynamiques avec **expressions mathématiques de conditionnement**
(scaling, dérivées, intégration, filtrage, smoothing), traduction
adresse/datatype, Webmapper pour visualisation. MapLooper : looping de
mappings, 4.81ms round-trip @100Hz. **Modèle direct pour notre OSC IN
mapping** : pas des adresses fixes, des expressions composables.

### 3.3 La recherche d'interfaces

- **xrOSC** (NIME 2024) : Quest 3, isotonique 6DoF absolu → backend OSC.
- **AudioMiXR** (ACM 2025) : Vision Pro, n=27 → SUS ↑, NASA-TLX ↓, créativité ↑
  vs panner 2D.
- **ARMixer** : métaphore de scène AR, mixage par les musiciens.
- **Invoke** (CHI 2023) : sketching vocal de trajectoires, collaboratif.
- **Beyond Faders** (2025) : écologies gestuelles 6DoF, validité écologique.
- **Gesture-based Atmos** (NIME 2025) : Leap Motion → Atmos Panner.
- **6DOFpanner** (Quiroz) : Leap+SpaceMouse→MIDI, **clutching** obligatoire.
- **spAAce** : dessin de trajectoires → WFSCollider.
- **Gelineck & Serafin** (AM'15) : haptique (Falcon) > Leap Motion, sans
  retour visuel ; guidage haptique actif rejeté.
- **Metabow** (NIME 2025) : archet IMU, mapping hybride direct+ML.
- **Parametric speakers** (NIME 2025) : le corps comme moteur de trajectoire.

### 3.4 La console de diffusion comme modèle HCI historique

L'Acousmonium est le **plus ancien modèle HCI de spatialisation live** :
console centralisée, faders par haut-parleur/groupe, le projectionniste
"joue" l'espace. Leçons : contrôle direct par canal/groupe, geste macro
(large, enveloppe), interprétation gestuelle sur matériau fixé. Le cockpit
STAGESPACE = son héritier nodal.

### 3.5 L'écosystème dewiweb — le cockpit de régie

69 repos = un **régisseur-constructeur** qui assemble un cockpit :

```
CONTRÔLE PHYSIQUE → OSC          BRIDGES              INFRA PRO AV
  spacemouse-osc (16★, 6DoF)       MCxOSC/MCxOSCnext    AES67 driver+visualizer
  X-Touch module                   emberplus_rust       audio-accessibility
  open-stage-control               sofie-emberplus      dewicom (intercom)
  companion-module-* (StreamDeck)  NodeOSC (Blender)    rpi-media-kiosk
  XCTL_ (doc Behringer)                                clock_X_overlay

TRAJECTOIRES → STAGESPACE
  chataigne_spatiale → holophonix-chataigne → holophonix-animator
  → trajectoires-modern → nodes-trajectories → STAGESPACE
  (corpus animation_nodes : compilation graphe→natif, Falloffs)
```

**STAGESPACE = le moteur de mouvement au centre de ce cockpit existant.**
L'interface naturelle n'est pas une nouvelle UI — c'est OSC IN/OUT branché
sur SpaceMouse + X-Touch + StreamDeck + Chataigne déjà maîtrisés.

### 3.6 Enseignements HCI pour STAGESPACE

1. DoF matching : intégrer le 6DoF (SpaceMouse via OSC IN ou natif).
2. Clutching obligatoire sur tout contrôle relatif.
3. Haptique/physique > visuel en live (StreamDeck, X-Touch motorisés).
4. Métaphore de scène > channel-strip.
5. Le graphe nodal est un choix HCI validé (TouchDesigner, Blender, Max).
6. Le 3D preview = asset de performance projetable (reacTable).
7. Collaboratif multi-opérateurs via OSC IN multi-source.
8. Sweet spot pratique : app desktop + device 6DoF > setup XR complet.

### 3.7 Le mapping par démonstration — Wekinator et le ML gestuel

**Wekinator** (Fiebrink, Trueman, Cook — NIME 2009, 2025 citations) est le
système de référence du *mapping-by-demonstration* : au lieu de programmer
le mapping geste→paramètre, on **montre des exemples** et le modèle
(régression, classification, DTW) apprend la correspondance. OSC in/out
natif — conçu exactement pour notre couche.

**Enseignement** : le mapping OSC IN de STAGESPACE n'a pas besoin d'être du
ML interne — mais l'architecture doit permettre d'insérer un tel moteur
externe entre OSC IN et les paramètres du graphe (Wekinator/Glover/MuBu
parlent déjà OSC). Le graphe est la cible, pas le learner.

**MuBu** (IRCAM ISMM) : la boîte à outils Max de l'analyse gestuelle —
XMM (GMM/HMM recognition), PiPo (descriptors), mubu.track — fait le lien
entre capteur et reconnaissance de gestes appris.

### 3.8 Le tangible et le wearable — contrôle sans écran

- **TUIO / reacTIVision** : le protocole table tangible (fiduciaux/objets
  physiques trackés → OSC position+rotation). Une table TUIO = surface de
  contrôle spatial physique : déplacer un objet = déplacer une source.
  Protocole ouvert, trivial à consommer — notre `follow` peut suivre un
  fiducial.
- **mi.mu Gloves / Glover** : gants flex+IMU → postures ML entraînables
  (9/session), MIDI+OSC out, **haptique et LED embarquées** (feedback
  sans écran). Le paradigme "musique par le mouvement" le plus abouti
  commercialement — et sa logique de mapping posture→scène↔paramètre est
  exactement celle d'une cuelist.
- **MPE** (ROLI Seaboard, LinnStrument, Sensel Morph, Continuum) : 5
  dimensions par note (strike/press/glide/slide/lift) — le canal
  d'expression polyphonique standard. Chaque "note" peut être un objet
  spatial dont la position suit glide/slide — modèle objet↔voix.
- **Buchla Lightning/Thunder** : baguettes sans-fil X/Y — ancêtre du
  contrôle gestuel spatial (Pamela Z).
- **Neova/Genki Wave, MUGIC, SOMI-1** : anneaux/capteurs gestuels — le
  wearable arrive au niveau "musicien de scène", pas chercheur.

### 3.9 L'haptique — le sens manquant

- **Ultraleap STRATOS** : haptique mid-air par ultrasons (256 transducteurs,
  points focaux modulés à 40 kHz → sensations tactiles sans contact,
  couplé au hand-tracking Leap Motion). Boutons/sliders/textures
  virtuels dans l'air — la console de diffusion sans console.
- **Falcon/Novint** (Gelineck & Serafin, déjà cité) : retour de force >
  tracking visuel quand l'écran est occupé.
- Recherche UCL (2023) : la **sonification des textures haptiques** modifie
  la perception corporelle et le comportement moteur — audio et haptique
  sont un seul canal perceptif croisé, pas deux modalités séparées.

**Leçon** : la priorité haptique pour STAGESPACE n'est pas le hardware
exotique — c'est le **feedback dans les devices existants** : LED/moteur
mi.mu, faders motorisés X-Touch, vibration StreamDeck. Renvoyer l'état
(cue active, erreur OSC, position) vers le device est aussi important que
recevoir ses entrées.

### 3.10 Les ancêtres — le geste qui dirige

**Max Mathews, Radio Baton + Conductor Program** (CMJ 15(4), 1991) : deux
baguettes trackées XYZ au-dessus d'une surface, modes **CONDUCTOR**
(diriger une partition : tempo, dynamique, équilibres par le geste) et
**IMPROV** (le geste pilote des algorithmes de composition). C'est
l'ancêtre conceptuel exact : le geste n'écrit pas la musique, il
**interprète un matériau préparé**. Nos graphes = le matériau ; les
macros/OSC IN = le geste du chef.

Note historique : le "trigger plane + threshold de réarmement" de Mathews
(1970) est le premier anti-rebond gestuel documenté — nous avons le même
mécanisme dans les falloffs/triggers.

---

## PARTIE IV — Écosystème de production : show control, co-création, live coding

### 4.1 Le modèle cue — ce que l'industrie du live a résolu

L'audio spatial n'a pas inventé le show control — la lumière et la vidéo
l'ont industrialisé :

- **DMX512 → Art-Net/sACN (E1.31)** : universes adressés, per-channel
  priority (sACN 0xDD — une source prioritaire prend la main), merge
  HTP/LTP, discovery (ArtPoll, E1.31 universe discovery). Le modèle
  "channels + priorités + merge" = exactement nos merge strategies.
- **GrandMA / ETC Eos** : cue lists avec tracking (seules les valeurs
  modifiées changent), follow/hang, partiels, asserts, timing par
  paramètre, fanning. Le niveau de maturité cible pour une cuelist pro.
- **MSC** (MIDI Show Control) : GO/STOP/RESUME + numéro de cue universel —
  la lingua franca inter-consoles. Un régisseur attend de pouvoir
  envoyer `GO 47` à STAGESPACE depuis sa console.
- **MTC/LTC** : timecode comme colonne vertébrale du show — nos
  trajectoires pourraient être indexées timecode (cue "à TC 01:23:45:12").
- **PosiStageNet** déjà couvert — le protocole position-scène ouvert
  supporté par TiMax, L-ISA, MA, disguise.
- **QLab** : le standard théâtre — spatial cues intégrées depuis QLab 5,
  sort ADM-OSC. Le modèle UX de référence (un cue = un objet visuel,
  tout est glissable, tout est automatable).

**Conséquence** : la cuelist STAGESPACE doit parler le langage du show —
**MSC IN (GO/STOP par cue #)** et **MTC** sont les deux intégrations à
plus fort ROI immédiat, avant toute sophistication.

### 4.2 Broadcast — le terrain de l'utilisateur, invisible pour la recherche

Le corpus académique ignore le broadcast — mais c'est là que vit une
partie de l'écosystème dewiweb :

- **Sofie** (NRK, open source) : automation TV — rundown → state-based
  device control, playout vidéo/audio/graphique, MOS protocol, plugins.
  Le modèle "un rundown pilote N devices hétérogènes" = le nôtre.
- **MOS Protocol** (2.8.5) : newsroom ↔ devices, l'ancêtre du show control
  broadcast.
- **Ember+** (Lawo) : arbre de paramètres hiérarchique, subscriptions,
  matrices — le "OSC structuré" du broadcast audio. Le travail
  emberplus_rust/MCxOSC de l'utilisateur en fait déjà un pont vers OSC.
- **NMOS** (AMWA IS-04/05/07/08/09) : découverte + connexion + events +
  mapping des devices IP — l'équivalent broadcast d'OSCQuery+patching.
- **Ravenna/AES67, ST 2110** : transport + PTP (IEEE 1588) — l'horloge
  commune que le monde OSC n'a pas nativement.

**Insight** : personne ne relie encore l'automation broadcast (rundown,
MOS, Ember+) à la génération de mouvement spatial. Un STAGESPACE
"device-compatible" (Ember+ tree ou OSC + MOS) pourrait être piloté
directement par un rundown Sofie — niche réelle pour les installations
AV/broadcast immersives.

### 4.3 Ableton Link — la sync musicale résolue

Link (open source, C++) synchronise **tempo, beat, phase, start/stop**
entre applications en réseau local — sessions peer-to-peer, n'importe qui
change le tempo, tout le monde suit, join/leave libre. Multicast UDP
20808. Pas une timeline partagée : chaque app garde sa timeline, Link
maintient la **relation temporelle** (clock abstraction ↔ beat mapping).

**Pour STAGESPACE** : c'est la bonne réponse au "BPM global du show" — le
node `BPM` devrait pouvoir lire la session Link (crate
`ableton-link` ou pont) plutôt que seulement l'analyse audio. Les engines
rythmiques (pendulum, wave, orbit sync) deviennent alors musicalement
verrouillés au set entier — y compris Strudel/Live lancé à côté.

### 4.4 Live coding spatial — la trajectoire comme pattern

- **TidalCycles / Strudel** : `orbit` (canaux stéréo indépendants) +
  `.pan` + multi-channel orbits — les patterns algorithmiques sont déjà
  spatialisables, mais canal-grain, pas objet-3D. La communauté algorave
  veut du spatial ; elle n'a que du pan.
- **FoxDot, Sardine, SuperDirt→SC** : même logique — le live coding
  génère du contrôle discret ; le spatial y est sous-exploité faute
  d'outils adaptés.
- **Conséquence** : STAGESPACE recevant OSC de Strudel (pattern →
  paramètres de graphe) est le chaînon manquant — les live codeurs
  deviendraient des auteurs de mouvement spatial sans changer d'outil.
  Un "STAGESPACE pattern bridge" (OSC namespace documenté) = feature
  marketing vers cette communauté très active.

### 4.5 Co-création machine — les agents improvisateurs

- **Somax2 / OMax / DYCI2** (IRCAM, ERC REACH, Assayag) : agents
  multi-écoute qui improvisent avec des musiciens depuis un corpus
  appris — machine listening + modèle cognitif + agents autonomes.
  **Circular Auto Spat (CAS, 2025)** ajoute la conscience spatiale :
  spatialisation automatique du corpus ambisonic par descripteurs —
  preuve que les agents co-créatifs **ont besoin d'une politique de
  mouvement** qu'ils n'ont pas. C'est exactement notre couche manquante.
- **CataRT** (Schwarz, MuBu) : navigation d'un corpus de grains dans un
  **espace de descripteurs** (centroid, MFCC, noisiness) par proximité —
  la trajectoire du curseur dans l'espace timbre sélectionne les grains.
  → un node `DescriptorField` (trajectoire dans l'espace des descripteurs
  audio analysés) est un pont direct entre notre moteur et la synthèse
  concaténative — concept inédit, publiable.
- **Djazz, Somax2 CAS** : la spatialisation devient un degré de liberté
  des agents — ils produisent de l'intention, nous produisons le
  mouvement qui la rend.

### 4.6 AI/MCP — le signal TiMax

**TiMax MCP** (2025) : premier renderer spatial à exposer un serveur
Model Context Protocol — un assistant AI peut piloter le show control.
Le context.md de STAGESPACE exclut l'IA générative de la V1 (décision
assumée), mais l'**interface** compte : une API propre, documentée,
découvrable (OSCQuery ou un manifest) est ce qui rendra STAGESPACE
pilotable par n'importe quel orchestrateur — humain, rundown, ou agent.

---

## PARTIE V — Synthèse et roadmap

### 5.1 Positionnement final

```
STAGESPACE =
  console de diffusion générative :
    moteur nodal de trajectoires (graphe → f(t)) pour le live,
    orchestrateur d'effets spatiaux (zones, cinématique → params OSC),
    hub de mouvement au centre d'un cockpit de régie,
    renderer-agnostic.
```

Quatre couches de valeur :
1. **Composition du mouvement** (graphe → f(t) — unique)
2. **Orchestration des effets** (zones/cinématique → paramètres — unique)
3. **Cockpit live** (cue atomique, panic, OSC in/out — filiation Acousmonium)
4. **Interop show/broadcast** (MSC/MTC, Ember+/MOS, TUIO, Link — le
   chaînon que ni la recherche ni les renderers ne couvrent)

**Ce que la passe 2 a changé** : le paysage renderer est plus concurrentiel
qu'escompté — FletcherMachine, TiMax panLab, 4DSOUND ont tous des moteurs
de trajectoire intégrés et l'interop (ADM-OSC, RTTrPM, PSN) y est déjà
native. Mais **tous sont verrouillés dans leur hardware/écosystème** et
aucun n'offre la composition nodale. Notre niche tient : c'est la couche
*entre* les renderers — plus les renderers s'équipent de moteurs fermés,
plus un orchestrateur ouvert et renderer-agnostic prend de la valeur.

### 5.2 Roadmap recherche-informée

**Court terme — créatif :**
- Node `VectorField` + steering (Carpentier/Gerzso)
- Extension `follow` : pursue/evade/orbit/arrive
- Nodes cinématiques : Velocity/Acceleration→modulation
- Canaux étendus : spread/distance/gain/presence (modèle ToscA)
- Node `PerceptualVelocity` (°/s autour du listener — psychoacoustique)

**Moyen terme — effets et interop :**
- Node `Zone` (SFFX contrôle-side)
- Node `Proximity` (relationnels)
- Mode SMS sur orbites + rate limiting
- OSC IN mapping générique à la libmapper (expressions composables)
- **MSC IN (GO/STOP par cue #) + MTC** — le langage du régisseur
- OSCQuery auto-découverte params renderers
- RTTrPM/PosiStageNet → `follow` sur acteurs réels
- TUIO/reacTIVision IN → fiduciaux comme sources trackées
- Support SpaceMouse (réutiliser `spacemouse-osc`)
- OSC timetags / Ableton Link pour sync multi-app
- Node `Room` → scénarios d'acoustique active par cue (Constellation/VIVACE)

**Long terme — écosystème :**
- Plugin VST3 ou API embedding (modèle ToscA/Wwise)
- WebSocket/REST → TouchDesigner ; pont Strudel/live coding
- Node `VirtualMic` (paradigme ViMiC — composer l'écoute)
- Node `DescriptorField` (trajectoire dans l'espace des descripteurs —
  pont CataRT, concept publiable)
- Ember+/MOS device mode → pilotage par rundown broadcast (Sofie)
- Merge priorities type sACN (source prioritaire prend la main)
- Feedback device (LED/motor mi.mu, faders motorisés) — bidirectionnel
- Publication JIM/NIME : "node-graph compiled spatial trajectories" ou
  "zone-based spatial effects orchestration"

### 5.3 Anti-roadmap

- Pas de renderer audio · Pas de clip matrix · Pas de timeline post-prod ·
  Pas de MIDI natif · Pas de tracking hardware propriétaire ·
  Pas d'IA générative interne (V1) — mais API découvrable pour en être
  piloté

### 5.4 Verdict final

La recherche confirme trois choses :

1. **L'architecture est validée** : le graphe compilé en f(t) a des antérieurs
   (Lithe, ambicontrol, animation_nodes) mais aucun produit équivalent. La
   composition hiérarchique+émergente de Schacher décrit formellement ce que
   le graphe fait déjà.
2. **La niche est réelle et triple** : trajectoires nodales + orchestration
   d'effets + cockpit live. Chaque domaine a des occupants séparés ; personne
   n'est aux trois à la fois.
3. **La psychoacoustique doit guider le design** : MAMA, la borne 0-50 Hz,
   l'onset-displacement — des bornes mesurées qui doivent devenir des
   paramètres (PerceptualVelocity, SMS range, onset compensation).

La vulnérabilité reste industrielle : les renderers intègrent déjà leurs
moteurs de trajectoire (FletcherMachine, TiMax, L-ISA FX, Holophonix Motion
Engine). La défense tient en trois points : (1) aucun n'est renderer-agnostic
— c'est structurel (conflit d'intérêt) ; (2) aucun n'offre la composition
nodale ni l'orchestration d'effets par la géométrie ; (3) personne ne relie
le show control (MSC/MTC), le broadcast (Ember+/MOS) et le gestuel
(SpaceMouse, TUIO, mi.mu) au mouvement spatial — c'est le cockpit dewiweb.

Signal à surveiller : **TiMax MCP** (AI assistant dans un renderer spatial)
montre que la couche "orchestrateur pilotable" devient un enjeu — notre API
découvrable (OSCQuery/manifest) est l'investissement défensif.

---

## Bibliographie et liens clés

### Trajectoires et moteurs
- IanniX : iannix.org, hal-03354322
- Carpentier & Gerzso : hal-03111478, hal-03127947
- Cadambi, Lithe : mat.ucsb.edu/Masters/Akshay_Cadambi_Masters_Thesis.pdf
- Schacher, "Gesture Control of Sounds in 3D Space", NIME 2007 :
  jasch.ch/pub/NIME07_Gesture_Jasch.pdf
- Schacher & Kocher, ICST Ambisonics Tools, ICMC 2006 :
  jasch.ch/pub/ICMC06_Ambisonics_Tools.pdf
- ToscA : JIM 2015 (jim.afim-asso.org/jim2015), ICMC 2015,
  forum.ircam.fr (ToscA + OSCAR)
- Trajectory Score Library : github.com/nadirB/Trajectory_Score_Library
- ViMiC : JAES 2005, CMJ 32(3) 2008, JIMS 5(2) 2011, github Nilson/ViMiC-and-friends
- Spatbox : doi.org/10.5281/zenodo.6573505
- SES : mat.ucsb.edu/Masters/McGee_MS_Thesis_Final.pdf
- Sound Trajectory : hal-04950064, hal-04950075
- Grapes 3D : grapes-3d.com
- SpatGRIS : github GRIS-UdeM, ICMC 2018
- ossia score : ossia.io
- ADM-OSC : immersive-audio-live.github.io/ADM-OSC
- Egregore : chdh.net/egregore_source
- ImmLib : github.com/miguel-negrao/ImmLib, zenodo.850696
- abclib : github.com/alainbonardi/abclib, hal-04367491
- Wwise 3D Position Automation : audiokinetic.com docs
- Acousmonium/diffusion : Wikipedia, electrodoc.musiques-recherches.be,
  Tutschku (tutschku.com), Stansbie (ontologie), Landy zenodo.18898493,
  "fractured acousmatic" (academia.edu)
- ESPRO : ircam.fr/espace-de-projection, bruit.fr/revues/78_12900.PDF
- Jot & Warusfel, Le Spatialisateur : architexte.ircam.fr/textes/Jot95b

### Effets spatiaux
- Chowning, JAES 19(1) 1971
- Zotter & Frank, Ambisonics Springer ch.5
- Cadambi, SMS ICMC 2015
- McCormack, COMPASS DAFx 2021
- Sluicer NIME 2024, FOAFX github risdsound, Beamix zenodo.14338798
- IEM suite : plugins.iem.at
- SPARTA/COMPASS : leomccormack.github.io/sparta-site
- Dodge, eContact 10.3
- Lengelé, Live 4 Life, Organised Sound/ICMC
- Spatial grains : ro.uow.edu.au/creartspapers/35
- Faust granulator : hal-04849708
- CAVIAR : doi.org/10.61782/fa.2025.0145
- Auxtrument : doi.org/10.1109/qomex61742.2024.10598285
- Performing Performance Spaces : nime2026_36.pdf
- UCSB XR thesis : escholarship.org/uc/item/8gn375px

### Psychoacoustique du mouvement
- Perrott & Musicant, MAMA, JASA 62(6) 1977 : doi.org/10.1121/1.381675
- Perrott & Tucker, JASA 1988 : doi.org/10.1121/1.395908
- MAMA horizontal : doi.org/10.1121/1.402443
- Carlile, "Perception of Auditory Motion" : PMC4871213
- CNMAT OSC best practices : opensoundcontrol.stanford.edu

### Timing/fiabilité
- Simple Sync OSC : cnmat.berkeley.edu (2015)
- Freed timetags : opensoundcontrol.stanford.edu/files/freed-timetags.pdf
- OSC timestamps : cnmat.berkeley.edu (2008)

### HCI
- libmapper : idmil.org/project/libmapper, github libmapper
- Making Mappings (T-Stick) : doi.org/10.82308/48538
- MapLooper : idmil.org/project/maplooper (NIME 2021)
- Marshall et al., ICMC 2006 (GDIF)
- xrOSC : nime2024_31.pdf — AudioMiXR : doi.org/10.1145/3749478
- ARMixer : doi.org/10.1145/3476124.3488632
- Invoke : doi.org/10.1145/3616195.3616211
- Beyond Faders : arxiv 2602.23090
- Gelineck & Serafin : vbn.aau.dk (AM'15)
- 6DOFpanner : github.com/diegoquirozphd
- spAAce : zenodo.851222
- Gesture Atmos : nime2025_88.pdf — Metabow : nime2025_62
- Design Patterns Spatial Instruments : zenodo.13904804
- reacTable : mtg.upf.edu
- Chataigne : benjamin.kuperberg.fr/chataigne
- Space Controller : soundparticles.com — MPE : roli.com
- PosiStageNet : posistage.net — BlackTrax : cast-soft.com

### Renderers pro (passe 2)
- TiMax : timaxspatial.com (SoundHub, panLab, TrackerD4, TimeLine, MCP)
- FletcherMachine : adamson-fletcher-machine.com (V2.x)
- Yamaha AFC Image/Enhance : usa.yamaha.com/proaudio/afc
- 4DSOUND : 4dsound.net + paper CUMINCAD 2016
- Meyer Spacemap Go / Constellation (NADIA) : meyersound.com
- VIVACE : mbbm-aso.com — CARMEN : CSTB (pub.dega-akustik.de)
- Klang:technologies : klang.com

### Panning / rendu
- VBAP : Pulkki, JAES 45(6) 1997 — MDAP, AllRAP (Neukom/Schacher 2008)
- DBAP : Lossius/Baltazar/DeLaHogue, ICMC 2009 (jamoma.org)
- Panning algos SPAT : doc.flux.audio/Spatialisation_Technology
- Volumetric panning : embody.co

### Show control / broadcast / sync
- Art-Net 4 / sACN E1.31 / GrandMA : help.malighting.com
- MSC (MIDI Show Control), MTC, PosiStageNet
- Sofie : github.com/Sofie-Automation — MOS 2.8.5
- Ember+ : github.com/Lawo/ember-plus — NMOS : AMWA IS-04/05
- Ableton Link : ableton.github.io/link

### Live coding / co-création / ML mapping
- Strudel : strudel.cc — TidalCycles : tidalcycles.org
- Somax2 : github.com/DYCI2/Somax2 — CAS : zenodo.15840075
- CataRT/MuBu : ircam-ismm.github.io/max-msp
- Wekinator : wekinator.org (Fiebrink, NIME 2009)
- mi.mu Glover : mimugloves.com — MPE : roli.com
- TUIO/reacTIVision : tuio.org
- Ultraleap mid-air haptics : docs.ultraleap.com
- Radio Baton : Mathews, CMJ 15(4) 1991 — ccrma.stanford.edu/radiobaton
- Sound Particles plugins : soundparticles.com (Energy/Brightness/Beat
  Panner, Doppler, Air, Space Controller, inDelay)
- E4L Envelop for Live : github.com/EnvelopSound

### Corpus dewiweb (GitHub)
spacemouse-osc, chataigne_spatiale, Holophonix-chataigne-module,
holophonix-animator, holophonix_blender_addon, trajectoires-modern,
MCxOSCnext, emberplus_rust, open-stage-control, companion-module-*,
aes67_visualizer, audio-accessibility-system, XCTL_
