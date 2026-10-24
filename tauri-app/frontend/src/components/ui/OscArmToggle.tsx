import React from 'react';
import { safeInvoke } from '../../utils/tauri';
import { toast } from '../../utils/toast-helpers';

/// Master arm — « OSC LIVE » global. Disarmé = silence réseau total (le
/// merge et la preview 3D continuent) — l'interrupteur master de la console,
/// indépendant des badges Live/Preview par move.
/// Monté dans le Toolbar (atelier) ET le header Perform (surface live) —
/// c'est là qu'il sert réellement.
export function OscArmToggle() {
  const [armed, setArmed] = React.useState(true);
  React.useEffect(() => {
    safeInvoke<boolean>('get_osc_armed').then(setArmed).catch(() => {});
  }, []);

  return (
    <button
      onClick={async () => {
        const next = !armed;
        setArmed(next);
        try {
          await safeInvoke('set_osc_armed', { armed: next });
        } catch (e) {
          setArmed(!next);
          toast.error(`OSC arm failed: ${e}`);
        }
      }}
      className={`px-2.5 py-1.5 text-xs font-bold rounded transition-colors flex items-center gap-1.5 ${
        armed
          ? 'bg-red-900/60 text-red-300 hover:bg-red-800/70 border border-red-700/50'
          : 'bg-gray-800 text-gray-500 hover:text-gray-300 border border-gray-700'
      }`}
      title={armed
        ? 'OSC LIVE — positions are being sent. Click to mute all OSC output'
        : 'OSC muted — preview only, nothing is sent. Click to go LIVE'}
    >
      <span className={`w-2 h-2 rounded-full ${armed ? 'bg-red-400 animate-pulse' : 'bg-gray-600'}`} />
      {armed ? 'LIVE' : 'MUTED'}
    </button>
  );
}
