import React from 'react';
import Modal from './ui/Modal';
import type { NodeType } from '../store/useGraphStore';
import { NODE_DESCRIPTIONS, getCategoryColor } from './nodeParamSchema';
import type { PluginManifest } from '../types/generated/PluginManifest';

/// Quick-add (pattern plugdata/Ctrl+K) : palette searchable flottante —
/// taper pour filtrer, ↑↓ pour naviguer, Enter pour poser le node.
/// Les ajouts passent par les callbacks de NodeEditor → l'autopatch
/// s'applique si une edge est sélectionnée.
type QuickItem =
  | { kind: 'type'; type: NodeType; label: string; hint: string }
  | { kind: 'plugin'; manifest: PluginManifest; label: string; hint: string };

const KIND_BADGE: Record<string, string> = { engine: 'ENG', modifier: 'MOD', composite: '2IN' };

export const QuickAddModal: React.FC<{
  types: NodeType[];
  plugins: PluginManifest[];
  onAddType: (t: NodeType) => void;
  onAddPlugin: (m: PluginManifest) => void;
  onClose: () => void;
  /// Contexte wire-drop — "from Circular · Positions" : la liste est déjà
  /// filtrée par le parent au type de port du fil lâché.
  contextHint?: string;
}> = ({ types, plugins, onAddType, onAddPlugin, onClose, contextHint }) => {
  const [query, setQuery] = React.useState('');
  const [selIdx, setSelIdx] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  const items = React.useMemo<QuickItem[]>(() => {
    const all: QuickItem[] = [
      ...types.map((t) => ({
        kind: 'type' as const,
        type: t,
        label: t,
        hint: NODE_DESCRIPTIONS[t] ?? '',
      })),
      ...plugins.map((m) => ({
        kind: 'plugin' as const,
        manifest: m,
        label: m.name,
        hint: `Plugin ${KIND_BADGE[m.kind] ?? m.kind} v${m.version}`,
      })),
    ];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        it.hint.toLowerCase().includes(q) ||
        (it.kind === 'plugin' && it.manifest.id.toLowerCase().includes(q)),
    );
  }, [types, plugins, query]);

  // La sélection suit le filtre — reset quand la liste change.
  React.useEffect(() => setSelIdx(0), [query]);

  const pick = (it: QuickItem | undefined) => {
    if (!it) return;
    if (it.kind === 'type') onAddType(it.type);
    else onAddPlugin(it.manifest);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelIdx((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(items[selIdx]);
    }
  };

  // Garder l'item sélectionné visible dans la liste scrollable.
  // (scrollIntoView absent de jsdom — guard pour les tests.)
  React.useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selIdx}"]`) as HTMLElement | null;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [selIdx]);

  return (
    <Modal title="Add node" onClose={onClose} widthClass="max-w-sm">
      <div className="px-4 py-3" onKeyDown={onKeyDown}>
        {contextHint && (
          <div className="text-cyan-400 text-[11px] font-mono mb-2">{contextHint}</div>
        )}
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a node or plugin…"
          className="w-full px-3 py-1.5 mb-2 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-cyan-500 focus:outline-none"
        />
        <div ref={listRef} className="max-h-64 overflow-y-auto space-y-0.5">
          {items.length === 0 && (
            <div className="text-gray-400 text-xs py-3 text-center">
              No node matches '{query}'.
            </div>
          )}
          {items.map((it, i) => (
            <button
              key={it.kind === 'plugin' ? `p-${it.manifest.id}` : `t-${it.type}`}
              data-idx={i}
              onClick={() => pick(it)}
              onMouseEnter={() => setSelIdx(i)}
              className={`w-full text-left px-2.5 py-1.5 rounded text-xs flex items-center gap-2 transition-colors ${
                i === selIdx ? 'bg-cyan-900/50 text-white' : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{
                  background:
                    it.kind === 'type' ? getCategoryColor(it.type) : '#a855f7',
                }}
              />
              <span className="font-medium">{it.label}</span>
              {it.kind === 'plugin' && (
                <span className="text-[11px] px-1 rounded bg-purple-900/60 text-purple-300 font-mono">
                  {KIND_BADGE[it.manifest.kind] ?? it.manifest.kind}
                </span>
              )}
              {it.hint && (
                <span className="ml-auto text-xs text-gray-400 truncate max-w-[45%]">
                  {it.hint}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="text-gray-500 text-[11px] pt-2">
          ↑↓ navigate · Enter add · Esc close — inserts into a selected edge.
        </div>
      </div>
    </Modal>
  );
};

export default QuickAddModal;
