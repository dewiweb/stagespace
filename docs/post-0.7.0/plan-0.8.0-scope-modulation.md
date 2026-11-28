# Plan 0.8.0 — lot 1 : scope modulation (A2.6-9) + B6

Validé owner le 28 nov. — issue de la validation A2.1. Items roadmap :
A2.6 badge scope · A2.7 accès global · A2.8 chips · A2.9 labeling · B6
sérialisation. Code analysé le 29 nov.

## Constat d'architecture partagé

Trois des cinq items ont la **même racine** : le graphe signal global
n'a pas de domicile canonique en mémoire. Il vit dans localStorage et
n'existe dans le store que lorsque le contexte d'édition est 'global'
— le buffer d'édition fait office de copie. D'où :

- **B6** — `buildShowEnvelope` sérialise le buffer courant (peut être
  le graphe d'un slot) dans la section globale du show
- **A2.8** — les ModChips lisent le buffer : en contexte slot, la
  modulation globale active devient invisible (le composant se masque
  pour ne pas mentir — mais rien ne la remplace)
- confusion générale de scope constatée en session owner

## Design

### 1. Domicile canonique du graphe global (fondation — B6 + A2.8)

Le store signal porte un nouveau champ `global: { nodes, edges }` —
copie canonique en mémoire du graphe global, synchronisée :

- au boot : chargée depuis localStorage (la persistence au boot reste
  localStorage — pas de migration)
- à chaque édition en contexte 'global' : `persist()` met à jour
  `global` **et** localStorage (le buffer d'édition EST alors le graphe
  global — sync triviale)
- en contexte slot : `global` reste intacte — l'édition per-move n'y
  touche pas
- `setContext('global')` recharge le buffer depuis `global` (plus de
  relecture localStorage en session — même résultat, une seule source)
- au chargement d'un show : la section `signalGraph` du fichier remplace
  `global` (et localStorage) — chemin déjà existant, à adapter

Consommateurs :
- **`buildShowEnvelope`** sérialise `global` — B6 corrigé quelle que
  soit l'activité d'édition au moment du save
- **ModChips** lit `global` — la modulation globale reste visible même
  pendant l'édition d'un slot — A2.8 fondation

### 2. Sélecteur de scope dans l'onglet Modulation (A2.6 + A2.7 unifiés)

Un contrôle segmenté dans la barre de tabs, visible **uniquement quand
l'onglet Modulation est actif** :

```
[Move graph] [Global FX] [Modulation]  ⌾ Move: Orbit Ensemble ○ Global
```

- état per-move : le segment gauche est actif, libellé avec le nom du
  slot (couleur modulation) — « tu édites la modulation DE CE MOVE »
- état global : le segment droit actif — « tu édites la modulation
  GLOBALE (macros) »
- cliquer bascule `setContext` — l'accès au global devient explicite
  et local (A2.7), plus besoin de deviner le bouton « All » du drawer
- sans slot en édition : seul « Global » est proposé (état forcé)

Précédent dans le code : le tab Move graph affiche déjà `› slotName`
— on généralise la logique au domaine signal, en plus explicite.

En complément (cheap) : le title du bouton « All » du drawer mentionne
la modulation globale — mais le sélecteur devient la voie principale.

### 3. ModChips par origine (A2.8)

- **Global** : lu depuis `global` (canonique) — affiché quel que soit
  le contexte d'édition. Inchangé visuellement.
- **Per-move** : pour chaque slot **en lecture** dont le document porte
  un `signalGraph` non vide — chip distincte préfixée du nom du slot :
  `MOD Orbit:radius←lfo`. Couleur modulation identique, préfixe slot
  pour la distinction. Cliquable ou non : non dans ce lot (A2.3 le
  couvrira).

### 4. Labeling dropdown SignalOut (A2.9a)

Constat affiné : le format type-wide `param:<Type>:<key>` est une cible
**valide** (toutes instances du type) mais n'est proposée dans la liste
qu'avec 2+ instances — avec une seule, la valeur courante retombe sur
l'affichage brut. Fix minimal et honnête : le fallback de la valeur
courante rend le **label friendly** (parsé via la même logique que les
options) au lieu de la valeur brute. Pas de changement de sémantique.

Question laissée ouverte (hors lot) : proposer le type-wide même à une
instance (plus robuste aux éditions du graphe) — à trancher à l'usage.

### 5. Précision des inputs numériques (A2.9b)

Investigation d'abord : le step slider 0.1 n'explique pas 0.4→0.49 —
soit le drag du Slider ne snappe pas réellement au step, soit l'user a
draggué en explorant. Reproduire, puis fixer la cause (snap réel ou
saisie libre non quantifiée). Un param modulé en continu ne doit pas
être quantifié à l'édition au-delà de la précision d'affichage.

## Hors-scope du lot

- A2.2 (clic-droit « modulate »), A2.3 (dot cliquable), A2.4 (doc) —
  lot modulation suivant
- Refonte des chips en panneau de détail — A2.3
- Type-wide proposé à une instance — question ouverte

## Tests

- vitest : sérialisation B6 (save en contexte slot → section globale
  correcte ; en contexte global → idem), ModChips par origine, fallback
  friendly du dropdown, sélecteur de scope (setContext appelé)
- `exampleShow.test.ts` et la suite frontend complète doivent rester
  verts (633 tests + nouveaux)
- validation live au bridge : scénario de corruption B6 rejoué, badge
  visible, chips correctes dans les deux contextes

## Ordre d'implémentation

1. Store : champ `global` canonique + adaptation persist/setContext/load
2. B6 : buildShowEnvelope lit `global` + test de régression
3. Sélecteur de scope (A2.6/7)
4. ModChips par origine (A2.8)
5. Dropdown friendly + investigation quantization (A2.9)
6. Validation complète + live bridge
