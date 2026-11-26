import React from 'react';
import { Play, Globe, SlidersHorizontal, ListOrdered, AudioLines, Pin } from 'lucide-react';
import { TrackGrid } from '../TrackGrid';
import { AudioModList } from '../AudioModControls';
import { GlobalTransformSurface } from '../show/GlobalTransformSurface';
import { Slider } from '../ui/Slider';
import { NodeParamsPanel } from '../panels/NodeParamsPanel';
import { PosesPanel } from '../conduite/PosesPanel';
import { OscMappingsPanel } from './OscMappingsPanel';
import { useGraphStore } from '../../store/useGraphStore';
import { usePoseStore } from '../../store/usePoseStore';
import { useMoveEditorStore } from '../../store/useMoveEditorStore';
import { SOURCE_CHIP } from '../../utils/sourceColors';
import { graphHasStatefulEngine, STATEFUL_PLAYBACK_HINT } from '../../utils/graphMigration';
import { type NodeParamValue } from '../nodeParamSchema';

/// Drawer live à scopes — gros boutons à la demande (Params / Tracks /
/// Audio du move sélectionné + Global merge-scope). Panneau bas, PAS modal :
/// le canvas reste visible pendant le tweak — c'est le point de l'app.

/// Sélecteur de pose pour l'ancre "pose" — peuplé depuis la table backend.
const PoseAnchorPicker: React.FC<{ slotId: string; value: string }> = ({ slotId, value }) => {
  const poses = usePoseStore((s) => s.poses);
  const refreshPoses = usePoseStore((s) => s.refreshPoses);
  const setSlotAnchorPose = useGraphStore((s) => s.setSlotAnchorPose);
  React.useEffect(() => { refreshPoses(); }, [refreshPoses]);
  const known = poses.some((p) => p.name === value);
  return (
    <select
      value={value}
      title="Pose de départ — la trajectoire démarre là où la pose place les objets (fallback position live par objet absent)"
      onChange={(e) => setSlotAnchorPose(slotId, e.target.value)}
      className="mt-1 w-full py-1 px-2 text-xs rounded bg-gray-800 text-gray-300"
    >
      <option value="">— pose —</option>
      {!known && value && <option value={value}>{value} (absente)</option>}
      {poses.map((p) => (
        <option key={p.name} value={p.name}>{p.name}</option>
      ))}
    </select>
  );
};

