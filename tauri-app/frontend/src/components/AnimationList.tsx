import React from 'react';
import { Hexagon, X } from 'lucide-react';
import { useAnimationStore, Animation } from '../store/useAnimationStore';
import { useGraphStore } from '../store/useGraphStore';
import { SHAPE_PRESETS, type ShapePreset } from '../utils/shapePresets';

// Icône pour une animation — dérivée du node engine principal du graphe
function animIcon(anim: Animation): string {
  if (anim.graph_json?.nodes) {
    const engineTypes = ['Circular', 'Elliptical', 'Spiral', 'Lissajous', 'Figure8',
      'Linear', 'Oscillation', 'Formation', 'PerlinNoise', 'Converge', 'Pendulum',
      'RoseCurve', 'Helix', 'Wave', 'CustomTrajectory',
      'Bouncing', 'Avoidance', 'Spring', 'Follow', 'Swarm', 'VectorField',
      'DrawSpline', 'EvaluateSpline', 'Mix', 'Group', 'Sequence', 'Crossfade'];
    for (const type of engineTypes) {
      if (anim.graph_json.nodes.some((n: { data?: { type?: string } }) => n.data?.type === type)) {
        const preset = SHAPE_PRESETS.find((p) => p.id.toLowerCase() === type.toLowerCase());
        if (preset) return preset.icon;
        return '◆';
      }
    }
  }
  return '◆';
}

const CATEGORY_LABELS: Record<ShapePreset['category'], { label: string; color: string }> = {
  basic: { label: 'Basic', color: 'text-blue-400' },
  modifier: { label: 'Modifiers', color: 'text-pink-400' },
  composite: { label: 'Composite', color: 'text-purple-400' },
  spline: { label: 'Splines', color: 'text-cyan-400' },
  physics: { label: 'Physics', color: 'text-green-400' },
  audio: { label: 'Audio', color: 'text-yellow-400' },
};

const CATEGORY_ORDER: ShapePreset['category'][] = ['basic', 'modifier', 'composite', 'spline', 'physics', 'audio'];

