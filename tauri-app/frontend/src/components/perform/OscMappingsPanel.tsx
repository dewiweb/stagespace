import React from 'react';
import { useGraphStore } from '../../store/useGraphStore';
import { safeInvoke, silentCatch } from '../../utils/tauri';
import { toast } from '../../utils/toast-helpers';

/// Liste + création des mappings OSC IN — destination texte
/// (`handler:name`, `macro:scale`, `channel:gain:3`, `position:2`) +
/// LEARN : bouge le fader, l'adresse se remplit toute seule.
export const OscMappingsPanel: React.FC = () => {
  const oscMappings = useGraphStore((s) => s.oscMappings);
  const addOscMapping = useGraphStore((s) => s.addOscMapping);
  const removeOscMapping = useGraphStore((s) => s.removeOscMapping);
  const setOscMappingEnabled = useGraphStore((s) => s.setOscMappingEnabled);
  const learnAddOscMapping = useGraphStore((s) => s.learnAddOscMapping);
  const [dest, setDest] = React.useState('');
  const [transform, setTransform] = React.useState('');
  const [addr, setAddr] = React.useState('');
  const [learning, setLearning] = React.useState(false);
  const [liveValues, setLiveValues] = React.useState<Record<string, number[]>>({});
  const mappings = Array.from(oscMappings.values());

  // Valeurs live : poll léger — l'opérateur voit son fader bouger dans la
  // liste (feedback immédiat du learn ET du mapping).
  React.useEffect(() => {
    const t = setInterval(() => {
      safeInvoke<Record<string, number[]>>('osc_get_all_values')
        .then((v) => setLiveValues(v ?? {}))
        .catch(silentCatch);
    }, 500);
    return () => clearInterval(t);
  }, []);

  // Sérialise le transform pour pré-remplir le formulaire à l'édition —
  // addOscMapping remplace à même adresse (insert HashMap) = update.
  const describeTransform = (t: unknown): string => {
    const tr = (t ?? {}) as Record<string, number | null>;
    const parts: string[] = [];
    const dflt: Record<string, number | null> = { scale: 1, offset: 0, smooth: 0, deadzone: 0 };
    for (const k of ['scale', 'offset', 'min', 'max', 'smooth', 'deadzone']) {
      const v = tr[k];
      if (v != null && v !== dflt[k]) parts.push(`${k}=${v}`);
    }
    return parts.join(' ');
  };

  const describe = (d: unknown): string => {
    const m = d as { kind: string };
    if (m.kind === 'channel') {
      const c = d as { channel: string; object: unknown };
      return `channel:${c.channel}:${c.object}`;
    }
    if (m.kind === 'macro') return `macro:${(d as { name: string }).name}`;
    if (m.kind === 'position') return `position:${(d as { object: unknown }).object}`;
    return `handler:${(d as { name: string }).name}`;
  };

  const doLearn = async () => {
    if (!dest.trim()) {
      toast.warning('Enter a destination first (e.g. channel:gain:3 or macro:scale)');
      return;
    }
    setLearning(true);
    const learned = await learnAddOscMapping(dest.trim(), transform.trim() || null);
    setLearning(false);
    if (learned) toast.success(`Learned → ${learned}`);
    else toast.warning('OSC learn timed out — move the fader/knob');
  };

  return (
    <div className="px-4 py-3 space-y-2 text-xs">
      <div className="text-gray-400 uppercase tracking-wider">OSC IN mappings ({mappings.length})</div>
      {mappings.map((m) => (
        <div key={m.address} className={`flex items-center gap-2 py-1 border-b border-gray-800/50 ${m.enabled === false ? 'opacity-40' : ''}`}>
          <input
            type="checkbox"
            checked={m.enabled !== false}
            onChange={(e) => void setOscMappingEnabled(m.address, e.target.checked)}
            className="w-4 h-4 flex-shrink-0"
            title={m.enabled !== false ? 'Disable (kept, no dispatch)' : 'Enable'}
          />
          <span className="text-cyan-300 font-mono truncate flex-1">{m.address}</span>
          {liveValues[m.address] && (
            <span className="text-green-400/80 font-mono text-[10px] tabular-nums">
              {liveValues[m.address].map((v) => v.toFixed(2)).join(' ')}
            </span>
          )}
          <span className="text-gray-400">→</span>
          <span className="text-gray-200">{describe(m.destination)}</span>
          <button
            onClick={() => {
              setAddr(m.address);
              setDest(describe(m.destination));
              setTransform(describeTransform(m.transform));
            }}
            className="text-gray-500 hover:text-cyan-300 px-1"
            title="Edit — pré-remplit le formulaire (Add remplace à même adresse)"
          >
            ✎
          </button>
          <button
            onClick={() => void removeOscMapping(m.address)}
            className="text-gray-600 hover:text-red-400 px-1"
            title="Remove mapping"
          >
            ✕
          </button>
        </div>
      ))}
      {mappings.length === 0 && <div className="text-gray-600 italic">No mappings yet</div>}
      <div className="flex items-center gap-2 pt-1">
        <input
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder="/fader/1"
          className="w-44 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-200 font-mono"
        />
        <span className="text-gray-500">→</span>
        <input
          value={dest}
          onChange={(e) => setDest(e.target.value)}
          placeholder="channel:gain:3 | macro:scale | handler:hp"
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-200 font-mono"
        />
        <input
          value={transform}
          onChange={(e) => setTransform(e.target.value)}
          placeholder="scale=… (opt)"
          className="w-28 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-200 font-mono"
        />
        <button
          onClick={() => {
            if (!addr.trim() || !dest.trim()) { toast.warning('Address + destination required'); return; }
            void addOscMapping(addr.trim(), dest.trim(), transform.trim() || null);
            setAddr('');
          }}
          className="px-3 py-1.5 rounded bg-indigo-600 text-white font-semibold"
        >
          Add
        </button>
        <button
          onClick={() => void doLearn()}
          disabled={learning}
          className={`px-4 py-1.5 rounded font-bold ${learning ? 'bg-cyan-600 animate-pulse' : 'bg-cyan-700 hover:bg-cyan-600'} text-white`}
          title="OSC learn — bouge le fader : l'adresse se remplit"
        >
          {learning ? 'MOVE…' : 'LEARN'}
        </button>
      </div>
    </div>
  );
};
