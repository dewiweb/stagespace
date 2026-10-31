# Lot 1 — Éditeur de graphe (audit complet)

Fichiers lus intégralement + dépendances (`connectionRules.ts`, `Slider.tsx`,
`index.css`, `tailwind.config.js`, `useGraphStore.updateNodeData`).

## 1. `components/NodeEditor.tsx` (1063 lignes)

### Rôle

Centre nerveux de l'édition : **un seul canvas React Flow partagé entre 3
contextes** (tab « Move graph » = sub-graph du slot, « Global FX » = post-process,
« Modulation » = graphe signal scalaire), + palette de nodes repliable, overlay
diagnostics backend, légende de ports, menu contextuel exemples, QuickAdd (Ctrl+K).
Monté `App.tsx:386` en mode Expert, split avec Scene3D.

### Structure interne

- Helpers : `createNode` (38-43), `createPluginNode` (47-52), `nodeTypes` (36).
- `NodeEditor` (54-1001) : ~30 sélecteurs Zustand (55-127), état local (63-77),
  décor memoized nodes/edges (144-170, 509-520), `diagnose_graph` debounced
  200ms (172-206), **triple de handlers quasi identiques** global/signal/sub
  (209-251), auto-push debounced 300ms (254-266), autopatch `trySpliceOnEdge`
  (276-329), `addNodeByType`/`addPluginNode` (331-356), validation connexion
  (360-418), Ctrl+K document-level (456-466), rendu tab bar (534-605),
  palette (611-838), canvas + overlays (841-997).
- `ViewportSync` (1008-1020), `PortLegend` (1027-1063, collapsed persisté).

### Hiérarchie visuelle réelle

```
<div w-full h-full flex-col>
├── <div h-8 tab bar>              ← 32px
└── <div flex-1 flex>
    ├── Palette (w-60 ou rail w-9) ← 240px / 36px
    └── <div flex-1 canvas relatif>
        ├── overlay issues (top-2 right-2, z-10)
        ├── <ReactFlow> : Background, Controls, ViewportSync, PortLegend, MiniMap
        ├── empty state (inset-0)
        ├── <QuickAddModal>
        ├── menu contextuel (fixed, z-menu)
        └── badge "Connecting from…" (top-2 center)
```

Jusqu'à 5 couches simultanées sur le canvas + menu + modal.

### Interactions

- Stores : `useGraphStore`, `useGlobalGraphStore`, `useSignalGraphStore`.
- IPC : `diagnose_graph`, dialog `.ssx`, `importPlugin`/`reloadPlugins`.
- RF : 3× onNodesChange/EdgesChange/Connect, onConnectStart/End,
  onNodeDoubleClick/ContextMenu/Click, isValidConnection, deleteKeyCode.
- localStorage : `stagespace.portLegend.collapsed`.

### Problèmes précis

**Triplication** : 3 groupes de handlers quasi identiques (209-251) ; filtre
`SIGNAL_ONLY/SUB_ONLY/GLOBAL_ONLY` dupliqué verbatim palette vs `allowedTypes`
(653-657 vs 474-484) ; branchement `if global/signal/else` répété dans
`trySpliceOnEdge`, `addNodeByType` et le JSX (316-324, 874-894) ; dead
conditional — deux branches identiques (928-931).

**Tailles <44px** : tab bar h-8 (32px), boutons ≈20-22px, rail w-6 h-6 (24px),
collapse w-5 h-5 (20px), items palette ≈26px, issues ≈24px.

**Couleurs ad hoc / tokens** : mélange `stagespace-*` et `gray-800/900`,
`purple/cyan/amber-700/800` (537-602) ; **hover par mutation DOM impérative**
`e.currentTarget.style.background = getCategoryColor(type)+'20'` (688-693,
744-749) ; hardcodes `Background color="#1e1e2e"` (913), `maskColor` (919),
boxShadow `rgba(34,197,94,0.6)` (166), `'#4b5563'` (670, dupliqué schema:118) ;
**`z-10` viole la convention** (843, 1037 — tokens z-overlay/z-raised existent).

**text-xs** ~40 occurrences + `text-[10px]`/`[11px]`.