export default function AnimationList() {
  const animations = useAnimationStore((s) => s.animations);
  const current = useAnimationStore((s) => s.current);
  const saveAnimation = useAnimationStore((s) => s.saveAnimation);
  const deleteAnimation = useAnimationStore((s) => s.deleteAnimation);
  const loadAnimation = useAnimationStore((s) => s.loadAnimation);
  const renameAnimation = useAnimationStore((s) => s.renameAnimation);
  const applyShapePreset = useGraphStore((s) => s.applyShapePreset);
  const getSelectedOscIds = useGraphStore((s) => s.getSelectedOscIds);
  const addMoveSlot = useGraphStore((s) => s.addMoveSlot);
  const editingSlotId = useGraphStore((s) => s.editingSlotId);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState('');
  const [collapsedCats, setCollapsedCats] = React.useState<Set<string>>(new Set(['modifier', 'composite', 'spline', 'physics', 'audio']));

  // "+" crée un nouveau SLOT (l'unité de travail unifiée — un `current`
  // orphelin sans slot n'arrivait jamais au moteur). addMoveSlot
  // auto-sélectionne le slot pour édition.
  const handleNew = () => {
    addMoveSlot();
  };

  const startRename = (anim: Animation) => {
    setEditingId(anim.id);
    setEditName(anim.name);
  };

  const commitRename = () => {
    if (editingId) {
      renameAnimation(editingId, editName);
    }
    setEditingId(null);
  };

  const handleTemplateClick = (preset: ShapePreset) => {
    const ids = getSelectedOscIds();
    const nObjects = ids.length > 0 ? ids.length : 8;
    applyShapePreset(preset.id, nObjects);
  };

  const toggleCat = (cat: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const presetsByCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    presets: SHAPE_PRESETS.filter((p) => p.category === cat),
  })).filter((g) => g.presets.length > 0);

  return (
    <div className="h-full flex flex-col bg-stagespace-panel">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700/50 flex items-center gap-2">
        <span className="text-gray-300 text-[11px] font-semibold uppercase tracking-wider flex-1">Templates</span>
        <button onClick={handleNew} className="text-blue-400 hover:text-blue-300 text-sm font-bold" title="Nouveau move (slot)">+</button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* ═══ TEMPLATES (built-in presets) ═══ */}
        <div className="p-2 space-y-1">
          <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-1 px-1">Templates</div>

          {presetsByCategory.map((group) => {
            const isCollapsed = collapsedCats.has(group.cat);
            const catLabel = CATEGORY_LABELS[group.cat];
            return (
              <div key={group.cat}>
                <button
                  onClick={() => toggleCat(group.cat)}
                  className="w-full flex items-center gap-1 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wider hover:text-gray-300 transition-colors"
                >
                  <span className="text-[7px] text-gray-600">{isCollapsed ? '▸' : '▾'}</span>
                  <span className={catLabel.color}>{catLabel.label}</span>
                  <span className="text-gray-700 ml-auto">{group.presets.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="space-y-0.5 mt-0.5">
                    {group.presets.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => handleTemplateClick(preset)}
                        title={preset.description}
                        className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded border transition-all cursor-pointer bg-gray-800/40 border-gray-700/40 hover:border-gray-600 hover:bg-gray-800/60"
                      >
                        <span className="text-sm flex-shrink-0">{preset.icon}</span>
                        <span className="text-gray-300 text-[11px] flex-1 truncate">{preset.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Separator */}
        <div className="border-t border-gray-700/40 mx-2 my-2" />

        {/* ═══ EN COURS D'ÉDITION ═══ */}
        <div className="px-2 pb-2">
          <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-1 px-1">En cours d'édition</div>
          <div className="flex items-center gap-2 px-2 py-1.5 bg-blue-900/30 rounded border border-blue-700/40">
            <span className="text-base">{animIcon(current)}</span>
            {editingId === current.id ? (
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null); }}
                autoFocus
                className="flex-1 bg-gray-900 text-white text-[11px] rounded px-1 py-0.5 border border-blue-500 outline-none"
              />
            ) : (
              <span
                className="text-white text-[11px] font-medium flex-1 truncate cursor-text"
                onDoubleClick={() => startRename(current)}
                title="Double-clic pour renommer"
              >{current.name}</span>
            )}
            <div className="flex items-center gap-0.5">
              {current.graph_json?.nodes && (
                <span className="text-purple-400 text-[10px] font-mono bg-purple-900/40 px-1 rounded" title="Graphe custom"><Hexagon size={9} /></span>
              )}
              {current.assignments.length > 0 && (
                <span className="text-blue-400 text-[10px] font-mono bg-blue-900/40 px-1 rounded" title={`${current.assignments.length} tracks`}>
                  ◉{current.assignments.length}
                </span>
              )}
            </div>
          </div>
          <button onClick={saveAnimation}
            className="w-full mt-1.5 py-1.5 bg-purple-700 hover:bg-purple-600 text-white text-[10px] rounded font-medium transition-colors">
            ★ Sauvegarder dans ma bibliothèque
          </button>
        </div>

        {/* ═══ BIBLIOTHÈQUE (presets utilisateur — chargés dans le slot sélectionné) ═══ */}
        <div className="p-2 space-y-1">
          <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-1 px-1">Bibliothèque</div>
          {animations.length === 0 ? (
            <div className="text-gray-600 text-[10px] text-center py-4 bg-gray-800/30 rounded border border-gray-700/30">
              Aucun graphe sauvegardé
              <div className="text-gray-700 text-[10px] mt-1">Clique Sauvegarder pour ajouter</div>
            </div>
          ) : (
            animations.map((anim) => {
              const isCurrent = current.id === anim.id;
              const hasGraph = !!anim.graph_json?.nodes;
              return (
                <div key={anim.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded border transition-all cursor-pointer group ${
                    isCurrent
                      ? 'bg-blue-900/30 border-blue-700/40'
                      : 'bg-gray-800/40 border-gray-700/40 hover:border-gray-600'
                  }`}
                  onClick={() => loadAnimation(anim)}>
                  <span className="text-sm">{animIcon(anim)}</span>
                  {editingId === anim.id ? (
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null); }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                      className="flex-1 bg-gray-900 text-white text-[11px] rounded px-1 py-0.5 border border-blue-500 outline-none"
                    />
                  ) : (
                    <span
                      className="text-white text-[11px] flex-1 truncate"
                      onDoubleClick={(e) => { e.stopPropagation(); startRename(anim); }}
                      title="Double-clic pour renommer"
                    >{anim.name}</span>
                  )}
                  <div className="flex items-center gap-0.5">
                    {hasGraph && (
                      <span className="text-purple-400 text-[10px] font-mono bg-purple-900/40 px-1 rounded" title="Graphe custom (node editor)"><Hexagon size={9} /></span>
                    )}
                    {anim.assignments.length > 0 && (
                      <span className="text-blue-400 text-[10px] font-mono bg-blue-900/40 px-1 rounded" title={`${anim.assignments.length} tracks`}>
                        ◉{anim.assignments.length}
                      </span>
                    )}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); deleteAnimation(anim.id); }}
                    className="text-red-400 hover:text-red-300 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"><X size={10} /></button>
                </div>
              );
            })
          )}
        </div>

        {/* Hint */}
        <div className="text-gray-700 text-[10px] text-center py-2 px-2">
          Templates &amp; bibliothèque = presets appliqués au slot sélectionné
          <div className="mt-0.5">
            {editingSlotId ? 'Chargement → écrit dans le slot en édition' : 'Sélectionnez un slot (Moves) pour appliquer'}
            {' '}· double-clic pour renommer
          </div>
        </div>
      </div>
    </div>
  );
}
