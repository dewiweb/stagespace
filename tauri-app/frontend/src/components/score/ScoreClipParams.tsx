/// Panneau des paramètres du clip sélectionné — le contenu de
/// l'ancien bandeau inspector remonté dans la zone haute du score :
/// couverture (objets pilotés, réassignation), début/durée/fades/
/// repeat, champs par type de ref (geste/throw/osc/soundcheck/solo/
/// view), duplication.
import React from 'react';
import type { ScoreClipDoc } from '../../store/useScoreStore';
import type { MoveSlot } from '../../store/slices/moveSlotsTypes';
import { effectiveTrackIds } from '../../utils/scoreResolve';

/// Champ de lecture du slot éditable en mode score.
type SlotEditField = 'loopMode' | 'direction' | 'endMode' | 'anchorMode' | 'anchorTarget' | 'anchorPose' | 'speed';

export const ScoreClipParams: React.FC<{
  clip: ScoreClipDoc;
  /// Slot référencé (clip slot) — ses params de lecture s'affichent
  /// en lecture seule pendant la lecture, éditables transport stoppé.
  slot?: MoveSlot;
  /// Le slot a été édité depuis la dernière résolution — la spec
  /// jouée est l'ancienne ; la nouvelle s'applique au prochain play.
  slotPending?: boolean;
  /// Transport en lecture — le bloc slot est gelé (lecture seule).
  playing?: boolean;
  /// Édition d'un param de lecture du slot (partagé Jeu/Atelier).
  onSlotEdit?: (field: SlotEditField, value: string | number) => void;
  clipLabel: (c: ScoreClipDoc) => string;
  /// Objets patchés + déjà couverts (pour le select d'assignation).
  manualOscIds: number[];
  covered: Set<number>;
  durationMs: number;
  onMoveClip: (id: string, startMs: number) => void;
  onResizeClip: (id: string, durationMs: number | undefined) => void;
  onSetClipFades: (id: string, inMs: number | undefined, outMs: number | undefined) => void;
  onSetClipRepeat: (id: string, everyMs: number | undefined) => void;
  onSetClipTrackIds: (id: string, trackIds: number[] | undefined) => void;
  onDuplicateClip: (id: string) => void;
  /// Réécrit la référence du clip (geste → strength, throw → vel).
  onUpdateRef: (id: string, ref: ScoreClipDoc['ref']) => void;
}> = ({
  clip: c, slot, slotPending, playing, onSlotEdit, clipLabel, manualOscIds, covered, durationMs,
  onMoveClip, onResizeClip, onSetClipFades, onSetClipRepeat, onSetClipTrackIds, onDuplicateClip, onUpdateRef,
}) => {
  /// Groupe de boutons segmenté — même pattern que le drawer
  /// Playback de Jeu, version compacte du panneau.
  const seg = (label: string, opts: readonly { v: string; label: string }[], cur: string,
    onPick: (v: string) => void, title?: string, warn?: string) => (
    <div className="flex items-center gap-1" title={title}>
      <span className="w-20 text-gray-500 shrink-0">{label}</span>
      <span className="flex gap-0.5">
        {opts.map((o) => (
          <button
            key={o.v}
            onClick={() => onPick(o.v)}
            className={`px-1.5 py-0.5 rounded border ${cur === o.v
              ? 'bg-blue-600/40 border-blue-600 text-blue-200'
              : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'}`}
          >{o.label}</button>
        ))}
      </span>
      {warn && <span className="text-orange-400">{warn}</span>}
    </div>
  );
  /// Champ numérique secondes → ms (vide = undefined).
  const numIn = (label: string, val: number | undefined, onSet: (v: number | undefined) => void, title?: string) => (
    <label className="flex items-center gap-1" title={title}>
      <span className="w-20 text-gray-500">{label}</span>
      <input
        // key par valeur — une mutation externe du clip (split,
        // menu contextuel) re-initialise l'input non contrôlé au
        // lieu d'afficher la valeur d'avant.
        key={`${c.id}-${label}-${val ?? 'x'}`}
        type="number" min={0} step={0.5} defaultValue={val != null ? val / 1000 : ''}
        placeholder="—"
        onBlur={(e) => {
          const v = e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) * 1000);
          onSet(v);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-20 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-[10px]"
      />
      s
    </label>
  );
  /// Champ numérique BRUT (unité du paramètre — pas des secondes) :
  /// strength de geste, composantes de vélocité de throw.
  const rawIn = (label: string, val: number, onSet: (v: number) => void, title?: string) => (
    <label className="flex items-center gap-1" title={title}>
      <span className="w-20 text-gray-500">{label}</span>
      <input
        key={`${c.id}-${label}-${val}`}
        type="number" step={0.5} defaultValue={val}
        onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onSet(v); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-20 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-[10px]"
      />
    </label>
  );
  /// Champ texte (adresse OSC, args, cible) — commit au blur/Enter.
  const textIn = (label: string, val: string, onSet: (v: string) => void, title: string, placeholder = '') => (
    <label className="flex items-center gap-1" title={title}>
      <span className="w-20 text-gray-500">{label}</span>
      <input
        key={`${c.id}-${label}-${val}`}
        type="text" defaultValue={val} placeholder={placeholder}
        onBlur={(e) => onSet(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="flex-1 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-[10px] font-mono"
      />
    </label>
  );
  // Événements à cibles — la couverture trackIds porte la sémantique
  // (objets visés), pas un simple blast radius visuel. `positions`
  // filtre ses entrées par la couverture, donc éditable aussi.
  const TARGETED = new Set(['park', 'unpark', 'throw', 'manualClear', 'attention', 'positions']);
  const eff = effectiveTrackIds(c);
  const following = c.trackIds === undefined;
  const coverEditable = c.ref.type === 'slot' || TARGETED.has(c.ref.type);
  const coverShown = coverEditable || c.ref.type === 'cue';
  const label = clipLabel(c);

  return (
    <div className="flex-1 min-w-0 overflow-y-auto px-3 py-2 text-[10px] text-gray-400">
      <div className="font-bold text-gray-200 mb-2">{label}</div>
      <div className="flex flex-col gap-1.5 max-w-md">
        {/* Couverture — les objets pilotés par ce clip. × retire
            l'objet (réassignation) ; slot → + ajoute un objet.
            Cue : lecture seule — le recall est global, la couverture
            affichée n'est qu'un blast radius informatif. */}
        {coverShown && (
          <div className="flex items-start gap-1" title={!coverEditable
            ? 'Blast radius visuel — le recall de cue est global, cette couverture ne filtre rien'
            : following
              ? (TARGETED.has(c.ref.type)
                ? 'Cible suivie — tous les objets patchés (geler pour restreindre)'
                : 'Couverture suivie — dérivée en live de l\'entité (réassignations reflétées)')
              : 'Couverture gelée — override explicite du clip'}>
            <span className="w-20 text-gray-500 shrink-0">obj:</span>
            <span className="flex flex-wrap items-center gap-1">
              {eff.map((tid) => (
                <span key={tid} className={`px-1 rounded bg-gray-800 border border-gray-700 flex items-center ${following || !coverEditable ? 'opacity-60' : ''}`}>
                  {tid}
                  {coverEditable && !following && (
                    <button
                      className="ml-0.5 text-gray-500 hover:text-red-400"
                      title={`Retirer l'objet ${tid} de la couverture`}
                      onClick={() => onSetClipTrackIds(c.id, eff.filter((x) => x !== tid))}
                    >×</button>
                  )}
                </span>
              ))}
              {coverEditable && (following ? (
                <button
                  className="px-1 rounded text-cyan-400 hover:bg-gray-800"
                  title="Couverture suivie (live) — cliquer pour geler en override explicite"
                  onClick={() => onSetClipTrackIds(c.id, eff)}
                >⇄</button>
              ) : (
                <button
                  className="px-1 rounded text-orange-400 hover:bg-gray-800"
                  title="Override explicite — cliquer pour repasser en suivi live"
                  onClick={() => onSetClipTrackIds(c.id, undefined)}
                >⇄</button>
              ))}
              {coverEditable && !following && (
                <select
                  className="bg-gray-800 border border-gray-700 rounded text-[10px]"
                  value=""
                  onChange={(e) => {
                    const tid = Number(e.target.value);
                    if (tid) onSetClipTrackIds(c.id, [...eff, tid]);
                  }}
                  title="Assigner un objet supplémentaire à ce clip"
                >
                  <option value="">+</option>
                  {[...new Set([...manualOscIds, ...covered])]
                    .filter((tid) => !eff.includes(tid))
                    .sort((a, b) => a - b)
                    .map((tid) => <option key={tid} value={tid}>{tid}</option>)}
                </select>
              )}
            </span>
          </div>
        )}
        {numIn('début', c.startMs, (v) => v != null && onMoveClip(c.id, v))}
        {numIn('durée', c.durationMs, (v) => onResizeClip(c.id, v && v > 0 ? v : undefined))}
        {c.ref.type === 'slot' && numIn('fade in', c.fadeInMs,
          (v) => onSetClipFades(c.id, v, c.fadeOutMs),
          'Fade-in clip-local — vide = hérite le fade du slot')}
        {c.ref.type === 'slot' && numIn('fade out', c.fadeOutMs,
          (v) => onSetClipFades(c.id, c.fadeInMs, v),
          'Fade-out clip-local (tail après la fin) — vide = hérite le fade du slot')}
        {/* Params de lecture du slot — résolus live dans la request
            au play/hot-swap. Éditables transport stoppé (le slot est
            partagé avec Jeu/Atelier et tous les clips qui le
            référencent) ; gelés en lecture seule pendant la lecture —
            la spec jouée est celle résolue au play. Les valeurs
            conflictuelles avec le mode score (ancre ≠ origin = non
            déterministe ; hold = résidu) sont signalées en ambre. */}
        {c.ref.type === 'slot' && slot && (
          <div
            className={`mt-1 border-t pt-1.5 flex flex-col gap-1 ${slotPending ? 'border-amber-700/50' : 'border-gray-800'}`}
            title={playing
              ? "Params de lecture du slot — gelés pendant la lecture, édition reprend au stop"
              : "Params de lecture du slot — partagés avec Jeu/Atelier et tous les clips sur ce slot"}
          >
            {slotPending && (
              <div className="flex items-center gap-1">
                <span className="w-20 text-amber-600">⏳</span>
                <span className="text-amber-400">slot édité — s'appliquera au prochain play</span>
              </div>
            )}
            {playing || !onSlotEdit ? (
              <>
                <div className="flex items-center gap-1">
                  <span className={`w-20 ${slotPending ? 'text-amber-600' : 'text-gray-600'}`}>lecture</span>
                  <span className={slotPending ? 'text-amber-300' : 'text-gray-500'}>
                    {slot.loopMode}
                    {' · '}{slot.direction === 'ping_pong' ? 'ping-pong' : slot.direction}
                    {' · '}{(slot.macros?.speed ?? 1).toFixed(2)}×
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className={`w-20 ${slotPending ? 'text-amber-600' : 'text-gray-600'}`}>fin</span>
                  <span className={slot.endMode === 'hold' ? 'text-amber-400' : slotPending ? 'text-amber-300' : 'text-gray-500'}>
                    {slot.endMode ?? 'revert'}
                    {slot.endMode === 'hold' && ' — la position reste tenue après la fenêtre'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className={`w-20 ${slotPending ? 'text-amber-600' : 'text-gray-600'}`}>ancre</span>
                  <span className={(slot.anchorMode ?? 'origin') !== 'origin' ? 'text-amber-400' : slotPending ? 'text-amber-300' : 'text-gray-500'}>
                    {slot.anchorMode ?? 'origin'}
                    {(slot.anchorMode ?? 'origin') !== 'origin' && " — capture la position à l'instant du tir (non déterministe)"}
                  </span>
                </div>
              </>
            ) : (
              <>
                {seg('mode', [{ v: 'loop', label: 'loop' }, { v: 'oneshot', label: 'oneshot' }],
                  slot.loopMode, (v) => onSlotEdit('loopMode', v),
                  'Mode de lecture du move — loop boucle dans la fenêtre, oneshot joue une fois')}
                {seg('direction', [{ v: 'forward', label: '→' }, { v: 'backward', label: '←' }, { v: 'ping_pong', label: '⇄' }],
                  slot.direction, (v) => onSlotEdit('direction', v),
                  'Direction — ping-pong n\'a d\'effet qu\'en loop')}
                {rawIn('vitesse', slot.macros?.speed ?? 1,
                  (v) => onSlotEdit('speed', Math.max(0.05, v)),
                  'Vitesse de lecture du move (×) — déforme la durée réelle vs la fenêtre clip')}
                {seg('fin', [{ v: 'revert', label: 'revert' }, { v: 'hold', label: 'hold' }],
                  slot.endMode ?? 'revert', (v) => onSlotEdit('endMode', v),
                  'Fin de one-shot — hold fige la dernière position (résidu après la fenêtre)',
                  slot.endMode === 'hold' ? '— résidu après la fenêtre' : undefined)}
                {seg('ancre', [{ v: 'origin', label: 'origin' }, { v: 'current', label: 'current' }, { v: 'follow', label: 'follow' }, { v: 'pose', label: 'pose' }],
                  slot.anchorMode ?? 'origin', (v) => onSlotEdit('anchorMode', v),
                  'Ancre du move — ≠ origin capture la position à l\'instant du tir (non déterministe)',
                  (slot.anchorMode ?? 'origin') !== 'origin' ? '— non déterministe' : undefined)}
                {slot.anchorMode === 'follow' && (
                  <label className="flex items-center gap-1" title="Track cible suivie (numéro de track)">
                    <span className="w-20 text-gray-500">cible</span>
                    <input
                      key={`${c.id}-anchor-${slot.anchorTarget ?? 'x'}`}
                      type="number" min={0} defaultValue={slot.anchorTarget ?? ''}
                      onBlur={(e) => onSlotEdit('anchorTarget', parseInt(e.target.value) || 0)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      className="w-20 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-[10px]"
                    />
                  </label>
                )}
                {slot.anchorMode === 'pose' && (
                  <label className="flex items-center gap-1" title="Pose de départ — la trajectoire démarre là où la pose place les objets">
                    <span className="w-20 text-gray-500">pose</span>
                    <input
                      key={`${c.id}-anchorpose-${slot.anchorPose ?? 'x'}`}
                      type="text" defaultValue={slot.anchorPose ?? ''}
                      onBlur={(e) => onSlotEdit('anchorPose', e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      className="w-28 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-[10px]"
                    />
                  </label>
                )}
              </>
            )}
          </div>
        )}
        {(() => {
          const ref = c.ref;
          if (ref.type === 'gesture') {
            return rawIn('force', ref.strength,
              (v) => onUpdateRef(c.id, { ...ref, strength: v }),
              'Vélocité initiale de l\'impulsion (m/s) — défaut OSC : 3');
          }
          if (ref.type === 'pose') {
            return (
              <>
                {seg('mode', [{ v: 'snap', label: 'snap' }, { v: 'goto', label: 'goto' }, { v: 'morph', label: 'morph' }],
                  ref.mode, (v) => onUpdateRef(c.id, { ...ref, mode: v as 'snap' | 'goto' | 'morph' }),
                  'snap = écritures manuelles instantanées ; goto = rampe animée vers la pose ; morph = rampe depuis la pose source')}
                {textIn('pose', ref.name,
                  (v) => onUpdateRef(c.id, { ...ref, name: v }),
                  'Nom de la pose cible — résolue au tir avec son contenu courant (référentiel)')}
                {ref.mode === 'morph' && textIn('depuis', ref.fromPose ?? '',
                  (v) => onUpdateRef(c.id, { ...ref, fromPose: v || undefined }),
                  'Pose source du morph — les objets partent de là même s\'ils sont physiquement ailleurs ; absents de la source = départ live')}
                {ref.mode !== 'snap' && rawIn('durée (s)', ref.duration ?? 2,
                  (v) => onUpdateRef(c.id, { ...ref, duration: v }),
                  'Durée de la rampe en secondes')}
                {ref.mode !== 'snap' && seg('easing', [{ v: 'smooth', label: 'smooth' }, { v: 'linear', label: 'linear' }, { v: 'ease_in', label: 'in' }, { v: 'ease_out', label: 'out' }],
                  ref.easing ?? 'smooth', (v) => onUpdateRef(c.id, { ...ref, easing: v }),
                  'Courbe de la rampe — smooth = smoothstep (départ/arrivée doux)')}
              </>
            );
          }
          if (ref.type === 'throw') {
            return (
              <div className="flex items-start gap-1">
                <span className="w-20 text-gray-500 shrink-0">vélocité</span>
                <span className="flex gap-1">
                  {(['x', 'y', 'z'] as const).map((axis, i) => (
                    <label key={axis} className="flex items-center gap-0.5" title={`Composante ${axis} de la vélocité (m/s)`}>
                      {axis}
                      <input
                        key={`${c.id}-vel-${axis}-${ref.vel[i]}`}
                        type="number" step={0.5} defaultValue={ref.vel[i]}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v)) {
                            const vel: [number, number, number] = [...ref.vel];
                            vel[i] = v;
                            onUpdateRef(c.id, { ...ref, vel });
                          }
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-[10px]"
                      />
                    </label>
                  ))}
                </span>
              </div>
            );
          }
          if (ref.type === 'osc') {
            return (
              <>
                {textIn('addr', ref.addr,
                  (v) => onUpdateRef(c.id, { ...ref, addr: v }),
                  'Adresse OSC émise au tir — ex. /light/go, /video/cue/12. Les adresses /stagespace/* vers notre propre port d\'entrée sont refusées au tir (boucle show-control)',
                  '/cue/go')}
                {textIn('args', ref.args,
                  (v) => onUpdateRef(c.id, { ...ref, args: v }),
                  'Arguments — tokens séparés par espace : "texte"/\'texte\' = string, true/false = bool, 42 = int, 1.5 = float',
                  '1 "fade" 0.5')}
                {textIn('→ host:port', ref.target ?? '',
                  (v) => onUpdateRef(c.id, { ...ref, target: v || undefined }),
                  'Cible override "host:port" — vide = la sortie OSC du show (le renderer spatial)',
                  'host:port')}
              </>
            );
          }
          if (ref.type === 'soundcheck') {
            return (
              <label className="flex items-center gap-1" title="Action de la sonde cyclique (/stagespace/soundcheck)">
                <span className="w-20 text-gray-500">action</span>
                <select
                  className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-[10px]"
                  value={ref.action}
                  onChange={(e) => onUpdateRef(c.id, { ...ref, action: e.target.value as typeof ref.action })}
                >
                  {(['start', 'stop', 'next', 'prev'] as const).map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </label>
            );
          }
          if (ref.type === 'solo') {
            return rawIn('slot', ref.n,
              (v) => onUpdateRef(c.id, { ...ref, n: v }),
              'oscIndex du slot à jouer en solo (/stagespace/solo <n>) — coupe les autres slots jouants');
          }
          if (ref.type === 'view') {
            return (
              <label className="flex items-center gap-1" title="Surface opérateur cible (/stagespace/view)">
                <span className="w-20 text-gray-500">surface</span>
                <select
                  className="bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-[10px]"
                  value={ref.surface}
                  onChange={(e) => onUpdateRef(c.id, { ...ref, surface: e.target.value as typeof ref.surface })}
                >
                  {(['atelier', 'conduite', 'jeu', 'score'] as const).map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </label>
            );
          }
          return null;
        })()}
        {numIn('⟳ toutes les', c.repeatEveryMs, (v) => {
          // Repeat exige une fenêtre (durationMs) — un clip
          // ouvert qui devient bouclé prend le reste du score
          // comme fenêtre.
          if (v != null && v > 0 && c.durationMs == null) {
            onResizeClip(c.id, Math.max(v, durationMs - c.startMs));
          }
          onSetClipRepeat(c.id, v && v > 0 ? v : undefined);
        }, 'Tuile du motif — copies liées du move toutes les N s dans la fenêtre (défaut = un cycle pour les moves loopés)')}
        <div>
          <button
            className="hover:text-gray-200 border border-gray-700 rounded px-2 py-0.5"
            title="Dupliquer le clip (copie indépendante, décalée de sa durée)"
            onClick={() => onDuplicateClip(c.id)}
          >⧉ dupliquer</button>
        </div>
      </div>
    </div>
  );
};
