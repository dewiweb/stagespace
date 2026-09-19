import React from 'react';
import { useGraphStore, useOscValueListener } from '../store/useGraphStore';
import { describeDestination } from '../store/slices/oscSlice';

export default function OscPanel() {
  const { oscMappings, oscValues, addOscMapping, removeOscMapping, listOscMappings, setOscInEnabled } = useGraphStore();

  const [address, setAddress] = React.useState('');
  const [handler, setHandler] = React.useState('');
  const [transform, setTransform] = React.useState('');
  const [inEnabled, setInEnabled] = React.useState(true);

  useOscValueListener();

  React.useEffect(() => {
    listOscMappings().then((mappings) => {
      useGraphStore.setState({ oscMappings: new Map(mappings.map((m) => [m.address, m])) });
    });
  }, [listOscMappings]);

  const handleAdd = async () => {
    if (!address.trim() || !handler.trim()) return;
    try {
      await addOscMapping(address.trim(), handler.trim(), transform.trim() || null);
      setAddress('');
      setHandler('');
      setTransform('');
    } catch (e) {
      console.error('Failed to add mapping:', e);
    }
  };

  const handleRemove = async (addr: string) => {
    try {
      await removeOscMapping(addr);
    } catch (e) {
      console.error('Failed to remove mapping:', e);
    }
  };

  const mappingsArr = Array.from(oscMappings.entries());
  const valuesArr = Array.from(oscValues.entries());

  return (
    <div className="p-3 h-full flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center">
          <span className="text-white text-[10px]">OSC</span>
        </div>
        <h3 className="text-white font-semibold text-sm">OSC Input</h3>
        <button
          onClick={() => {
            const next = !inEnabled;
            setOscInEnabled(next)
              .then(() => setInEnabled(next))
              .catch((e) => console.error('Failed to toggle OSC IN:', e));
          }}
          className={`ml-auto px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
            inEnabled ? 'bg-orange-600/80 text-white' : 'bg-gray-700 text-gray-400'
          }`}
          title="Active/désactive le routage OSC IN (anti-loop lors des recalls)"
        >
          {inEnabled ? 'IN on' : 'IN off'}
        </button>
      </div>

      {/* Add Mapping */}
      <div className="space-y-1.5">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Address (e.g. /track/1/x)"
          className="w-full px-2.5 py-1.5 bg-gray-800 text-white text-xs rounded border border-gray-700 focus:border-orange-500 focus:outline-none"
        />
        <input
          type="text"
          value={handler}
          onChange={(e) => setHandler(e.target.value)}
          placeholder="Destination (handler:name, macro:scale, channel:gain:3, position:2)"
          className="w-full px-2.5 py-1.5 bg-gray-800 text-white text-xs rounded border border-gray-700 focus:border-orange-500 focus:outline-none"
        />
        <input
          type="text"
          value={transform}
          onChange={(e) => setTransform(e.target.value)}
          placeholder="Transform (optional, e.g. scale=2 offset=1 min=0 max=1 smooth=0.5)"
          className="w-full px-2.5 py-1.5 bg-gray-800 text-white text-xs rounded border border-gray-700 focus:border-orange-500 focus:outline-none font-mono"
        />
        <button
          onClick={handleAdd}
          disabled={!address.trim() || !handler.trim()}
          className="w-full py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add Mapping
        </button>
      </div>

      {/* Mappings */}
      <div className="flex-1 overflow-y-auto space-y-2">
        <div>
          <h4 className="text-gray-500 text-[10px] font-semibold mb-1.5 uppercase tracking-wider">
            Mappings ({mappingsArr.length})
          </h4>
          {mappingsArr.length === 0 ? (
            <div className="text-gray-600 text-[11px] text-center py-3 bg-gray-800/30 rounded border border-gray-700/30">
              No mappings
            </div>
          ) : (
            <div className="space-y-1">
              {mappingsArr.map(([addr, mapping]) => (
                <div key={addr} className="p-2 bg-gray-800/50 rounded border border-gray-700/50 hover:border-orange-700/50 transition-colors">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-[11px] font-mono font-medium truncate">{addr}</div>
                      <div className="text-gray-500 text-[10px] truncate">→ {describeDestination(mapping.destination)}</div>
                      {mapping.transform && (mapping.transform.scale !== 1 || mapping.transform.offset !== 0 || mapping.transform.min !== null || mapping.transform.max !== null || mapping.transform.smooth !== 0 || mapping.transform.deadzone !== 0) && (
                        <div className="text-gray-600 text-[10px] truncate font-mono mt-0.5">
                          scale={mapping.transform.scale} offset={mapping.transform.offset}
                          {mapping.transform.min !== null && ` min=${mapping.transform.min}`}
                          {mapping.transform.max !== null && ` max=${mapping.transform.max}`}
                          {mapping.transform.smooth !== 0 && ` smooth=${mapping.transform.smooth}`}
                          {mapping.transform.deadzone !== 0 && ` dz=${mapping.transform.deadzone}`}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemove(addr)}
                      className="text-red-400 hover:text-red-300 text-[11px] ml-2"
                      aria-label="Remove mapping"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live Values */}
        <div>
          <h4 className="text-gray-500 text-[10px] font-semibold mb-1.5 uppercase tracking-wider">
            Live Values ({valuesArr.length})
          </h4>
          {valuesArr.length === 0 ? (
            <div className="text-gray-600 text-[11px] text-center py-3 bg-gray-800/30 rounded border border-gray-700/30">
              No values received
            </div>
          ) : (
            <div className="space-y-1">
              {valuesArr.map(([handler, value]) => (
                <div key={handler} className="p-2 bg-gray-800/50 rounded border border-gray-700/50">
                  <div className="text-white text-[11px] font-medium mb-0.5">{handler}</div>
                  <div className="text-gray-400 text-[10px] font-mono">{JSON.stringify(value)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
