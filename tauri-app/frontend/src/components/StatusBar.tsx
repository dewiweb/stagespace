import React from 'react';
import { TriangleAlert } from 'lucide-react';
import { useGraphStore } from '../store/useGraphStore';
import { useMoveEditorStore } from '../store/useMoveEditorStore';
import { useOscArmed } from '../hooks/useOscArmed';
import { useShowStatusStore } from '../store/useShowStatusStore';
import { doPanic } from '../utils/liveActions';

/// StatusBar — bandeau persistant en bas de fenêtre, monté dans App pour
/// TOUS les modes (Edit et Perform). C'est la console de monitoring moteur :
/// statut, FPS/OSC/CPU, erreurs. La dispersion précédente (header + Toolbar
/// + topbar Perform) laissait les infos vitales démontées en mode live.
///
/// Volontairement compacte (h-7) : elle informe, elle n'actionne pas —
/// PANIC vit ici — global, toutes surfaces (Toolbar = Atelier seul).
export const StatusBar: React.FC = () => {
  // Sélecteurs granulaires — perfStats rafraîchit à 2 Hz pendant le play.
  const movements = useGraphStore((s) => s.movements);
  const status = useGraphStore((s) => s.status);
  const perfStats = useGraphStore((s) => s.perfStats);
  const compileError = useGraphStore((s) => s.compileError);
  const playError = useGraphStore((s) => s.playError);
  const clearCompileError = useGraphStore((s) => s.clearCompileError);
  const clearPlayError = useGraphStore((s) => s.clearPlayError);
  const oscAddress = useGraphStore((s) => s.oscAddress);
  const oscPort = useGraphStore((s) => s.oscPort);
  const [armed] = useOscArmed();
  const flowHealth = useGraphStore((s) => s.flowHealth);
  const perceptual = useGraphStore((s) => s.perceptual);
  const debugPerfVisible = useMoveEditorStore((s) => s.debugPerfVisible);
  const backendDown = useShowStatusStore((s) => s.backendDown);

  const activeCount = movements.length;
  const hasError = !!(compileError || playError);
  const errorText = compileError ? `Compile: ${compileError}` : `Play: ${playError}`;

  const statusColor =
    activeCount > 0 ? 'bg-green-500' :
    status === 'compiling' ? 'bg-yellow-500 animate-pulse' :
    status === 'error' ? 'bg-red-500' :
    status === 'compiled' ? 'bg-blue-500' :
    'bg-gray-600';

  const statusLabel =
    activeCount > 0 ? `${activeCount} live` :
    status === 'compiling' ? 'Compiling' :
    status === 'error' ? 'Error' :
    status === 'compiled' ? 'Compiled' :
    'Idle';

  return (
    <footer className="h-7 flex items-center gap-3 px-3 border-t border-stagespace-border bg-stagespace-panel flex-shrink-0 text-xs select-none">
      {/* PANIC — arrêt d'urgence, global sur toutes les surfaces (le
          bouton Toolbar n'existe qu'en Atelier : le panic du show ne doit
          jamais dépendre de la phase de travail). */}
      <button
        onClick={() => doPanic('statusbar')}
        className="px-3 py-0.5 rounded bg-red-700 hover:bg-red-600 text-white text-[10px] font-black tracking-wider flex-shrink-0"
        title="PANIC — stop all + positions d'origine (Esc)"
      >
        PANIC
      </button>

      {/* Statut moteur */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className={`w-2 h-2 rounded-full ${statusColor}`} />
        <span className="text-gray-300 font-medium">{statusLabel}</span>
      </div>

      {/* État arm/disarm — LA métrique de sécurité live : un dry-run sans
          indicateur visible est un silence réseau impossible à diagnostiquer. */}
      <span
        className={`px-1.5 py-0.5 rounded font-bold flex-shrink-0 ${
          armed
            ? 'text-red-300 bg-red-900/40 border border-red-700/40'
            : 'text-emerald-400 bg-emerald-900/40 border border-emerald-700/40 animate-pulse'
        }`}
        title={armed ? 'OSC LIVE — positions sent to the renderer' : 'DRY-RUN — OSC muted, nothing is sent'}
      >
        {armed ? 'LIVE' : 'DRY-RUN'}
      </span>

      {/* Santé des flux — PSN tracking + last show-cmd (inclut TC). Un flux
          mort en silence = un follow-me gelé sans alerte : visible en
          permanence, pas en toast. */}
      {flowHealth.psnRunning && (
        <span
          className={`px-1.5 py-0.5 rounded font-bold flex-shrink-0 border ${
            flowHealth.psnAge != null && flowHealth.psnAge < 2000
              ? 'text-purple-300 bg-purple-900/40 border-purple-700/40'
              : 'text-amber-300 bg-amber-900/40 border-amber-700/40 animate-pulse'
          }`}
          title={flowHealth.psnAge != null ? `PSN tracking — dernière trame il y a ${flowHealth.psnAge}ms` : 'PSN actif, aucune trame reçue'}
        >
          {flowHealth.psnAge != null && flowHealth.psnAge < 2000 ? 'PSN ●' : 'PSN ✕'}
        </span>
      )}
      {flowHealth.showCmdAgeS != null && flowHealth.showCmdAgeS < 10 && (
        <span
          className="px-1.5 py-0.5 rounded font-bold flex-shrink-0 text-cyan-300 bg-cyan-900/40 border border-cyan-700/40"
          title={`Show-control OSC actif — dernière commande il y a ${flowHealth.showCmdAgeS.toFixed(1)}s (toute commande, pas spécifiquement le timecode)`}
        >
          OSC ●
        </span>
      )}

      {/* Vu-mètre perceptuel — legibility (vitesse angulaire perçue,
          >5°/s = illisible), looming (approche rapide), vection (champ
          tournant en bloc). Calculé à 60fps côté merge. */}
      {(() => {
        const leg = Math.max(0, ...Object.values(perceptual.legibility_deg_s));
        const parts: { label: string; warn: boolean; tip: string }[] = [];
        if (leg > 0.1)
          parts.push({ label: `${leg.toFixed(0)}°/s`, warn: leg > 5, tip: 'legibility — vitesse angulaire max perçue (MAMA)' });
        if (perceptual.looming_ms > 0.3)
          parts.push({ label: `loom ${perceptual.looming_ms.toFixed(1)}`, warn: perceptual.looming_ms > 3, tip: 'looming — vitesse d\'approche max (m/s)' });
        if (perceptual.vection > 0.7)
          parts.push({ label: `vec ${Math.round(perceptual.vection * 100)}%`, warn: true, tip: 'vection — champ en rotation cohérente' });
        return parts.length > 0 ? (
          <span
            className={`px-1.5 py-0.5 rounded font-mono flex-shrink-0 border ${
              parts.some((p) => p.warn)
                ? 'text-amber-300 bg-amber-900/40 border-amber-700/40'
                : 'text-gray-400 bg-gray-800/40 border-gray-700/40'
            }`}
            title={parts.map((p) => p.tip).join(' · ')}
          >
            {parts.map((p) => p.label).join(' ')}
          </span>
        ) : null;
      })()}

      {/* Backend absent — un silentCatch a avalé un échec IPC. Plus de
          backend = plus d'OSC, plus de recall, plus rien : visible partout. */}
      {backendDown && (
        <span
          className="px-1.5 py-0.5 rounded font-bold flex-shrink-0 text-red-300 bg-red-950/60 border border-red-800 animate-pulse"
          title="Une commande backend a échoué silencieusement — le moteur ne répond probablement plus"
        >
          BACKEND ✕
        </span>
      )}

      {/* Perf en direct — visible dès qu'un mouvement tourne */}
      {activeCount > 0 && perfStats && (
        <div className="flex items-center gap-2 font-mono flex-shrink-0">
          <span className={perfStats.fps >= 55 ? 'text-green-400' : perfStats.fps >= 30 ? 'text-yellow-400' : 'text-red-400'}>
            {perfStats.fps.toFixed(0)} FPS
          </span>
          <span className={perfStats.oscErrorRate > 0.05 ? 'text-red-400' : 'text-cyan-400'}>
            {perfStats.oscRate.toFixed(0)} osc/s
          </span>
          <span className={perfStats.cpuPercent < 50 ? 'text-gray-400' : 'text-yellow-400'}>
            {perfStats.cpuPercent.toFixed(0)}% cpu
          </span>
          {/* Télémétrie dev (merge/lock µs) — gatée derrière debugPerfVisible :
              utile au bench, pas à l'opérateur en live. */}
          {debugPerfVisible && (
            <>
              <span
                className={perfStats.mergeFrameUs < 2000 ? 'text-gray-400' : perfStats.mergeFrameUs < 8000 ? 'text-yellow-400' : 'text-red-400'}
                title="Temps de travail réel de la frame merge (µs) — budget 16.6ms"
              >
                {perfStats.mergeFrameUs < 1000
                  ? `${perfStats.mergeFrameUs.toFixed(0)}µs`
                  : `${(perfStats.mergeFrameUs / 1000).toFixed(1)}ms`} merge
              </span>
              <span
                className={perfStats.mergeLockUs < 100 ? 'text-gray-500' : perfStats.mergeLockUs < 500 ? 'text-yellow-400' : 'text-red-400'}
                title="Temps d'attente cumulé en acquisition de locks pendant la frame merge (µs) — contention"
              >
                {perfStats.mergeLockUs < 1000
                  ? `${perfStats.mergeLockUs.toFixed(0)}µs`
                  : `${(perfStats.mergeLockUs / 1000).toFixed(1)}ms`} lock
              </span>
            </>
          )}
          {perfStats.oscSuspended && (
            <span className="text-orange-400 font-bold animate-pulse">OSC SUSPENDED</span>
          )}
          {perfStats.threadDied && (
            <span className="text-red-400 font-bold animate-pulse">MERGE DEAD</span>
          )}
        </div>
      )}

      {/* Erreur compile/play — pill persistante cliquable (dismiss).
          En Perform c'est le SEUL endroit où ces erreurs survivent. */}
      {hasError && (
        <button
          onClick={() => { clearCompileError(); clearPlayError(); }}
          className="flex items-center gap-1 px-2 py-0.5 rounded bg-red-900/60 text-red-300 border border-red-700/50 hover:bg-red-900/80 transition-colors min-w-0"
          title={`${errorText} — click to dismiss`}
        >
          <TriangleAlert size={11} className="flex-shrink-0" />
          <span className="truncate max-w-[300px]">{errorText}</span>
        </button>
      )}

      <div className="flex-1" />

      {/* Destination OSC — rappel discret de où partent les positions */}
      <span className="text-gray-500 font-mono flex-shrink-0" title="OSC output destination">
        → {oscAddress}:{oscPort}
      </span>
      <span className="text-gray-400 font-mono flex-shrink-0" title="STAGESPACE version">
        v{__APP_VERSION__}
      </span>
    </footer>
  );
};

export default StatusBar;
