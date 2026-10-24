import React from 'react';
import { TriangleAlert } from 'lucide-react';
import { useGraphStore } from '../store/useGraphStore';

/// StatusBar — bandeau persistant en bas de fenêtre, monté dans App pour
/// TOUS les modes (Edit et Perform). C'est la console de monitoring moteur :
/// statut, FPS/OSC/CPU, erreurs. La dispersion précédente (header + Toolbar
/// + topbar Perform) laissait les infos vitales démontées en mode live.
///
/// Volontairement compacte (h-7) : elle informe, elle n'actionne pas —
/// le PANIC reste dans la Toolbar/Perform top bar.
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
      {/* Statut moteur */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className={`w-2 h-2 rounded-full ${statusColor}`} />
        <span className="text-gray-300 font-medium">{statusLabel}</span>
      </div>

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
