import { useOscArmed } from '../../hooks/useOscArmed';

/// Master arm — « OSC LIVE » global. Disarmé = silence réseau total (le
/// merge et la preview 3D continuent) — l'interrupteur master de la console,
/// indépendant des badges Live/Preview par move.
/// Monté dans le Toolbar (atelier) ET le header Perform (surface live) —
/// c'est là qu'il sert réellement. L'état vient de `useOscArmed` (écouté via
/// `osc-armed-changed`) — synchronisé quelle que soit la source d'écriture.
export function OscArmToggle() {
  const [armed, setArmed] = useOscArmed();

  return (
    <button
      onClick={() => setArmed(!armed)}
      className={`px-2.5 py-1.5 text-xs font-bold rounded transition-colors flex items-center gap-1.5 ${
        armed
          ? 'bg-red-900/60 text-red-300 hover:bg-red-800/70 border border-red-700/50'
          : 'bg-gray-800 text-gray-500 hover:text-gray-300 border border-gray-700'
      }`}
      title={armed
        ? 'OSC LIVE — positions are being sent. Click for DRY-RUN (mute all OSC output)'
        : 'DRY-RUN — preview only, nothing is sent. Click to go LIVE'}
    >
      <span className={`w-2 h-2 rounded-full ${armed ? 'bg-red-400 animate-pulse' : 'bg-gray-600'}`} />
      {armed ? 'LIVE' : 'DRY-RUN'}
    </button>
  );
}
