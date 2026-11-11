import React from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import {
  NODE_CATEGORIES, NODE_COLORS, NODE_DESCRIPTIONS, getCategoryColor,
  getValidTargetTypes, GLOBAL_ONLY_NODES, SUB_ONLY_NODES, SIGNAL_ONLY_NODES,
} from '../nodeParamSchema';
import type { NodeType } from '../../store/useGraphStore';
import type { PluginManifest } from '../../types/generated/PluginManifest';
import { PALETTE_DRAG_MIME, type PaletteDragPayload } from '../../hooks/useNodeInsertion';

/// Palette de nodes — extraite de NodeEditor (P2.4). Gère le rail replié,
/// les catégories filtrées par tab (sub/global/signal), les items natifs +
/// plugins WASM avec tooltips, l'import/rescan .ssx et le footer d'aide.
/// Le domaine signal est isolé : seuls les nodes Signal dans le tab Mods.
interface NodePaletteProps {
  collapsed: boolean;
  onToggleCollapsed: (v: boolean) => void;
  onQuickAdd: () => void;
  /// Edge unique sélectionnée → hint "click a modifier to insert".
  edgeSelected: boolean;
  activeTab: 'sub' | 'global' | 'signal';
  collapsedCats: Set<string>;
  onToggleCat: (label: string) => void;
  hovered: string | null;
  onHover: (key: string | null) => void;
  onAddNode: (type: NodeType) => void;
  onAddPluginNode: (m: PluginManifest) => void;
  /// Node « frame » — annotation UI-only (jamais câblé ni compilé).
  onAddFrame: () => void;
  plugins: PluginManifest[];
  pluginsLoaded: boolean;
  pluginsDir: string | null;
  pluginErrors: string[];
  importPlugin: (path: string) => Promise<unknown>;
  reloadPlugins: () => Promise<unknown>;
}

