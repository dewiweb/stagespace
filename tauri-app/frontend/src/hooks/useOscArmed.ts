import { useEffect, useState } from 'react';
import { safeInvoke, safeListen, silentCatch } from '../utils/tauri';
import { toast } from '../utils/toast-helpers';

/// État arm/disarm OSC — une seule source pour tous les indicateurs
/// (OscArmToggle, DryRunChip, StatusBar). Le backend émet
/// `osc-armed-changed` à chaque écriture (bouton, /stagespace/arm, IPC) —
/// le listener évite la lecture-unique-au-mount qui laissait les
/// indicateurs désynchronisés.
export function useOscArmed(): [armed: boolean, setArmed: (a: boolean) => void] {
  const [armed, setArmedState] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void safeInvoke<boolean>('get_osc_armed')
      .then((a) => { if (!cancelled) setArmedState(a); })
      .catch(silentCatch);
    const un = safeListen<boolean>('osc-armed-changed', (e) => setArmedState(e.payload));
    return () => { cancelled = true; void un.then((f) => f()); };
  }, []);

  const setArmed = (a: boolean) => {
    setArmedState(a);
    safeInvoke('set_osc_armed', { armed: a }).catch((e) => {
      setArmedState(!a);
      toast.error(`OSC arm failed: ${e}`);
    });
  };

  return [armed, setArmed];
}
