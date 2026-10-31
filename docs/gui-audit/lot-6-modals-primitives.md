# Lot 6 — Modals et primitives ui/ (audit complet)

## 1. `components/SettingsModal.tsx` (294 l.)

Config globale (OSC out/in, merge, track IDs, audio). Monté uniquement
`Toolbar:115` — inaccessible en Perform (cohérent avec le lock slice).

- `catch (e: any)` — seul `any` explicite des fichiers audités (94).
- Détection erreur par `oscInStatus.startsWith('Error')` — fragile (211).
- `setOscPort(Number(...) || 0)` — impossible de vider, port 0 silencieux (134).
- `key={i}` index sur targets (164).
- Tokens mixtes : `border-gray-700`/`bg-gray-900` vs `border-stagespace-border` footer.
- `max-w-[520px]` arbitraire vs `max-w-sm` QuickAdd — pas de gamme de largeurs.
- `oscIdsStr` initialisé au mount, pas de resync pendant l'ouverture.

**Verdict : fonctionnel, unique point d'édition OSC — validation laxiste,
hygiène type/tokens perfectible. Aucun test.**

## 2. `components/WelcomeModal.tsx` (86 l.)

Premier lancement → exemple bundlé ou départ vide (`App:504`).

- `loadExample` ferme et marque `welcomed` **même si le load échoue** (30-39).
- Esc/X = consentir au flag sans distinction.
- `<kbd>` stylé ad hoc — 3e implémentation du repo.

**Verdict : propre et documenté ; défaut réel = flag marqué sur échec.**

## 3. `components/ShortcutsModal.tsx` (46 l.)

Cheatsheet raccourcis, `App:507` (`?` ou bouton Toolbar).

- Liste **dupliquée à la main** de `useLiveShortcuts` — déjà en dérive
  (Ctrl+K listé mais handler dans NodeEditor document-level ; Backspace
  nuance non mentionnée).
- `?` traité **avant** le guard `isModalOpen` — empile ShortcutsModal par-dessus.
- Omet les commandes OSC `/stagespace/*`.

**Verdict : minimal et correct ; synchronisation manuelle = dette déclarée.**

## 4. `components/QuickAddModal.tsx` (138 l.)

Palette searchable plugdata-like, `NodeEditor:943-951`. Triggers : Ctrl+K,
double-clic pane, bouton + palette, hint.

- **Bug probable de focus** : `Modal:42` focus `focusables[0]` = le **bouton
  X du header** → vole l'autoFocus de l'input → taper à l'ouverture ne va
  pas dans le champ. Le test ne le voit pas (`fireEvent` sans focus réel).
- `expect(calls.length + 0).toBeGreaterThanOrEqual(0)` — **assertion
  tautologique**, le test clavier ne vérifie rien (test:77).
- `selIdx` reset sur `query` seulement (54).
- Couleur plugin `#a855f7` hardcodée (113).
- Liste plate sans headers de catégorie.
- Monté **à l'intérieur** de l'ErrorBoundary "Canvas" — un crash tue canvas + éditeur.

**Verdict : bonne UX de palette, mais soupçon réel de bug focus et test creux.**

## 5. `components/ui/Modal.tsx` (94 l.)

Shell modal : overlay `bg-black/60 backdrop-blur-sm` z-popover, `role=dialog
aria-modal`, focus trap, `useModalGuard`.

- **`focusables[0]` = bouton X** — tout modal s'ouvre avec focus sur "Close",
  vole l'autoFocus du contenu (42). Devrait privilégier `[autofocus]` ou le
  premier élément du contenu.
- **Esc n'est pas géré par Modal** — délégué à `useLiveShortcuts` → hors App
  (tests, fenêtre conduite), Esc ne ferme rien.
- Pas de `aria-labelledby`.
- `closeOnOverlay=false` mais `useModalGuard` reste → Esc ferme quand même.
- Pas de portal — fragile dans un conteneur transform/overflow.

**Verdict : bon fondement ; 2 défauts réels : focus initial = X, Esc externe.**

## 6. `components/ui/ConfirmModal.tsx` (43 l.)

