# Lot 1 — Graph editor (full audit)

Files read in full + dependencies (`connectionRules.ts`, `Slider.tsx`,
`index.css`, `tailwind.config.js`, `useGraphStore.updateNodeData`).

## 1. `components/NodeEditor.tsx` (1063 lines)

### Role

Editing nerve center: **a single React Flow canvas shared between 3
contexts** ("Move graph" tab = slot's sub-graph, "Global FX" =
post-process, "Modulation" = scalar signal graph), + collapsible node
palette, backend diagnostics overlay, port legend, examples context
menu, QuickAdd (Ctrl+K).
Mounted `App.tsx:386` in Expert mode, split with Scene3D.

### Internal structure

- Helpers: `createNode` (38-43), `createPluginNode` (47-52),
  `nodeTypes` (36).
- `NodeEditor` (54-1001): ~30 Zustand selectors (55-127), local state
  (63-77), memoized decorated nodes/edges (144-170, 509-520),
  `diagnose_graph` debounced 200ms (172-206), **triple of nearly
  identical handlers** global/signal/sub (209-251), auto-push debounced
  300ms (254-266), autopatch `trySpliceOnEdge` (276-329),
  `addNodeByType`/`addPluginNode` (331-356), connection validation
  (360-418), Ctrl+K document-level (456-466), tab bar render (534-605),
  palette (611-838), canvas + overlays (841-997).
- `ViewportSync` (1008-1020), `PortLegend` (1027-1063, persisted
  collapsed).

### Real visual hierarchy

```
<div w-full h-full flex-col>
├── <div h-8 tab bar>              ← 32px
└── <div flex-1 flex>
    ├── Palette (w-60 or w-9 rail) ← 240px / 36px
    └── <div flex-1 relative canvas>
        ├── issues overlay (top-2 right-2, z-10)
        ├── <ReactFlow>: Background, Controls, ViewportSync, PortLegend, MiniMap
        ├── empty state (inset-0)
        ├── <QuickAddModal>
        ├── context menu (fixed, z-menu)
        └── "Connecting from…" badge (top-2 center)
```

Up to 5 simultaneous layers on the canvas + menu + modal.

### Interactions

- Stores: `useGraphStore`, `useGlobalGraphStore`,
  `useSignalGraphStore`.
- IPC: `diagnose_graph`, `.ssx` dialog, `importPlugin`/`reloadPlugins`.
- RF: 3× onNodesChange/EdgesChange/Connect, onConnectStart/End,
  onNodeDoubleClick/ContextMenu/Click, isValidConnection, deleteKeyCode.
- localStorage: `stagespace.portLegend.collapsed`.

### Precise problems

**Triplication**: 3 groups of nearly identical handlers (209-251);
`SIGNAL_ONLY/SUB_ONLY/GLOBAL_ONLY` filter duplicated verbatim palette vs
`allowedTypes` (653-657 vs 474-484); `if global/signal/else` branching
repeated in `trySpliceOnEdge`, `addNodeByType` and the JSX (316-324,
874-894); dead conditional — two identical branches (928-931).

**Sizes <44px**: tab bar h-8 (32px), buttons ≈20-22px, rail w-6 h-6
(24px), collapse w-5 h-5 (20px), palette items ≈26px, issues ≈24px.

**Ad hoc colors / tokens**: mix of `stagespace-*` and `gray-800/900`,
`purple/cyan/amber-700/800` (537-602); **hover by imperative DOM
mutation** `e.currentTarget.style.background =
getCategoryColor(type)+'20'` (688-693, 744-749); hardcodes `Background
color="#1e1e2e"` (913), `maskColor` (919), boxShadow
`rgba(34,197,94,0.6)` (166), `'#4b5563'` (670, duplicated schema:118);
**`z-10` violates the convention** (843, 1037 — z-overlay/z-raised
tokens exist).

**text-xs** ~40 occurrences + `text-[10px]`/`[11px]`.