**Logique dans le rendu / bugs** :
- `id: ${type}-${Date.now()}` — collision possible même ms (39, 48).
- **Edge id `${source}-${target}` sans handles** → deux edges mêmes nodes =
  id dupliqué (227, 244). F11.
- Positionnement cascade `displayNodes.length * 30` + magics 250/150 (334, 351).
- Noms de ports en dur `'objects','duration','spline'` (500) — duplique
  `port_type !== 'Positions'` de connectionRules:153 ; si un 5e type arrive,
  divergence.
- **`onConnectEnd` navigue le DOM interne React Flow** (`closest('.react-flow__node')`,
  `dataset.handleid`) — cassera à un changement de markup (402-413).
- **`onDoubleClick` sur wrapper div** → double-clic MiniMap/Controls/PortLegend
  ouvre QuickAdd par bubbling (469). F12.
- Menu contextuel `fixed` sans clamping viewport (963-965).
- `useEffect` dep manquante `editingSlotSignalGraph` (108-110).
- `diagnose_graph` sérialise le graphe à chaque keystroke, debounce 200ms, race
  possible deux runs in-flight (172-206).
- **Incohérence edge style** : global/signal ajoutent `markerEnd` inline, sub
  délègue au store → double source de vérité (226 vs 248).
- Footer aide duplique PortLegend (826-836).
- `issuesOpen` non fermable clic extérieur (857-867).
- `changes: any[]` (209-237), `_: any`, `as Edge` (228).
- `animated: edgesLive` global — toutes les edges s'animent dès qu'un move joue
  (513) — trompeur.

**Conventions RF** : `sourceHandle ?? 'out'`/`targetHandle ?? 'in'` cohérent ;
validation port-level mirror du validator Rust + toast de rejet (bien, 414-417) ;
pas de `connectionRadius` configuré.

**Verdict** : triplication sub/global/signal non factorisée + hover impératif
ad hoc sur 500 lignes de JSX ; le fichier porte 3 responsabilités. **Haute
priorité — scinder en `NodePalette`/`GraphCanvas`/`useActiveGraphStore`.**

---

## 2. `components/CustomNode.tsx` (618 lignes)

### Rôle

Renderer unique de tous les types de nodes (`type:'custom'`). Résout le schéma
(params statiques ou manifeste plugin), rend les handles colorés, header
catégorie, indicateurs live audio, params expansibles, sections spéciales
(Linked Tracks, Spline Library, Track Range).

### Structure

`AUDIO_NODE_TYPES` (12), types (14-20), `CustomNode` (22-500) : résolution
graphe propriétaire par recherche d'id ×3 stores (28-33), plugin manifeste +
`pluginMissing` (37-51), ports (54-59,255), modulation dots (63-72), audio live
(81-89), `handleChange` debounce 150ms→`updateGraphLive` (91-115),
`renderInput` 6 types (121-240), trackIds (242-252), handles input (260-274),
JSX (277-497), `MiniBar` (502-513), `SplineLibraryControls` (517-616).

### Problèmes précis

- **"Linked Tracks" dupliqué 2×** : expanded slice(0,16) (383-407) vs collapsed
  slice(0,12) (423-447) — seuils incohérents ; `SplineLibraryControls` monté
  2× (410, 418).
- **Classe input répétée 7× verbatim** (151-593) + variantes cyan — contourne
  le `NodeParamField` partagé mentionné nodeParamSchema:215.
- Double debounce : 150ms local + hot-swap 200ms store + autoSave — triple
  temporisation par keystroke.
- Tailles : toggle w-9 h-5 (36×20), chevron ~16px, inputs 26px, chips 18px,
  boutons spline icônes 10px.
- Couleurs : `color+'60'/'20'` concat hex-alpha ; A/B `text-blue-400`/`purple-400`
  **hors PORT_COLORS** alors que ports Positions (gris) — incohérence sémantique ;
  ~15 teintes sans token ; **`Slider accent="cyan"` hardcodé** ignore la catégorie.
- **Parser `track_range` inline IIFE en JSX** — split, parseInt, magics 11/24
  (457-475). Devrait être un util testé.
- vec3 édité comme texte `split(',')` — saisie invalide ignorée, snap back (184-194).
- `commitTrackIds` effet de bord transverse `setManualOscIds` (243-252).
- Détection propriétaire O(n)×2 par render ; **priorité implicite par ordre des
  if** (global>signal>move) (28-33, 102-109).