export const LiveDrawer: React.FC = () => {
  const moveSlots = useGraphStore((s) => s.moveSlots);
  const editingSlotId = useGraphStore((s) => s.editingSlotId);
  const selectSlotForEditing = useGraphStore((s) => s.selectSlotForEditing);
  const setSlotMacros = useGraphStore((s) => s.setSlotMacros);
  const setSlotDirection = useGraphStore((s) => s.setSlotDirection);
  const setSlotLoopMode = useGraphStore((s) => s.setSlotLoopMode);
  const setSlotEndMode = useGraphStore((s) => s.setSlotEndMode);
  const setSlotAnchorMode = useGraphStore((s) => s.setSlotAnchorMode);
  const setSlotAnchorTarget = useGraphStore((s) => s.setSlotAnchorTarget);
  const objectStates = useGraphStore((s) => s.objectStates);
  const emittedPositions = useGraphStore((s) => s.emittedPositions);
  const flowHealth = useGraphStore((s) => s.flowHealth);
  const setSlotTracks = useGraphStore((s) => s.setSlotTracks);
  const holProject = useGraphStore((s) => s.holProject);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const nodes = useGraphStore((s) => s.nodes);
  const updateNodeData = useGraphStore((s) => s.updateNodeData);
  const updateCurrent = useMoveEditorStore((s) => s.updateCurrent);
  const updateAssignment = useMoveEditorStore((s) => s.updateAssignment);
  const current = useMoveEditorStore((s) => s.current);


  type Scope = 'params' | 'playback' | 'tracks' | 'audio' | 'global' | 'osc' | 'poses';
  const [scope, setScope] = React.useState<Scope | null>(null);

  const slot = moveSlots.find((s) => s.id === editingSlotId);
  const playingSlots = moveSlots.filter((s) => s.movementId);


  // Params du graphe du slot — chips de nodes + grille de champs via le
  // NodeParamsPanel partagé (même mécanique dans l'Inspector Edit).
  const setNodeParam = (nodeId: string, key: string, value: NodeParamValue, params: Record<string, NodeParamValue>) => {
    // Hot-swap debouncé intégré dans updateNodeData (updateGraphLive interne)
    updateNodeData(nodeId, { params: { ...params, [key]: value } });
  };

  // Tracks du projet (.hol) ou IDs manuels — pour la grille d'assignation
  const trackInfos = (holProject?.tracks ?? []).map((t) => ({
    id: t.id, name: t.name, color: t.color, position: t.position,
  }));
  const allTrackInfos = trackInfos.length > 0
    ? trackInfos
    : manualOscIds.map((id) => ({ id, name: `#${id}` }));

  const selectMove = (slotId: string) => {
    if (editingSlotId === slotId) {
      // Re-tap sur le chip actif → referme le drawer params
      if (scope === 'params') setScope(null);
      else setScope('params');
    } else {
      selectSlotForEditing(slotId);
      setScope('params');
    }
  };

  const toggleScope = (sc: Scope) => setScope((prev) => (prev === sc ? null : sc));

  const scopeBtn = (sc: Scope, label: React.ReactNode, needsSlot: boolean, title: string) => (
    <button
      onClick={() => toggleScope(sc)}
      disabled={needsSlot && !slot}
      className={`px-4 py-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors active:scale-95 ${
        scope === sc
          ? sc === 'global' ? 'bg-stagespace-warning text-gray-950' : 'bg-stagespace-accent text-gray-950'
          : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white border border-gray-700'
      } disabled:opacity-30 disabled:cursor-not-allowed`}
      title={title}
    >
      {label}
    </button>
  );

  return (
    <div className="flex-shrink-0 border-t border-stagespace-border bg-stagespace-panel">
      {/* Barre : chips des moves live + gros boutons de scope */}
      <div className="flex items-center gap-2 px-3 py-1.5 overflow-x-auto">
        <span className="text-gray-500 text-xs uppercase tracking-wider flex-shrink-0">
          Live{playingSlots.length > 0 ? ` ${playingSlots.length}` : ''}
        </span>
        {playingSlots.length > 0 && (
          <button
            onClick={() => { selectSlotForEditing(null); setScope(null); }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              !editingSlotId
                ? 'bg-stagespace-accent text-gray-950'
                : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
            }`}
            title="Overview — all tracks of all moves"
          >
            All
          </button>
        )}
        {playingSlots.map((s) => (
          <button
            key={s.id}
            onClick={() => selectMove(s.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              editingSlotId === s.id && scope !== 'global'
                ? 'bg-stagespace-accent text-gray-950'
                : 'bg-stagespace-live/15 text-stagespace-live hover:bg-stagespace-live/25 border border-stagespace-live/40'
            }`}
            title="Live params of this move"
          >
            {s.isPreview ? '◌' : '●'} {s.name}
          </button>
        ))}

        <div className="w-px h-6 bg-stagespace-border mx-1 flex-shrink-0" />

        {scopeBtn('params', <><SlidersHorizontal size={12} className="inline -mt-0.5" /> Params</>, true,
          'Node params of the selected move graph')}
        {scopeBtn('playback', <><Play size={12} className="inline -mt-0.5" /> Playback</>, true,
          'Playback of the selected move (speed, direction, loop, fades)')}
        {scopeBtn('tracks', <><ListOrdered size={12} className="inline -mt-0.5" /> Tracks</>, true,
          'Track assignment + depth/phase of the selected move')}
        {scopeBtn('audio', <><AudioLines size={12} className="inline -mt-0.5" /> Audio</>, true,
          'Audio-reactive mods of the selected move')}
        {scopeBtn('osc', <>OSC IN</>, false,
          'Mappings OSC entrants (fader→param) + learn')}
        {scopeBtn('poses', <>Poses</>, false,
          'Position presets — capture la formation courante, snap/goto/morph')}
        {scopeBtn('global', <><Globe size={12} className="inline -mt-0.5" /> Global transform</>, false,
          'Global transform — merge scope, affecte TOUS les moves live')}

        {!slot && playingSlots.length === 0 && (
          <span className="text-gray-400 text-xs ml-2">
            tap a move for its params · <Play size={9} className="inline -mt-0.5" /> = layer live
            {' · '}<Pin size={9} className="inline -mt-0.5" /> in Edit = curate this surface
          </span>
        )}
        {!slot && playingSlots.length > 0 && (
          <span className="text-gray-400 text-xs ml-2">tap a chip to edit a move</span>
        )}
        {slot && (
          <span className="text-stagespace-accent/70 text-xs ml-2 flex items-center gap-1.5">
            editing:
            <button
              onClick={() => { selectSlotForEditing(null); setScope(null); }}
              className="px-1.5 py-0.5 -my-0.5 rounded bg-stagespace-accent/20 hover:bg-stagespace-accent/30 text-stagespace-info font-semibold"
              title="Click to deselect — back to overview (no move edited)"
            >
              {slot.name} ✕
            </button>
            {slot.movementId
              ? <span className={`px-1 rounded ${slot.isPreview ? 'bg-slate-800 text-slate-300' : 'bg-stagespace-live/20 text-stagespace-live'}`}>{slot.isPreview ? 'PREV' : 'LIVE'}</span>
              : <span className="text-gray-400">(stopped)</span>}
            {/* Source-de-contrôle par objet du slot — qui pilote quoi. */}
            {slot.trackIds.map((t) => {
              // objectStates/emittedPositions sont keyed par obj_index
              // (position dans osc_ids) — trackId ≠ objIndex, off-by-one
              // pour des tracks 1-based : conversion obligatoire.
              const objIdx = manualOscIds.indexOf(t);
              const src = objIdx >= 0 ? objectStates[objIdx] : undefined;
              // PSN stale : flux figé >2s — le label "psn" mentirait.
              const stale =
                src === 'psn' &&
                (flowHealth.psnAge == null || flowHealth.psnAge > 2000);
              const emitted = objIdx >= 0 ? emittedPositions[objIdx] : undefined;
              const colors: Record<string, string> = SOURCE_CHIP;
              const emittedStr = emitted
                ? ` (${emitted.map((v) => v.toFixed(2)).join(', ')})`
                : '';
              return src ? (
                <span
                  key={t}
                  title={`objet ${t} : ${src}${stale ? ' (flux figé!)' : ''} — dernier envoyé${emittedStr}`}
                  className={`px-1 rounded ${stale ? 'bg-stagespace-warning/30 text-stagespace-warning animate-pulse' : colors[src] ?? colors.track}`}
                >
                  {t}·{src}{stale ? '✕' : ''}
                </span>
              ) : null;
            })}
          </span>
        )}
      </div>

      {/* ── Drawer GLOBAL — scope merge : affecte TOUS les moves live ── */}
      {scope === 'osc' && <OscMappingsPanel />}

      {scope === 'global' && (
        <div className="border-t border-stagespace-border px-4 py-2 max-h-[42vh] overflow-y-auto">
          <GlobalTransformSurface live includeRadius />
        </div>
      )}

      {/* ── Drawer POSES — capture avec radar/3D sous les yeux : la
          boucle place → regarde → capture est complète dans cette
          surface (contrairement à la conduite, aveugle). */}
      {scope === 'poses' && (
        <div className="border-t border-stagespace-border px-4 py-2 max-h-[42vh] overflow-y-auto">
          <PosesPanel fill={false} />
        </div>
      )}

      {/* ── Drawer PLAYBACK — lecture du move sélectionné ── */}
      {scope === 'playback' && slot && (
        <div className="border-t border-stagespace-border px-4 py-2 flex items-start gap-6 overflow-x-auto max-h-[42vh] overflow-y-auto">
          {/* Speed — gros fader du move */}
          <div className="flex-shrink-0 w-64 space-y-1">
            <div className="text-gray-500 text-xs uppercase tracking-wider">Speed</div>
            <Slider
              value={slot.macros.speed}
              min={0}
              max={3}
              step={0.05}
              unit="x"
              layout="stack"
              live={!!slot.movementId}
              onChange={(v) => setSlotMacros(slot.id, { speed: v })}
            />
          </div>
          {/* Direction + loop — groupes de boutons */}
          <div className="flex-shrink-0 w-56 space-y-2">
            <div>
              <div className="text-gray-500 text-xs uppercase tracking-wider mb-1"
                title={graphHasStatefulEngine(slot.graphJson?.nodes) ? STATEFUL_PLAYBACK_HINT : undefined}
              >Direction</div>
              <div className="flex gap-1">
                {(['forward', 'backward', 'ping_pong'] as const).map((d) => {
                  const blocked = d !== 'forward' && graphHasStatefulEngine(slot.graphJson?.nodes);
                  return (
                  <button
                    key={d}
                    disabled={blocked}
                    title={blocked ? STATEFUL_PLAYBACK_HINT : undefined}
                    onClick={() => setSlotDirection(slot.id, d)}
                    className={`flex-1 py-1.5 text-xs rounded ${
                      blocked
                        ? 'bg-gray-800/40 text-gray-700 cursor-not-allowed'
                        : slot.direction === d
                          ? 'bg-stagespace-accent text-gray-950'
                          : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {d === 'ping_pong' ? 'pingpong' : d}
                  </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-gray-500 text-xs uppercase tracking-wider mb-1">Mode</div>
              <div className="flex gap-1">
                {(['loop', 'oneshot'] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setSlotLoopMode(slot.id, l)}
                    className={`flex-1 py-1.5 text-xs rounded ${
                      slot.loopMode === l
                        ? 'bg-stagespace-accent text-gray-950'
                        : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-gray-500 text-xs uppercase tracking-wider mb-1" title="Fin de one-shot : hold fige la dernière position (chaînage), revert revient à la base">End</div>
              <div className="flex gap-1">
                {(['revert', 'hold'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setSlotEndMode(slot.id, m)}
                    className={`flex-1 py-1.5 text-xs rounded ${
                      (slot.endMode ?? 'revert') === m
                        ? 'bg-stagespace-accent text-gray-950'
                        : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-gray-500 text-xs uppercase tracking-wider mb-1" title="Ancre : current part de la position courante de chaque objet, origin de l'origine du move">Anchor</div>
              <div className="flex gap-1">
                {(['origin', 'current', 'follow', 'pose'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setSlotAnchorMode(slot.id, m)}
                    className={`flex-1 py-1.5 text-xs rounded ${
                      (slot.anchorMode ?? 'origin') === m
                        ? 'bg-stagespace-accent text-gray-950'
                        : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {slot.anchorMode === 'follow' && (
                <input
                  type="number"
                  min={0}
                  placeholder="cible"
                  title="Track cible suivie (numéro de track)"
                  value={slot.anchorTarget ?? ''}
                  onChange={(e) => setSlotAnchorTarget(slot.id, parseInt(e.target.value) || 0)}
                  className="mt-1 w-full py-1 px-2 text-xs rounded bg-gray-800 text-gray-300"
                />
              )}
              {slot.anchorMode === 'pose' && (
                <PoseAnchorPicker slotId={slot.id} value={slot.anchorPose ?? ''} />
              )}
            </div>
          </div>
          {/* Fades de cycle */}
          <div className="flex-shrink-0 w-64 space-y-1">
            <div className="text-gray-500 text-xs uppercase tracking-wider">Fades</div>
            <Slider
              label="In"
              value={current.fade_in}
              min={0}
              max={5}
              step={0.1}
              unit="s"
              live={!!slot.movementId}
              onChange={(v) => updateCurrent({ fade_in: v })}
            />
            <Slider
              label="Out"
              value={current.fade_out}
              min={0}
              max={5}
              step={0.1}
              unit="s"
              live={!!slot.movementId}
              onChange={(v) => updateCurrent({ fade_out: v })}
            />
          </div>
        </div>
      )}

      {/* ── Drawer PARAMS — chips de nodes + tous les params du node choisi ── */}
      {scope === 'params' && slot && (
        <div className="border-t border-stagespace-border px-4 py-2 max-h-[42vh] overflow-y-auto">
          <NodeParamsPanel
            nodes={nodes}
            live={!!slot.movementId}
            resetKey={editingSlotId}
            performMode
            onParam={setNodeParam}
            emptyHint="No parametric node in this graph — see Playback / Tracks."
          />
        </div>
      )}

      {/* ── Drawer TRACKS — assignation + depth/phase du move sélectionné ── */}
      {scope === 'tracks' && slot && (
        <div className="border-t border-stagespace-border px-4 py-2 max-h-[42vh] overflow-y-auto">
          <TrackGrid
            compact
            tracks={allTrackInfos}
            selectedTrackIds={new Set(slot.trackIds)}
            // IMPORTANT : lire l'état frais du store à chaque appel — les
            // patterns (even/odd/inverse) font une rafale de toggles dans le
            // même tick ; slot.trackIds (prop) serait stale et chaque toggle
            // écraserait le précédent (seul le dernier survivait).
            toggleTrackSelection={(tid) => {
              const fresh = useGraphStore.getState().moveSlots.find((s) => s.id === slot.id)?.trackIds ?? [];
              setSlotTracks(slot.id, fresh.includes(tid)
                ? fresh.filter((t) => t !== tid)
                : [...fresh, tid]);
            }}
            setTrackSelection={(ids) => setSlotTracks(slot.id, ids)}
            assignments={current.assignments}
            updateAssignment={updateAssignment}
          />
          {slot.movementId && (
            <div className="text-stagespace-derived text-xs mt-1">
              live — toggles appliqués via hot-swap, depth/phase via update_animation_state
            </div>
          )}
        </div>
      )}

      {/* ── Drawer AUDIO — mods audio-réactifs du move sélectionné ── */}
      {scope === 'audio' && slot && (
        <div className="border-t border-stagespace-border px-4 py-2 max-h-[42vh] overflow-y-auto">
          <AudioModList />
        </div>
      )}
    </div>
  );
};
