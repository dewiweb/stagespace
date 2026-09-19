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
  SpatGRIS, Sound Trajectory, Panoramix, Zirkonium, SSR, ViMiC
  → rendu audio ET interface de positionnement

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

---

## PARTIE IV — Synthèse et roadmap

### 4.1 Positionnement final

```
STAGESPACE =
  console de diffusion générative :
    moteur nodal de trajectoires (graphe → f(t)) pour le live,
    orchestrateur d'effets spatiaux (zones, cinématique → params OSC),
    hub de mouvement au centre d'un cockpit de régie,
    renderer-agnostic.
```

Trois couches de valeur :
1. **Composition du mouvement** (graphe → f(t) — unique)
2. **Orchestration des effets** (zones/cinématique → paramètres — unique)
3. **Cockpit live** (cue atomique, panic, OSC in/out — filiation Acousmonium)

### 4.2 Roadmap recherche-informée

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
- OSCQuery auto-découverte params renderers
- RTTrPM/PosiStageNet → `follow` sur acteurs réels
- Support SpaceMouse (réutiliser `spacemouse-osc`)
- OSC timetags / Ableton Link pour sync multi-app

**Long terme — écosystème :**
- Plugin VST3 ou API embedding (modèle ToscA/Wwise)
- WebSocket/REST → TouchDesigner
- Node `VirtualMic` (paradigme ViMiC — composer l'écoute)
- Publication JIM/NIME : "node-graph compiled spatial trajectories" ou
  "zone-based spatial effects orchestration"

### 4.3 Anti-roadmap

- Pas de renderer audio · Pas de clip matrix · Pas de timeline post-prod ·
  Pas de MIDI natif · Pas de tracking hardware propriétaire

### 4.4 Verdict final

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

La vulnérabilité reste industrielle : SPAT/L-ISA ont les moyens d'ajouter un
moteur nodal. La défense : vitesse open-source, spécialisation live, et
l'intégration multi-renderer qu'ils ne feront jamais (conflit d'intérêt).

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

### Corpus dewiweb (GitHub)
spacemouse-osc, chataigne_spatiale, Holophonix-chataigne-module,
holophonix-animator, holophonix_blender_addon, trajectoires-modern,
MCxOSCnext, emberplus_rust, open-stage-control, companion-module-*,
aes67_visualizer, audio-accessibility-system, XCTL_