/// Amorce le drag palette → canvas (dataTransfer typé — le drop est
/// filtré côté canvas sur ce MIME). Poser sur un fil = splice direct.
const startNodeDrag = (e: React.DragEvent, payload: PaletteDragPayload) => {
  e.dataTransfer.setData(PALETTE_DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = 'copy';
};

export const NodePalette: React.FC<NodePaletteProps> = (p) => {
  if (p.collapsed) {
    return (
      <div className="w-9 bg-stagespace-panel border-r border-stagespace-border flex-shrink-0 flex flex-col items-center pt-2 gap-2">
        <button
          onClick={() => p.onToggleCollapsed(false)}
          className="w-6 h-6 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white flex items-center justify-center"
          title="Show the node palette"
        >
          <PanelLeftOpen size={12} />
        </button>
        <button
          onClick={p.onQuickAdd}
          className="w-6 h-6 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white flex items-center justify-center text-xs font-bold"
          title="Quick-add node (Ctrl+K)"
        >
          +
        </button>
      </div>
    );
  }

  return (
    <div className="w-60 bg-stagespace-panel border-r border-stagespace-border overflow-y-auto flex-shrink-0">
      <div className="px-3 py-3 border-b border-stagespace-border sticky top-0 bg-stagespace-panel z-raised flex items-start gap-2">
        <div className="flex-1">
          <h3 className="text-white font-semibold text-sm">Nodes</h3>
          <p className="text-gray-500 text-xs mt-0.5">
            {p.edgeSelected
              ? 'Edge selected — click a modifier to insert it into the chain'
              : 'Click or drag onto canvas · Ctrl+K quick-add · Hover for info'}
          </p>
        </div>
        <button
          onClick={() => p.onToggleCollapsed(true)}
          className="w-5 h-5 rounded text-gray-500 hover:text-white hover:bg-gray-800 flex items-center justify-center flex-shrink-0"
          title="Collapse the palette — Ctrl+K stays available"
        >
          <PanelLeftClose size={11} />
        </button>
      </div>

      <div className="p-2 space-y-2">
        {NODE_CATEGORIES.map((cat) => {
          // Filtrer les types selon le tab actif — le domaine signal
          // (modulation scalaire) est isolé : seuls les nodes Signal dans
          // le tab Mods, jamais dans les graphes move/global.
          const filteredTypes = p.activeTab === 'signal'
            ? cat.types.filter((t) => SIGNAL_ONLY_NODES.has(t))
            : p.activeTab === 'global'
              ? cat.types.filter((t) => !SUB_ONLY_NODES.has(t) && !SIGNAL_ONLY_NODES.has(t))
              : cat.types.filter((t) => !GLOBAL_ONLY_NODES.has(t) && !SIGNAL_ONLY_NODES.has(t));
          // Skip la catégorie si elle n'a plus de types après le filtrage
          if (filteredTypes.length === 0) return null;
          const isCollapsed = p.collapsedCats.has(cat.label);
          return (
            <div key={cat.label}>
              <button
                onClick={() => p.onToggleCat(cat.label)}
                className="w-full flex items-center gap-1 text-gray-500 text-xs font-semibold mb-1 px-1 uppercase tracking-wider hover:text-gray-300 transition-colors"
              >
                <span className="text-xs">{isCollapsed ? '▸' : '▾'}</span>
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: NODE_COLORS[cat.color] ?? '#4b5563' }}
                />
                {cat.label}
                <span className="text-gray-500 ml-auto">{filteredTypes.length}</span>
              </button>
              {!isCollapsed && (
                <div className="space-y-0.5">
                  {filteredTypes.map((type) => (
                    <div
                      key={type}
                      className="relative"
                      onMouseEnter={() => p.onHover(type)}
                      onMouseLeave={() => p.onHover(null)}
                    >
                      <button
                        onClick={() => p.onAddNode(type)}
                        draggable
                        onDragStart={(e) => startNodeDrag(e, { kind: 'type', type })}
                        className="w-full text-left px-2.5 py-1.5 text-white text-xs rounded transition-all hover:translate-x-0.5 flex items-center gap-2 group cursor-grab active:cursor-grabbing"
                        style={{ background: 'transparent' }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = getCategoryColor(type) + '20';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: getCategoryColor(type) }}
                        />
                        {type}
                      </button>
                      {/* Tooltip description */}
                      {p.hovered === type && NODE_DESCRIPTIONS[type] && (
                        <div className="absolute left-full top-0 ml-2 z-popover w-64 p-2.5 bg-gray-900 border border-gray-700 rounded-lg shadow-xl text-gray-300 text-xs leading-relaxed pointer-events-none">
                          <div className="text-white font-semibold text-xs mb-1" style={{ color: getCategoryColor(type) }}>{type}</div>
                          {NODE_DESCRIPTIONS[type]}
                          {/* Show valid targets */}
                          {(() => {
                            const targets = getValidTargetTypes(type);
                            if (targets.length === 0) return null;
                            return (
                              <div className="mt-1.5 pt-1.5 border-t border-gray-700">
                                <div className="text-gray-500 text-xs uppercase">Can connect to:</div>
                                <div className="text-gray-400 text-xs mt-0.5 flex flex-wrap gap-1">
                                  {targets.slice(0, 8).map((t) => (
                                    <span key={t} className="px-1 py-0.5 bg-gray-800 rounded">{t}</span>
                                  ))}
                                  {targets.length > 8 && <span className="text-gray-400">+{targets.length - 8}</span>}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {/* Plugins WASM — un item par manifeste chargé dans le
                  registry backend (sub-graph uniquement : 'Plugin' est
                  SUB_ONLY → la catégorie est vide en tab global). */}
              {!isCollapsed && cat.label === 'Plugins' && p.activeTab === 'sub' && (
                <div className="space-y-0.5">
                  {p.plugins.map((m) => (
                    <div
                      key={m.id}
                      className="relative"
                      onMouseEnter={() => p.onHover(`plugin:${m.id}`)}
                      onMouseLeave={() => p.onHover(null)}
                    >
                      <button
                        onClick={() => p.onAddPluginNode(m)}
                        draggable
                        onDragStart={(e) => startNodeDrag(e, { kind: 'plugin', manifest: m })}
                        className="w-full text-left px-2.5 py-1.5 text-white text-xs rounded transition-all hover:translate-x-0.5 flex items-center gap-2 cursor-grab active:cursor-grabbing"
                        style={{ background: 'transparent' }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = (NODE_COLORS.yellow ?? '#ca8a04') + '20';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: NODE_COLORS.yellow }}
                        />
                        <span className="truncate">{m.name}</span>
                        {m.kind !== 'engine' && (
                          <span
                            className="text-[11px] font-bold tracking-wide flex-shrink-0 px-1 rounded bg-sky-900/60 text-sky-300"
                            title={m.kind === 'modifier' ? 'Modifier: wraps one trajectory (input port)' : 'Composite: combines 2 trajectories (A/B ports)'}
                          >
                            {m.kind === 'modifier' ? 'MOD' : '2IN'}
                          </span>
                        )}
                        <span className="text-gray-400 text-[11px] ml-auto flex-shrink-0">v{m.version}</span>
                      </button>
                      {p.hovered === `plugin:${m.id}` && (
                        <div className="absolute left-full top-0 ml-2 z-popover w-64 p-2.5 bg-gray-900 border border-gray-700 rounded-lg shadow-xl text-gray-300 text-xs leading-relaxed pointer-events-none">
                          <div className="text-white font-semibold text-xs mb-1" style={{ color: NODE_COLORS.yellow }}>
                            {m.name} <span className="text-gray-500 font-normal">v{m.version}</span>
                          </div>
                          {m.description ?? 'External WASM plugin'}
                          {m.author && (
                            <div className="mt-1 text-gray-500">by {m.author}</div>
                          )}
                          <div className="mt-1 text-gray-400 font-mono">id: {m.id}</div>
                        </div>
                      )}
                    </div>
                  ))}
                  {p.pluginsLoaded && p.plugins.length === 0 && (
                    <div className="px-2.5 py-1 text-gray-400 text-xs leading-snug">
                      No plugin loaded
                      {p.pluginsDir && (
                        <div className="font-mono text-gray-500 break-all mt-0.5" title={p.pluginsDir}>
                          {p.pluginsDir}
                        </div>
                      )}
                    </div>
                  )}
                  {p.pluginErrors.map((e, i) => (
                    <div
                      key={i}
                      className="px-2.5 text-red-400/80 text-[11px] font-mono truncate"
                      title={e}
                    >
                      ⚠ {e}
                    </div>
                  ))}
                  <button
                    onClick={async () => {
                      const selected = await open({
                        filters: [{ name: 'STAGESPACE plugin', extensions: ['ssx'] }],
                        multiple: false,
                      });
                      if (typeof selected === 'string') void p.importPlugin(selected);
                    }}
                    className="w-full text-left px-2.5 py-1 text-gray-500 hover:text-yellow-400 text-xs rounded transition-colors"
                    title="Import a .ssx bundle (copy + rescan)"
                  >
                    + Import .ssx…
                  </button>
                  <button
                    onClick={() => void p.reloadPlugins()}
                    className="w-full text-left px-2.5 py-1 text-gray-500 hover:text-yellow-400 text-xs rounded transition-colors"
                    title="Rescan the plugins folder"
                  >
                    ↻ Rescan plugins
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Help footer */}
      <div className="p-3 border-t border-stagespace-border mt-2">
        <button
          onClick={p.onAddFrame}
          className="w-full mb-2 px-2.5 py-1.5 rounded text-xs text-amber-300/80 border border-dashed border-amber-500/40 hover:border-amber-400/70 hover:text-amber-200 transition-colors"
          title="Add a resizable annotation frame — UI only, never sent to the engine"
        >
          ▭ + Frame
        </button>
        <div className="text-gray-400 text-xs leading-relaxed space-y-1">
          <div><span className="text-gray-400 font-semibold">Flow:</span> Objects → Engine → Output</div>
          <div><span className="text-gray-400 font-semibold">Chain:</span> Engine → Modifier → Output</div>
          <div><span className="text-gray-400 font-semibold">Blend:</span> 2 Engines → Mix → Output</div>
          <div><span className="text-gray-400 font-semibold">Time:</span> 2 Engines → Sequence/Crossfade</div>
          <div className="pt-1"><span className="text-gray-400 font-semibold">Edges:</span> <span className="text-gray-300">gray</span> trajectory · <span className="text-amber-500">amber dashes</span> duration · <span className="text-violet-400">violet</span> spline</div>
          <div className="pt-1 text-gray-500">Drag from a node's bottom handle to connect. Invalid connections are blocked.</div>
        </div>
      </div>
    </div>
  );
};

export default NodePalette;
