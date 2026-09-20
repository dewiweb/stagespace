import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useModalGuard } from '../utils/modalGuard';

const OSC_PROFILES = [
  { value: 'holophonix', label: 'Holophonix' },
  { value: 'iem', label: 'IEM MultiEncoder' },
  { value: 'ircam', label: 'IRCAM Spat' },
  { value: 'adm', label: 'ADM-OSC' },
  { value: 'generic', label: 'Generic Cartesian' },
  { value: 'generic_polar', label: 'Generic Polar' },
];

export const SettingsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const {
    oscAddress, oscPort, oscProfile, oscInPort,
    setOscAddress, setOscPort, setOscProfile, setOscInPort,
    manualOscIds, setManualOscIds,
    selectedAudioDeviceId, setSelectedAudioDeviceId,
  } = useGraphStore();

  const [oscIdsStr, setOscIdsStr] = React.useState(manualOscIds.join(','));
  const [audioDevices, setAudioDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [oscInPortStr, setOscInPortStr] = React.useState(String(oscInPort));
  const [oscInStatus, setOscInStatus] = React.useState<string | null>(null);

  // Énumérer les devices audio
  React.useEffect(() => {
    (async () => {
      try {
        if (navigator.mediaDevices?.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          setAudioDevices(devices.filter((d) => d.kind === 'audioinput'));
        }
      } catch {
        // Silently fail — l'utilisateur n'a peut-être pas encore donné la permission
      }
    })();
  }, []);

  // Ce composant est un modal — bloque les raccourcis live (Esc=panic…)
  useModalGuard();

  // Fermer avec Escape — preventDefault pour que le handler global
  // (Toolbar) voie e.defaultPrevented et ne déclenche pas panic().
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleOscIdsChange = (value: string) => {
    setOscIdsStr(value);
    const parsed = value
      .split(',')
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id));
    setManualOscIds(parsed);
  };

  const handleOscInPortApply = async () => {
    const port = parseInt(oscInPortStr, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      setOscInStatus('Invalid port number');
      return;
    }
    setOscInStatus('Applying...');
    try {
      await setOscInPort(port);
      setOscInStatus(`Listening on port ${port}`);
    } catch (e: any) {
      setOscInStatus(`Error: ${e?.message ?? e}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[520px] max-h-[80vh] overflow-y-auto bg-stagespace-panel border border-stagespace-border rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-stagespace-border">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚙</span>
            <h2 className="text-white font-semibold text-sm">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* ─── OSC OUT ─── */}
          <section>
            <h3 className="text-gray-400 text-[11px] font-bold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <span className="text-blue-400">→</span> OSC Output
            </h3>
            <p className="text-gray-600 text-[10px] mb-3">
              Where to send positions (Holophonix, SPAT, IEM, etc.)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-gray-500 text-[11px] block mb-1">Host</label>
                <input
                  type="text"
                  value={oscAddress}
                  onChange={(e) => setOscAddress(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
                  placeholder="127.0.0.1"
                />
              </div>
              <div>
                <label className="text-gray-500 text-[11px] block mb-1">Port</label>
                <input
                  type="number"
                  value={oscPort}
                  onChange={(e) => setOscPort(Number(e.target.value) || 0)}
                  className="w-full px-2.5 py-1.5 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="col-span-2">
                <label className="text-gray-500 text-[11px] block mb-1">Profile</label>
                <select
                  value={oscProfile}
                  onChange={(e) => setOscProfile(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
                >
                  {OSC_PROFILES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* ─── OSC IN ─── */}
          <section>
            <h3 className="text-gray-400 text-[11px] font-bold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <span className="text-green-400">←</span> OSC Input
            </h3>
            <p className="text-gray-600 text-[10px] mb-3">
              Port to listen for incoming OSC messages (triggers, parameter overrides)
            </p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-gray-500 text-[11px] block mb-1">Receiver Port</label>
                <input
                  type="number"
                  value={oscInPortStr}
                  onChange={(e) => setOscInPortStr(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none font-mono"
                />
              </div>
              <button
                onClick={handleOscInPortApply}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded transition-colors"
              >
                Apply
              </button>
            </div>
            {oscInStatus && (
              <p className={`text-[10px] mt-1.5 ${oscInStatus.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
                {oscInStatus}
              </p>
            )}
          </section>

          {/* ─── Track IDs ─── */}
          <section>
            <h3 className="text-gray-400 text-[11px] font-bold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <span className="text-purple-400">◆</span> Track IDs
            </h3>
            <p className="text-gray-600 text-[10px] mb-3">
              Virtual track IDs when no .hol project is loaded
            </p>
            <input
              type="text"
              value={oscIdsStr}
              onChange={(e) => handleOscIdsChange(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none font-mono"
              placeholder="1,2,3..."
            />
          </section>

          {/* ─── Audio Input ─── */}
          <section>
            <h3 className="text-gray-400 text-[11px] font-bold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <span className="text-cyan-400">♪</span> Audio Input
            </h3>
            <p className="text-gray-600 text-[10px] mb-3">
              Microphone / audio interface for audio-reactive trajectories
            </p>
            {audioDevices.length > 0 ? (
              <select
                value={selectedAudioDeviceId ?? ''}
                onChange={(e) => setSelectedAudioDeviceId(e.target.value || null)}
                className="w-full px-2.5 py-1.5 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
              >
                <option value="">System default</option>
                {audioDevices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Audio device ${i + 1}`}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-gray-600 text-[10px] italic">
                Start the microphone once to enumerate available devices.
              </p>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-stagespace-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-white text-xs font-medium rounded transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
