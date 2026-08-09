import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useAnimationStore } from '../store/useAnimationStore';
import { SHAPE_PRESETS } from '../utils/shapePresets';

/// MovesTable — la table des moves (concept unifié)
/// Tout est un Move. Certains moves sont dans la setlist (l'ordre du spectacle).
///
/// Workflow:
///   1. "+ Move" → nouveau slot (template + tracks)
///   2. Configurer template + tracks + macros
///   3. ▶ Play → lance ce move (live, parallèle possible)
///   4. ★ Add to setlist → ajoute à l'ordre du spectacle
///   5. GO → stoppe les moves actifs + lance le prochain move de la setlist
export default function MovesTable() {
  const {
    moveSlots, addMoveSlot, removeMoveSlot, renameMoveSlot,
    setSlotTemplate, setSlotTracks, setSlotMacros, setSlotFadeDuration,
    toggleSlotPreview,
    playSlot, stopSlot, stopSlotWithFade,
    goAllSlots, stopAllSlots,
    editSlotGraph, saveEditorToSlot,
    setlistOrder, currentSetlistIndex,
    addToSetlist, removeFromSetlist, moveSetlistItem, goToNextMove,
    holProject, manualOscIds, movements, refreshMovements,
    editingSlotId, selectSlotForEditing,
    pendingPlays,
  } = useGraphStore();

  const showExpert = useAnimationStore((s) => s.showExpert);
  const setShowExpert = useAnimationStore((s) => s.setShowExpert);

  // Sync initial au montage — le polling est remplacé par le listener
  // active-moves-update dans useGraphStore
  React.useEffect(() => {
    refreshMovements();
  }, [refreshMovements]);

  // Tous les tracks disponibles pour le picker
  const allTrackIds = holProject
    ? holProject.tracks.map((t) => t.id)
    : manualOscIds;

  const playingCount = moveSlots.filter((s) => s.movementId).length;
  const stoppedCount = moveSlots.length - playingCount;

  // ─── Track Picker (modal inline) ───
  const [editingTracksFor, setEditingTracksFor] = React.useState<string | null>(null);
  const [tempTrackIds, setTempTrackIds] = React.useState<number[]>([]);

  const openTrackPicker = (slotId: string, currentTracks: number[]) => {
    setEditingTracksFor(slotId);
    setTempTrackIds([...currentTracks]);
  };
  const confirmTrackPicker = () => {
    if (editingTracksFor) {
      setSlotTracks(editingTracksFor, tempTrackIds);
    }
    setEditingTracksFor(null);
  };

  // ─── Template Picker (dropdown inline) ───
  const [editingTemplateFor, setEditingTemplateFor] = React.useState<string | null>(null);

  // ─── Rename (input inline) ───
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [tempName, setTempName] = React.useState('');

  // ─── Macros editor (modal inline) ───
  const [editingMacrosFor, setEditingMacrosFor] = React.useState<string | null>(null);

  // ─── GO feedback ───
  const [goFeedback, setGoFeedback] = React.useState<string | null>(null);

  // Templates basiques pour le dropdown
  const basicTemplates = SHAPE_PRESETS.filter((p) => p.category === 'basic' || p.category === 'composite');

  // Setlist info
  const nextSetlistSlotId = currentSetlistIndex >= 0 && currentSetlistIndex + 1 < setlistOrder.length
    ? setlistOrder[currentSetlistIndex + 1]
    : setlistOrder.length > 0 && currentSetlistIndex < 0
      ? setlistOrder[0]
      : null;
  const nextSetlistSlot = nextSetlistSlotId ? moveSlots.find((s) => s.id === nextSetlistSlotId) : null;

  const handleGO = async () => {
    const msg = await goToNextMove();
    if (msg) {
      setGoFeedback(msg);
      setTimeout(() => setGoFeedback(null), 3000);
    }
  };

  return (
    <div className="h-full flex flex-col bg-stagespace-panel">
      {/* ═══ Header ═══ */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-stagespace-border flex-shrink-0">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center flex-shrink-0">
          <span className="text-white text-[10px] font-bold">MV</span>
        </div>
        <h3 className="text-white font-semibold text-sm">Moves</h3>
        <div className="flex-1" />
        {moveSlots.length > 0 && (
          <span className="text-[10px] font-mono text-gray-500">
            {playingCount > 0 && <span className="text-green-400">{playingCount} live</span>}
            {playingCount > 0 && stoppedCount > 0 && <span className="text-gray-600"> / </span>}
            {stoppedCount > 0 && <span className="text-gray-400">{stoppedCount} prêt{stoppedCount > 1 ? 's' : ''}</span>}
          </span>
        )}
      </div>

      {/* ═══ Toolbar ═══ */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-stagespace-border flex-shrink-0">
        <button
          onClick={addMoveSlot}
          className="px-2 py-1 bg-indigo-900/50 hover:bg-indigo-800/60 text-indigo-300 text-[10px] rounded font-medium transition-colors border border-indigo-800/40"
          title="Ajouter un move à la setlist"
        >
          + Move
        </button>
        {moveSlots.length > 0 && (
          <>
            <button
              onClick={goAllSlots}
              disabled={stoppedCount === 0}
              className="px-2 py-1 bg-green-900/50 hover:bg-green-800/60 text-green-300 text-[10px] rounded font-medium transition-colors border border-green-800/40 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Lancer tous les moves arrêtés"
            >
              ▶ GO All
            </button>
            <button
              onClick={stopAllSlots}
              disabled={playingCount === 0}
              className="px-2 py-1 bg-red-900/50 hover:bg-red-800/60 text-red-300 text-[10px] rounded font-medium transition-colors border border-red-800/40 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Arrêter tous les moves actifs"
            >
              ■ Stop All
            </button>
          </>
        )}
      </div>

      {/* ═══ Barre GO (setlist du spectacle) ═══ */}
      {setlistOrder.length > 0 && (
        <div className="px-3 py-2 border-b border-stagespace-border flex-shrink-0 bg-gray-900/40">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-400 text-[9px] uppercase tracking-wider">Setlist</span>
            <span className="text-gray-600 text-[9px] font-mono">
              {currentSetlistIndex + 1 >= 0 ? `${currentSetlistIndex + 1}/${setlistOrder.length}` : `0/${setlistOrder.length}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-white text-[11px] font-semibold truncate">
                {nextSetlistSlot?.name ?? '— (fin de setlist)'}
              </div>
              {nextSetlistSlot && (
                <div className="text-gray-500 text-[9px]">
                  {nextSetlistSlot.trackIds.length} tracks · fade {nextSetlistSlot.fadeDuration.toFixed(1)}s
                </div>
              )}
            </div>
            <button
              onClick={handleGO}
              disabled={!nextSetlistSlotId}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-bold rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
              title="GO : passe au prochain move de la setlist"
            >
              GO ▶
            </button>
          </div>
          {goFeedback && (
            <div className="text-green-400 text-[10px] mt-1 text-center animate-pulse">{goFeedback}</div>
          )}
        </div>
      )}

      {/* ═══ Table ═══ */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {moveSlots.length === 0 ? (
          <div className="text-gray-600 text-[11px] text-center py-8 px-4">
            <div className="text-gray-500 mb-2 text-sm">Aucun move configuré</div>
            <div className="text-gray-600 text-[10px] mb-3">
              Clique « + Move » pour créer un slot.<br />
              Chaque slot = un template + des tracks.<br />
              Lance plusieurs slots en parallèle avec « GO All ».
            </div>
            <button
              onClick={addMoveSlot}
              className="px-3 py-1.5 bg-indigo-900/50 hover:bg-indigo-800/60 text-indigo-300 text-[11px] rounded font-medium transition-colors border border-indigo-800/40"
            >
              + Créer le premier move
            </button>
          </div>
        ) : (
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-stagespace-panel border-b border-stagespace-border">
              <tr className="text-gray-500 text-[9px] uppercase tracking-wider">
                <th className="text-left px-2 py-1 w-6">#</th>
                <th className="text-left px-2 py-1">Nom</th>
                <th className="text-left px-2 py-1 w-24">Template</th>
                <th className="text-left px-2 py-1 w-20">Tracks</th>
                <th className="text-center px-1 py-1 w-12">Set</th>
                <th className="text-center px-1 py-1 w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {moveSlots.map((slot, idx) => {
                const isPlaying = !!slot.movementId || pendingPlays.includes(slot.id);
                const mv = movements.find((m) => m.id === slot.movementId);
                const preset = SHAPE_PRESETS.find((p) => p.id === slot.templateId);
                const isSelected = editingTemplateFor === slot.id;
                const isEditing = editingSlotId === slot.id;
                const setlistIdx = setlistOrder.indexOf(slot.id);
                const isInSetlist = setlistIdx >= 0;
                const isCurrentSetlist = setlistIdx === currentSetlistIndex;

                return (
                  <tr
                    key={slot.id}
                    className={`border-b border-gray-800/40 transition-colors cursor-pointer ${
                      isEditing ? 'bg-indigo-900/30 ring-1 ring-inset ring-indigo-700/50' :
                      isPlaying ? 'bg-green-900/10' : 'hover:bg-gray-800/20'
                    }`}
                  >
                    {/* # — clic pour sélectionner/désélectionner */}
                    <td className="px-2 py-1.5 cursor-pointer"
                        onClick={() => selectSlotForEditing(editingSlotId === slot.id ? null : slot.id)}>
                      <span className={`text-[9px] font-mono w-5 h-5 rounded flex items-center justify-center ${
                        isPlaying
                          ? (slot.isPreview ? 'bg-cyan-800 text-cyan-300' : 'bg-green-800 text-green-300')
                          : 'bg-gray-800 text-gray-500'
                      }`}>{idx + 1}</span>
                    </td>

                    {/* Nom (éditable) */}
                    <td className="px-2 py-1.5" onClick={() => selectSlotForEditing(slot.id)}>
                      {renamingId === slot.id ? (
                        <input
                          autoFocus
                          value={tempName}
                          onChange={(e) => setTempName(e.target.value)}
                          onBlur={() => {
                            if (tempName.trim()) renameMoveSlot(slot.id, tempName.trim());
                            setRenamingId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { if (tempName.trim()) renameMoveSlot(slot.id, tempName.trim()); setRenamingId(null); }
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                          className="bg-gray-900 text-white text-[10px] px-1 py-0.5 rounded border border-indigo-700 w-full"
                        />
                      ) : (
                        <span
                          onDoubleClick={() => { setRenamingId(slot.id); setTempName(slot.name); }}
                          className="text-white text-[11px] font-medium cursor-text"
                          title="Double-clic pour renommer"
                        >
                          {slot.name}
                        </span>
                      )}
                      {isPlaying && mv && (
                        <div className="text-[8px] font-mono text-green-500 mt-0.5">
                          {mv.fps?.toFixed(0)}fps · {mv.osc_rate?.toFixed(0)}osc/s
                        </div>
                      )}
                    </td>

                    {/* Template (dropdown) */}
                    <td className="px-2 py-1.5" onClick={() => selectSlotForEditing(slot.id)}>
                      {isSelected ? (
                        <select
                          autoFocus
                          value={slot.templateId}
                          onChange={(e) => { selectSlotForEditing(slot.id); setSlotTemplate(slot.id, e.target.value); setEditingTemplateFor(null); }}
                          onBlur={() => setEditingTemplateFor(null)}
                          className="bg-gray-900 text-white text-[9px] px-1 py-0.5 rounded border border-indigo-700 w-full"
                        >
                          {basicTemplates.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      ) : (
                        <button
                          onClick={() => { selectSlotForEditing(slot.id); setEditingTemplateFor(slot.id); }}
                          className="text-indigo-300 hover:text-indigo-200 text-[10px] font-mono px-1 py-0.5 rounded hover:bg-indigo-900/30 transition-colors"
                          title="Changer de template"
                        >
                          {preset?.name ?? slot.templateId}
                        </button>
                      )}
                    </td>

                    {/* Tracks (picker) */}
                    <td className="px-2 py-1.5" onClick={() => selectSlotForEditing(slot.id)}>
                      <button
                        onClick={() => { selectSlotForEditing(slot.id); openTrackPicker(slot.id, slot.trackIds); }}
                        className="text-cyan-300 hover:text-cyan-200 text-[10px] font-mono px-1 py-0.5 rounded hover:bg-cyan-900/30 transition-colors"
                        title="Choisir les tracks"
                      >
                        {slot.trackIds.length}tr
                      </button>
                      <div className="text-[8px] text-gray-600 mt-0.5 truncate max-w-[80px]">
                        {slot.trackIds.slice(0, 4).join(',')}
                        {slot.trackIds.length > 4 && `+${slot.trackIds.length - 4}`}
                      </div>
                    </td>

                    {/* Setlist (★ add/remove + ordre) */}
                    <td className="px-1 py-1.5 text-center" onClick={() => selectSlotForEditing(slot.id)}>
                      {isInSetlist ? (
                        <div className="flex items-center gap-0.5 justify-center">
                          <button
                            onClick={() => moveSetlistItem(setlistIdx, 'up')}
                            disabled={setlistIdx === 0}
                            className="text-gray-500 hover:text-white text-[8px] disabled:opacity-20"
                            title="Monter dans la setlist"
                          >▲</button>
                          <span className={`text-[9px] font-mono font-bold w-4 ${
                            isCurrentSetlist ? 'text-green-400' : 'text-yellow-400'
                          }`} title={isCurrentSetlist ? 'Move courant' : `Position ${setlistIdx + 1}`}>
                            {setlistIdx + 1}
                          </span>
                          <button
                            onClick={() => moveSetlistItem(setlistIdx, 'down')}
                            disabled={setlistIdx === setlistOrder.length - 1}
                            className="text-gray-500 hover:text-white text-[8px] disabled:opacity-20"
                            title="Descendre dans la setlist"
                          >▼</button>
                          <button
                            onClick={() => removeFromSetlist(slot.id)}
                            className="text-yellow-600 hover:text-yellow-400 text-[8px] ml-0.5"
                            title="Retirer de la setlist"
                          >✕</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => addToSetlist(slot.id)}
                          className="text-gray-600 hover:text-yellow-400 text-[10px]"
                          title="Ajouter à la setlist du spectacle"
                        >★</button>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-1 py-1.5" onClick={() => selectSlotForEditing(slot.id)}>
                      <div className="flex items-center gap-0.5 justify-center">
                        {/* Preview/Live toggle */}
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleSlotPreview(slot.id); }}
                          className={`text-[9px] px-1 rounded transition-colors ${
                            slot.isPreview
                              ? 'bg-cyan-900/50 text-cyan-300 hover:bg-cyan-800/60'
                              : 'text-gray-600 hover:text-gray-400 hover:bg-gray-800/30'
                          }`}
                          title={slot.isPreview ? 'Mode Preview (pas d\'OSC out) — cliquer pour passer en Live' : 'Mode Live (OSC out) — cliquer pour passer en Preview'}
                        >◉</button>
                        {isPlaying ? (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); stopSlotWithFade(slot.id, 1.0); }}
                              className="text-yellow-400 hover:text-yellow-300 text-[10px] px-1 rounded hover:bg-yellow-900/30"
                              title="Stop avec fade 1s"
                            >◆</button>
                            <button
                              onClick={(e) => { e.stopPropagation(); stopSlot(slot.id); }}
                              className="text-red-400 hover:text-red-300 text-[10px] px-1 rounded hover:bg-red-900/30"
                              title="Stop immédiat"
                            >■</button>
                          </>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); playSlot(slot.id); }}
                            className={`text-[10px] px-1.5 rounded hover:bg-green-900/30 font-bold ${
                              slot.isPreview ? 'text-cyan-400 hover:text-cyan-300' : 'text-green-400 hover:text-green-300'
                            }`}
                            title={slot.isPreview ? 'Lancer en preview (pas d\'OSC out)' : 'Lancer en live (OSC out)'}
                          >▶</button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            editSlotGraph(slot.id);
                            if (!showExpert) setShowExpert(true);
                          }}
                          className={`text-purple-400 hover:text-purple-300 text-[9px] px-1 rounded hover:bg-purple-900/30 ${editingSlotId === slot.id ? 'font-bold ring-1 ring-purple-600/50' : ''}`}
                          title="Éditer le graphe dans le node editor"
                        >✎</button>
                        {isPlaying && (
                          <button
                            onClick={(e) => { e.stopPropagation(); saveEditorToSlot(slot.id); }}
                            className="text-orange-400 hover:text-orange-300 text-[9px] px-1 rounded hover:bg-orange-900/30"
                            title="Hot-swap : appliquer le graphe modifié au move en cours"
                          >⟳</button>
                        )}
                        <button
                          onClick={() => { selectSlotForEditing(slot.id); setEditingMacrosFor(slot.id); }}
                          className="text-gray-400 hover:text-gray-200 text-[9px] px-1 rounded hover:bg-gray-700/30"
                          title="Macros (speed, scale, shift, rotation)"
                        >⚙</button>
                        <button
                          onClick={() => removeMoveSlot(slot.id)}
                          className="text-gray-600 hover:text-red-400 text-[9px] px-1 rounded hover:bg-red-900/20"
                          title="Supprimer ce slot"
                        >✕</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ═══ Track Picker Modal ═══ */}
      {editingTracksFor && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setEditingTracksFor(null)}
        >
          <div
            className="bg-stagespace-panel border border-stagespace-border rounded-lg p-4 max-w-md w-full mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white text-sm font-semibold mb-3">Tracks du move</h3>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setTempTrackIds([...allTrackIds])}
                className="text-[10px] px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded"
              >Tout</button>
              <button
                onClick={() => setTempTrackIds([])}
                className="text-[10px] px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded"
              >Aucun</button>
              <div className="flex-1" />
              <span className="text-[10px] text-gray-500 self-center">{tempTrackIds.length} sélectionnée{tempTrackIds.length > 1 ? 's' : ''}</span>
            </div>
            <div className="grid grid-cols-6 gap-1 max-h-60 overflow-y-auto">
              {allTrackIds.map((id) => (
                <button
                  key={id}
                  onClick={() => {
                    setTempTrackIds((prev) =>
                      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
                    );
                  }}
                  className={`text-[10px] font-mono px-2 py-1.5 rounded transition-colors ${
                    tempTrackIds.includes(id)
                      ? 'bg-indigo-700 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {id}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={confirmTrackPicker}
                className="flex-1 py-1.5 bg-indigo-700 hover:bg-indigo-600 text-white text-[11px] rounded font-medium"
              >Confirmer</button>
              <button
                onClick={() => setEditingTracksFor(null)}
                className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 text-[11px] rounded"
              >Annuler</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Macros Editor Modal ═══ */}
      {editingMacrosFor && (() => {
        const slot = moveSlots.find((s) => s.id === editingMacrosFor);
        if (!slot) return null;
        return (
          <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            onClick={() => setEditingMacrosFor(null)}
          >
            <div
              className="bg-stagespace-panel border border-stagespace-border rounded-lg p-4 max-w-sm w-full mx-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-white text-sm font-semibold mb-1">Macros — {slot.name}</h3>
              <p className="text-gray-500 text-[10px] mb-3">Appliquées au lancement et au GO</p>
              <div className="space-y-2">
                {([
                  { key: 'speed', label: 'Speed', min: 0.1, max: 4, step: 0.1 },
                  { key: 'scale', label: 'Scale', min: 0.1, max: 5, step: 0.1 },
                  { key: 'shiftX', label: 'Shift X', min: -10, max: 10, step: 0.5 },
                  { key: 'shiftY', label: 'Shift Y', min: -10, max: 10, step: 0.5 },
                  { key: 'shiftZ', label: 'Shift Z', min: -10, max: 10, step: 0.5 },
                  { key: 'yaw', label: 'Yaw', min: -180, max: 180, step: 5 },
                  { key: 'pitch', label: 'Pitch', min: -180, max: 180, step: 5 },
                  { key: 'roll', label: 'Roll', min: -180, max: 180, step: 5 },
                ] as const).map(({ key, label, min, max, step }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-gray-400 text-[10px] w-16">{label}</span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={slot.macros[key]}
                      onChange={(e) => setSlotMacros(slot.id, { [key]: parseFloat(e.target.value) })}
                      className="flex-1 h-1.5 accent-indigo-500"
                    />
                    <span className="text-white text-[10px] font-mono w-12 text-right">
                      {slot.macros[key].toFixed(1)}
                    </span>
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-2 border-t border-gray-700/50">
                  <span className="text-gray-400 text-[10px] w-16">Fade</span>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={0.5}
                    value={slot.fadeDuration}
                    onChange={(e) => setSlotFadeDuration(slot.id, parseFloat(e.target.value))}
                    className="flex-1 h-1.5 accent-purple-500"
                  />
                  <span className="text-white text-[10px] font-mono w-12 text-right">
                    {slot.fadeDuration.toFixed(1)}s
                  </span>
                </div>
              </div>
              <button
                onClick={() => setEditingMacrosFor(null)}
                className="w-full mt-4 py-1.5 bg-indigo-700 hover:bg-indigo-600 text-white text-[11px] rounded font-medium"
              >Fermer</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