Confirmation destructive — `CuelistPanel:341`, `MovesTable:599`.

- Commentaire "Focus lands on Cancel" **faux** — focusables[0] = X du header.
- `onConfirm` ne ferme pas — dépend du caller (non documenté).
- Boutons sans `transition-colors` — micro-incohérence.
- Pas de prop `variant` : toujours rouge destructif (design, ok).

**Verdict : fait exactement une chose bien ; docstring inexacte.**

## 7. `components/ui/EmptyState.tsx` (52 l.)

Empty state normalisé. **Réutilisé** : CuelistPanel, TrackGrid, MovesTable,
AnimationList, SpatialFxPanel ×3 — 6 sites.

- Le docstring revendique "~8 implémentations remplacées" — il en reste :
  `PerformView` ×4 (465-585, empty state riche dupliqué), `NodeEditor`
  (923-941), `SettingsModal` (276-278).
- Bouton `bg-indigo-900/50` — indigo n'est pas un token.
- `size:'sm'` ne compacte que le padding.
- 0 tests.

**Verdict : primitive correcte adoptée pour les listes ; la moitié des empty
states reste ad hoc.**

## 8. `components/ui/IconButton.tsx` (46 l.)

Bouton toolbar 5 variantes. **Réutilisation : 1 seul fichier** (Toolbar ×5).

- **22 classes couleur, 0 token** — `bg-gray-800`, `bg-indigo-800`… Le
  `primary` est **indigo** alors que `stagespace.accent` = bleu — **deux
  "primaires" dans le design system**.
- Sous-adoption massive : PerformView seul a ~25 boutons ad hoc similaires.
- Variantes `danger`/`warning` avec `border` → padding effectif différent.
- Pas d'`aria-label` requis.

**Verdict : API sensée mais quasi non déployée — déclaration d'intention.**

## 9. `components/ui/Slider.tsx` (109 l.)

Range unifié 3 layouts. **Le mieux adopté** : 9 fichiers.

- `ACCENTS: Record<string,string>` clé non typée — accent inconnu → classe
  manquante silencieuse (30-38).
- `dec` déduit de `step` — step 0.15 → 1 décimale → affichage tronqué (55).
- Layout `bare` : `className` sur l'input seulement vs wrapper ailleurs —
  asymétrique (72).
- Pas d'`aria-label` quand `label` absent — `bare` inaccessible.
- Label `w-16` tronqué ; valeur `w-12` déborde sur `"-180.00°"`.

**Verdict : seule primitive vraiment déployée ; formatage/typage à resserrer.**

## 10. `components/ui/OscArmToggle.tsx` (41 l.)

Interrupteur master OSC LIVE/MUTED — `Toolbar:119`, `PerformView:452` et `:568`.

- **F9 — Désynchronisation** : `set_osc_armed` n'émet aucun event
  (`osc.rs:239-242` = `eprintln!` seul). Trois sources non synchronisées :
  ce toggle, `DryRunChip` (rendu divergent, **sémantique inversée** — disarmé
  = vert), `/stagespace/arm|disarm` → `doArm`. Un disarm console → le toggle
  affiche toujours LIVE ; deux instances simultanées PerformView → états
  contradictoires.
- `catch(() => {})` silencieux → "LIVE" mensonger hors Tauri.

**Verdict : UX bonne mais état local non broadcasté + DryRunChip concurrent
= source d'état contradictoire. À fusionner.**

## 11. `components/ui/PanicButton.tsx` (54 l.)

Panic partagé — `Toolbar:161`, `PerformView:453/568/667`. **Les 3 panics de
PerformView sont bien le même composant** (pas de duplication interne).

- `setTimeout` non cleanup (28).
- Flash : `animate-fade-in` puis unmount sec à 350ms — pas de fade-out.
- La duplication est **ailleurs** : `ConduitePage:88` réécrit le bouton —
  pas d'icône, pas de flash, styling divergent, aucun feedback visuel dans la
  fenêtre conduite elle-même.
- `PerformView:561` STOP ALL = action différente (fade) — légitimement séparé.

**Verdict : bon composant live-safety ; seul le panic de ConduitePage échappe
au partage.**