- `AUDIO_NODE_TYPES` en dur — devrait dériver du catalogue.
- Handles `!w-3 !h-3` = 12px (270, 493).
- Labels `p.name` au lieu de `p.label` (361).
- Plugin non résolu : superset 5 ports en handles, labels A/B seulement si
  `kind==='composite'` — transient incohérent.
- `issueMessages` cast hors type, tooltip natif sur tout le node (280).
- `expanded` non persisté ; `hover:shadow-xl` coût paint sur dizaines de nodes.
- **Aucun `nodrag`** sur inputs/selects/boutons — risque drag node au mousedown.
- `Spline ${toLocaleTimeString()}` — locale-dependent, non triable (590).

**Verdict** : un seul composant de 500 lignes pour tous les types, sections
dupliquées expanded/collapsed, classe input ×7, mini-contrôles 10-20px.
**Haute priorité — extraire `NodeParamField`, `LinkedTracksSection`,
`TrackRangeSection`, mutualiser expanded/collapsed.**

---

## 3. `components/nodeParamSchema.ts` (275 lignes)

### Rôle

Couche d'adaptation catalogue Rust généré (`nodeSpecs.json`) → UI :
`PARAM_SCHEMA`, `NODE_CATEGORIES`, `NODE_COLORS`, scopes, descriptions,
defaults, helpers plugin, `prepareGraphForSave`.

### Problèmes précis

- `ParamType` : `'text' | 'string'` deux variants identiques (8) ; cast
  `p.kind as ParamType` non validé → renderInput null silencieux.
- `vec3` et `track_ids` = tous deux `number[]` — conflation de types (12).
- `JSON.parse(p.default_json)` **sans try/catch** — catalogue malformé = crash (124).
- Fuites `any` : `getDefaultParams`, `mergeDefaultParams`, `prepareGraphForSave` (140-190).
- **`getValidTargetTypes` exclut `to === from`** : Scale→Scale (Positions→Positions,
  valide) absent du tooltip "Can connect to" — le tooltip ment (162).
- `NODE_COLORS` hex ad hoc dupliquant partiellement les tokens ; fallback
  `'#4b5563'` répété.
- `CATEGORY_META` : ordre palette et labels FR/EN figés, pas i18n.
- `prepareGraphForSave` : mutateur de graphe dans un fichier de schéma —
  hors sujet, devrait vivre dans `graphSerializer.ts` (179-190).
- `ENGINE_TYPES`/`NON_PARAM_NODES` : logique de présentation de NodeParamsPanel
  logée dans le schéma — coupling UI↔data (195-209).
- `GraphNodeData.pinned` : champ UI orphelin — aucun code des 3 fichiers ne le
  lit/écrit ; canal parallèle invisible (19-23).
- `GraphNodeData.label/type/params` optionnels alors que `createNode` les fournit
  toujours → ~20 casts `as`/`??` dans les consommateurs.

**Verdict** : fichier sain (seule vraie couche d'abstraction des 3) mais
semi-typé — unions laxistes, `any`, `pinned` orphelin. **Moyenne priorité —
resserrer `NodeParamValue` en union discriminée par kind, typer les helpers
`*ForSave`, rendre les champs data requis.**

## Synthèse lot 1

| Axe | Constat |
|---|---|
| Triplication | 3 graphes → 3× handlers/filtres (NodeEditor 209-251, 316-324, 474-657) |
| Duplication | Linked Tracks ×2 (seuils 16/12), input ×7, SplineLibrary ×2 |
| Tokens | stagespace-* + gray/purple/cyan/amber ad hoc + z-10 violant la convention |
| Handles | top/bottom cohérent, PORT_COLORS partagé, mais A/B hors PORT_COLORS, name≠label |
| Bugs latents | edge-id sans handles (F11), dbl-clic wrapper (F12), `getValidTargetTypes` exclut self, `JSON.parse` sans garde |

Actions : extraire `NodePalette`/`GraphCanvas`/`useActiveGraphStore` ;
factoriser `NodeParamField` + sections ; corriger edge-id (inclure handles) et
le bubbling ; z-10→tokens, hover impératif→classes.