**Logic in render / bugs**:
- `id: ${type}-${Date.now()}` — possible same-ms collision (39, 48).
- **Edge id `${source}-${target}` without handles** → two edges between
  same nodes = duplicated id (227, 244). F11.
- Cascade positioning `displayNodes.length * 30` + magics 250/150 (334,
  351).
- Hardcoded port names `'objects','duration','spline'` (500) —
  duplicates `port_type !== 'Positions'` of connectionRules:153; if a
  5th type arrives, divergence.
- **`onConnectEnd` navigates React Flow's internal DOM**
  (`closest('.react-flow__node')`, `dataset.handleid`) — will break on a
  markup change (402-413).
- **`onDoubleClick` on wrapper div** → MiniMap/Controls/PortLegend
  double-click opens QuickAdd via bubbling (469). F12.
- `fixed` context menu without viewport clamping (963-965).
- `useEffect` missing dep `editingSlotSignalGraph` (108-110).
- `diagnose_graph` serializes the graph on every keystroke, 200ms
  debounce, possible race with two in-flight runs (172-206).
- **Inconsistent edge style**: global/signal add `markerEnd` inline,
  sub delegates to the store → double source of truth (226 vs 248).
- Help footer duplicates PortLegend (826-836).
- `issuesOpen` not closable by outside click (857-867).
- `changes: any[]` (209-237), `_: any`, `as Edge` (228).
- `animated: edgesLive` global — all edges animate as soon as a move
  plays (513) — misleading.

**RF conventions**: `sourceHandle ?? 'out'`/`targetHandle ?? 'in'`
consistent; port-level validation mirroring the Rust validator +
rejection toast (good, 414-417); no `connectionRadius` configured.

**Verdict**: unfactored sub/global/signal triplication + ad hoc
imperative hover over 500 lines of JSX; the file carries 3
responsibilities. **High priority — split into
`NodePalette`/`GraphCanvas`/`useActiveGraphStore`.**

---

## 2. `components/CustomNode.tsx` (618 lines)

### Role

Single renderer for all node types (`type:'custom'`). Resolves the
schema (static params or plugin manifest), renders colored handles,
category header, live audio indicators, expandable params, special
sections (Linked Tracks, Spline Library, Track Range).

### Structure

`AUDIO_NODE_TYPES` (12), types (14-20), `CustomNode` (22-500): owner
graph resolution by id lookup across ×3 stores (28-33), plugin manifest
+ `pluginMissing` (37-51), ports (54-59,255), modulation dots (63-72),
live audio (81-89), `handleChange` debounce 150ms→`updateGraphLive`
(91-115), `renderInput` 6 types (121-240), trackIds (242-252), input
handles (260-274), JSX (277-497), `MiniBar` (502-513),
`SplineLibraryControls` (517-616).

### Precise problems

- **"Linked Tracks" duplicated 2×**: expanded slice(0,16) (383-407) vs
  collapsed slice(0,12) (423-447) — inconsistent thresholds;
  `SplineLibraryControls` mounted 2× (410, 418).
- **Input class repeated 7× verbatim** (151-593) + cyan variants —
  bypasses the shared `NodeParamField` mentioned at nodeParamSchema:215.
- Double debounce: 150ms local + 200ms store hot-swap + autoSave —
  triple timing per keystroke.
- Sizes: toggle w-9 h-5 (36×20), chevron ~16px, inputs 26px, chips
  18px, spline buttons 10px icons.
- Colors: `color+'60'/'20'` hex-alpha concat; A/B
  `text-blue-400`/`purple-400` **outside PORT_COLORS** while Ports
  Positions (gray) — semantic inconsistency; ~15 tokenless hues;
  **hardcoded `Slider accent="cyan"`** ignores the category.
- **Inline IIFE `track_range` parser in JSX** — split, parseInt, magics
  11/24 (457-475). Should be a tested util.
- vec3 edited as text `split(',')` — invalid input ignored, snap back
  (184-194).