## 12. `components/ToastContainer.tsx` (51 l.)

Pile bottom-right z-toast, `App:501` — **absente de la branche `?view=conduite`**
(court-circuit avant AppMain → toasts du panic invisibles dans la fenêtre FOH).

- `role="alert"` sur chaque item **et** sur le container + `assertive` —
  double annonce lecteur d'écran.
- Icône error = `<X>` — glyphe "fermer", pas d'erreur.
- **`animate-fadein` dupliquée** : index.css définit `fadeIn`/`animate-fade-in`
  (4px) ET `fadein`/`animate-fadein` (8px) — deux conventions cohabitent.
- Pas d'indication sticky vs éphémère, pas de barre de timeout.

**Verdict : système solide (dédup, sticky, folding) ; a11y et nommage à nettoyer.**

## 13. `components/ErrorBoundary.tsx` (48 l.)

Boundary par zone : Perform, Left panel, Canvas, Inspector — volontairement
pas Toolbar/StatusBar/ToastContainer (panic doit survivre).

- **La branche `?view=conduite` n'est PAS wrappée** → crash de ConduitePage =
  page blanche de l'écran FOH dédié (le pire écran pour ça).
- Fallback affiche `error.message` brut — stack technique exposée à l'opérateur.
- Retry sans backoff — boucle crash→retry→crash possible.

**Verdict : stratégie de zone correcte ; manque couverture conduite + retry-backoff.**

## 14. `pages/ConduitePage.tsx` (94 l.)

Dumb-view conduite fenêtre secondaire (`?view=conduite`). Reçoit
`conduite:state` (500ms), émet `conduite:cmd`.

- **F10 — Page blanche hors Tauri, causes empilées** : (a) `listen`/`emit`
  **raw** depuis `@tauri-apps/api/event` au lieu de `safeListen` (7) →
  rejet hors Tauri, `st` reste null → '—' partout ; (b) `poll` catch
  silencieux → aucun indicateur "backend absent" ; (c) `emit` non géré ;
  (d) pas d'ErrorBoundary autour du lazy → crash = blanc intégral.
- `bg-stagespace-bg` **et** `style={{background:'#0b0d12'}}` — l'inline
  écrase le token avec une valeur **différente** (44).
- **PANIC dupliqué** — pas `PanicButton` : pas d'icône, pas de flash, aucun
  ack si la fenêtre principale est fermée (88).
- **GO ≠ GO** : `cmd('go')` → `doCueNext` (recall cue) vs PerformView "GO" =
  `goToNextMove` (setlist) — même libellé, actions différentes selon la
  fenêtre — dangereux opérateur.
- `disabled` sur Prev/Next pendant `isRecalling` mais **pas sur GO** (85-87).
- `pending.remainingSec` = snapshot émise — le compte à rebours saute par
  paliers de 500ms.

**Verdict : vue dédiée utile mais le plus fragile des fichiers audités :
raw API, zéro fallback, token contourné, panic hors-composant, GO ambigu.**

## Qualité des primitives ui/

| Primitive | Consommateurs | Verdict |
|---|---|---|
| `Modal` | 5 modals + 2 pickers | ✅ bonne |
| `ConfirmModal` | CuelistPanel, MovesTable | ✅ adopté (2/2) |
| `EmptyState` | 6 sites/5 fichiers | ⚠️ moitié des empty states inline |
| `Slider` | 9 fichiers | ✅ la mieux déployée |
| `IconButton` | **Toolbar uniquement** | ❌ ~40 boutons ad hoc similaires inchangés |
| `OscArmToggle` | Toolbar, PerformView×2 | ❌ état non sync + DryRunChip concurrent |
| `PanicButton` | Toolbar, PerformView×3 | ✅ partagé sauf ConduitePage |

**Tokens stagespace** : partiels — `Modal`/`PanicButton`/`ToastContainer` ✓
mais `IconButton` (0 token, 22 couleurs), `Slider` (accent-* raw),
`EmptyState` (indigo), `OscArmToggle` (red/gray raw), `ConduitePage`
(inline) — le design system existe mais n'est pas appliqué aux primitives
elles-mêmes.
