import React from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { safeInvoke as invoke } from '../utils/tauri';
import { toast } from '../utils/toast-helpers';
import Modal from './ui/Modal';
import EmptyState from './ui/EmptyState';
import { Settings, ListOrdered } from 'lucide-react';

const MERGE_STRATEGIES = [
  { value: 'override', label: 'Override — strongest fade wins', hint: 'Latest/fading-in move takes contested tracks' },
  { value: 'crossfade', label: 'Crossfade — weighted blend', hint: 'Positions mixed by fade × weight' },
  { value: 'blend', label: 'Blend — weighted average', hint: 'All active moves contribute' },
  { value: 'priority', label: 'Priority — highest priority wins', hint: 'set_move_priority decides per track' },
];

const OSC_PROFILES = [
  { value: 'holophonix', label: 'Holophonix' },
  { value: 'iem', label: 'IEM MultiEncoder' },
  { value: 'ircam', label: 'IRCAM Spat' },
  { value: 'adm', label: 'ADM-OSC' },
  { value: 'generic', label: 'Generic Cartesian' },
  { value: 'generic_polar', label: 'Generic Polar' },
];

export const SettingsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const oscAddress = useGraphStore((s) => s.oscAddress);
  const oscPort = useGraphStore((s) => s.oscPort);
  const oscProfile = useGraphStore((s) => s.oscProfile);
  const oscInPort = useGraphStore((s) => s.oscInPort);
  const setOscAddress = useGraphStore((s) => s.setOscAddress);
  const setOscPort = useGraphStore((s) => s.setOscPort);
  const setOscProfile = useGraphStore((s) => s.setOscProfile);
  const setOscInPort = useGraphStore((s) => s.setOscInPort);
  const manualOscIds = useGraphStore((s) => s.manualOscIds);
  const setManualOscIds = useGraphStore((s) => s.setManualOscIds);
  const selectedAudioDeviceId = useGraphStore((s) => s.selectedAudioDeviceId);
  const setSelectedAudioDeviceId = useGraphStore((s) => s.setSelectedAudioDeviceId);
  const mergeStrategy = useGraphStore((s) => s.mergeStrategy);
  const setMergeStrategy = useGraphStore((s) => s.setMergeStrategy);
  const psnEnabled = useGraphStore((s) => s.psnEnabled);
  const psnGroup = useGraphStore((s) => s.psnGroup);
  const psnPort = useGraphStore((s) => s.psnPort);
  const psnMap = useGraphStore((s) => s.psnMap);
  const psnAxes = useGraphStore((s) => s.psnAxes);
  const psnRunning = useGraphStore((s) => s.psnRunning);
  const psnLastPacketAge = useGraphStore((s) => s.psnLastPacketAge);
  const setPsnConfig = useGraphStore((s) => s.setPsnConfig);

  const [oscIdsStr, setOscIdsStr] = React.useState(manualOscIds.join(','));
  const [audioDevices, setAudioDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [oscInPortStr, setOscInPortStr] = React.useState(String(oscInPort));
  const [psnGroupStr, setPsnGroupStr] = React.useState(psnGroup);
  const [psnPortStr, setPsnPortStr] = React.useState(String(psnPort));
  const [psnMapStr, setPsnMapStr] = React.useState(psnMap);
  const [psnAxesStr, setPsnAxesStr] = React.useState(psnAxes);
  const [oscInStatus, setOscInStatus] = React.useState<string | null>(null);
  const [discovering, setDiscovering] = React.useState(false);
  const [discoveredTargets, setDiscoveredTargets] = React.useState<Array<{ name: string; host: string; port: number; profile: string; source: string }>>([]);

  const handleDiscover = async () => {
    setDiscovering(true);
    try {
      const targets = await invoke<Array<{ name: string; host: string; port: number; profile: string; source: string }>>('discover_osc_targets');
      setDiscoveredTargets(targets);
    } catch (e) {
      console.error('Discovery failed:', e);
      toast.error(`OSC discovery failed: ${e}`);
    } finally {
      setDiscovering(false);
    }
  };

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
    <Modal
      title={
        <span className="flex items-center gap-2">
          <Settings size={16} /> Settings
        </span>
      }
      onClose={onClose}
      widthClass="max-w-[520px]"
    >
        <div className="px-5 py-4 space-y-5">
          {/* ─── OSC OUT ─── */}
          <section>
            <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <span className="text-blue-400">→</span> OSC Output
            </h3>
            <p className="text-gray-400 text-xs mb-3">
              Where to send positions (Holophonix, SPAT, IEM, etc.)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-gray-500 text-xs block mb-1">Host</label>
                <input
                  type="text"
                  value={oscAddress}
                  onChange={(e) => setOscAddress(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
                  placeholder="127.0.0.1"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Port</label>
                <input
                  type="number"
                  value={oscPort}
                  onChange={(e) => setOscPort(Number(e.target.value) || 0)}
                  className="w-full px-2.5 py-1.5 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="col-span-2">
                <label className="text-gray-500 text-xs block mb-1">Profile</label>
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
            {/* Discovery — source unique (le panneau inline de la Toolbar a
                été retiré : une seule surface d'édition OSC évite le fork
                mental "quelle config est la vraie"). */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button
                onClick={handleDiscover}
                disabled={discovering}
                className="px-3 py-1.5 text-xs font-medium rounded bg-cyan-700 hover:bg-cyan-600 text-white transition-colors disabled:opacity-40"
              >
                {discovering ? 'Scanning…' : 'Discover renderers'}
              </button>
              {discoveredTargets.map((t, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setOscAddress(t.host);
                    setOscPort(t.port);
                    setOscProfile(t.profile);
                  }}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    t.source === 'mdns'
                      ? 'bg-green-900/40 border-green-700/50 text-green-400 hover:bg-green-900/60'
                      : t.source === 'scan'
                        ? 'bg-blue-900/40 border-blue-700/50 text-blue-400 hover:bg-blue-900/60'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                  }`}
                  title={`${t.source}: ${t.host}:${t.port}`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </section>

          {/* ─── OSC IN ─── */}
          <section>
            <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <span className="text-green-400">←</span> OSC Input
            </h3>
            <p className="text-gray-400 text-xs mb-3">
              Port to listen for incoming OSC messages (triggers, parameter overrides)
            </p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-gray-500 text-xs block mb-1">Receiver Port</label>
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
              <p className={`text-xs mt-1.5 ${oscInStatus.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
                {oscInStatus}
              </p>
            )}
          </section>

          {/* ─── PSN / Tracking ─── */}
          <section>
            <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <span className="text-purple-400">◎</span> PSN / RTTrP Tracking
            </h3>
            <p className="text-gray-400 text-xs mb-3">
              PosiStageNet tracking (BlackTrax, Zactrack, Follow-Me) — tracker positions
              feed manual positions of the mapped objects.
            </p>
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setPsnConfig({ enabled: !psnEnabled, group: psnGroupStr, port: parseInt(psnPortStr) || 56565, map: psnMapStr })}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  psnEnabled ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                {psnEnabled ? 'ON' : 'OFF'}
              </button>
              <span className={`text-xs ${psnRunning ? 'text-green-400' : 'text-gray-500'}`}>
                {psnRunning
                  ? psnLastPacketAge != null
                    ? `flux ${psnLastPacketAge < 2000 ? 'vivant' : `stale (${Math.round(psnLastPacketAge / 1000)}s)`}`
                    : 'en écoute…'
                  : 'arrêté'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="col-span-2">
                <label className="text-gray-500 text-xs block mb-1">Multicast group</label>
                <input
                  type="text"
                  value={psnGroupStr}
                  onChange={(e) => setPsnGroupStr(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none font-mono"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Port</label>
                <input
                  type="number"
                  value={psnPortStr}
                  onChange={(e) => setPsnPortStr(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none font-mono"
                />
              </div>
            </div>
            <div>
              <label className="text-gray-500 text-xs block mb-1">Map tracker→track ("1:7, 2:8" — tracker 1 pilote la track 7)</label>
              <input
                type="text"
                value={psnMapStr}
                onChange={(e) => setPsnMapStr(e.target.value)}
                onBlur={() => setPsnConfig({ map: psnMapStr })}
                placeholder="1:7, 2:8, 3:9"
                className="w-full px-2.5 py-1.5 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none font-mono"
              />
            </div>
            <div className="mt-2">
              <label className="text-gray-500 text-xs block mb-1">Axes PSN→stage ("x,-y,z" — convention variable selon installateur)</label>
              <input
                type="text"
                value={psnAxesStr}
                onChange={(e) => setPsnAxesStr(e.target.value)}
                onBlur={() => setPsnConfig({ axes: psnAxesStr })}
                placeholder="x,y,z"
                className="w-full px-2.5 py-1.5 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none font-mono"
              />
            </div>
          </section>

          {/* ─── Merge ─── */}
          <section>
            <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <span className="text-amber-400">⇄</span> Merge
            </h3>
            <p className="text-gray-400 text-xs mb-3">
              How contested tracks resolve when several playing moves target the same track.
              A Merge node in the global graph can also set this — last writer wins.
            </p>
            <select
              value={mergeStrategy}
              onChange={(e) => setMergeStrategy(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-gray-900 text-white text-xs rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
            >
              {MERGE_STRATEGIES.map((s) => (
                <option key={s.value} value={s.value} title={s.hint}>{s.label}</option>
              ))}
            </select>
          </section>

          {/* ─── Track IDs ─── */}
          <section>
            <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <ListOrdered size={11} className="text-purple-400" /> Track IDs
            </h3>
            <p className="text-gray-400 text-xs mb-3">
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
            <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <span className="text-cyan-400">♪</span> Audio Input
            </h3>
            <p className="text-gray-400 text-xs mb-3">
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
              <EmptyState size="sm" title="No device listed" hint="Start the microphone once to enumerate available devices." />
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
    </Modal>
  );
};
