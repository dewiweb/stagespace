/// Panneau des paramètres du clip sélectionné — le contenu de
/// l'ancien bandeau inspector remonté dans la zone haute du score :
/// couverture (objets pilotés, réassignation), début/durée/fades/
/// repeat, champs par type de ref (geste/throw/osc/soundcheck/solo/
/// view), duplication.
import React from 'react';
import type { ScoreClipDoc } from '../../store/useScoreStore';
import { effectiveTrackIds } from '../../utils/scoreResolve';

export const ScoreClipParams: React.FC<{
  clip: ScoreClipDoc;
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
  clip: c, clipLabel, manualOscIds, covered, durationMs,
  onMoveClip, onResizeClip, onSetClipFades, onSetClipRepeat, onSetClipTrackIds, onDuplicateClip, onUpdateRef,
}) => {
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
        {(() => {
          const ref = c.ref;
          if (ref.type === 'gesture') {
            return rawIn('force', ref.strength,
              (v) => onUpdateRef(c.id, { ...ref, strength: v }),
              'Vélocité initiale de l\'impulsion (m/s) — défaut OSC : 3');
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