- `commitTrackIds` cross-cutting side effect `setManualOscIds` (243-252).
- Owner detection O(n)×2 per render; **implicit priority by if order**
  (global>signal>move) (28-33, 102-109).
- Hardcoded `AUDIO_NODE_TYPES` — should derive from the catalog.
- Handles `!w-3 !h-3` = 12px (270, 493).
- Labels `p.name` instead of `p.label` (361).
- Unresolved plugin: 5-port superset in handles, A/B labels only if
  `kind==='composite'` — inconsistent transient.
- `issueMessages` off-type cast, native tooltip on the whole node (280).
- `expanded` not persisted; `hover:shadow-xl` paint cost on dozens of
  nodes.
- **No `nodrag`** on inputs/selects/buttons — node drag risk on
  mousedown.
- `Spline ${toLocaleTimeString()}` — locale-dependent, non-sortable
  (590).

**Verdict**: a single 500-line component for all types, duplicated
expanded/collapsed sections, ×7 input class, 10-20px mini-controls.
**High priority — extract `NodeParamField`, `LinkedTracksSection`,
`TrackRangeSection`, share expanded/collapsed.**

---

## 3. `components/nodeParamSchema.ts` (275 lines)

### Role

Adaptation layer of the generated Rust catalog (`nodeSpecs.json`) → UI:
`PARAM_SCHEMA`, `NODE_CATEGORIES`, `NODE_COLORS`, scopes, descriptions,
defaults, plugin helpers, `prepareGraphForSave`.

### Precise problems

- `ParamType`: `'text' | 'string'` two identical variants (8);
  unvalidated `p.kind as ParamType` cast → silently null renderInput.
- `vec3` and `track_ids` = both `number[]` — type conflation (12).
- `JSON.parse(p.default_json)` **without try/catch** — malformed
  catalog = crash (124).
- `any` leaks: `getDefaultParams`, `mergeDefaultParams`,
  `prepareGraphForSave` (140-190).
- **`getValidTargetTypes` excludes `to === from`**: Scale→Scale
  (Positions→Positions, valid) absent from the "Can connect to"
  tooltip — the tooltip lies (162).
- `NODE_COLORS` ad hoc hex partially duplicating the tokens; repeated
  `'#4b5563'` fallback.
- `CATEGORY_META`: palette order and FR/EN labels frozen, no i18n.
- `prepareGraphForSave`: graph mutator in a schema file — off-topic,
  should live in `graphSerializer.ts` (179-190).
- `ENGINE_TYPES`/`NON_PARAM_NODES`: NodeParamsPanel presentation logic
  lodged in the schema — UI↔data coupling (195-209).
- `GraphNodeData.pinned`: orphaned UI field — no code in the 3 files
  reads/writes it; invisible parallel channel (19-23).
- `GraphNodeData.label/type/params` optional although `createNode`
  always provides them → ~20 `as`/`??` casts in consumers.

**Verdict**: healthy file (the only real abstraction layer of the 3)
but semi-typed — lax unions, `any`, orphaned `pinned`. **Medium
priority — tighten `NodeParamValue` into a kind-discriminated union,
type the `*ForSave` helpers, make the data fields required.**

## Lot 1 synthesis

| Axis | Finding |
|---|---|
| Triplication | 3 graphs → 3× handlers/filters (NodeEditor 209-251, 316-324, 474-657) |
| Duplication | Linked Tracks ×2 (16/12 thresholds), input ×7, SplineLibrary ×2 |
| Tokens | stagespace-* + gray/purple/cyan/amber ad hoc + z-10 violating the convention |
| Handles | top/bottom consistent, shared PORT_COLORS, but A/B outside PORT_COLORS, name≠label |
| Latent bugs | edge-id without handles (F11), wrapper dbl-click (F12), `getValidTargetTypes` excludes self, unguarded `JSON.parse` |

Actions: extract `NodePalette`/`GraphCanvas`/`useActiveGraphStore`;
factor `NodeParamField` + sections; fix edge-id (include handles) and
bubbling; z-10→tokens, imperative hover→classes.
