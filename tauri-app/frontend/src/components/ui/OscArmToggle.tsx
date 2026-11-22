import { useOscArmed } from '../../hooks/useOscArmed';

/// Master arm — « OSC LIVE » global. Disarmé = silence réseau total (le
/// merge et la preview 3D continuent) — l'interrupteur master de la console,
/// indépendant des badges Live/Preview par move.
/// Monté dans le header Perform (surface live) — en Atelier et partout
/// ailleurs, le chip LIVE/DRY-RUN de la StatusBar est le contrôle.
/// `lg` = topbar Perform (py-2.5 rounded-lg, même gabarit que GO/PANIC).
export function OscArmToggle({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const [armed, setArmed] = useOscArmed();
  const sizing = size === 'lg'
    ? 'px-3 py-2.5 text-xs rounded-lg'
    : 'px-2.5 py-1.5 text-xs rounded';

  return (
    <button
      onClick={() => setArmed(!armed)}
      className={`${sizing} font-bold transition-colors flex items-center gap-1.5 ${
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
