import React from 'react';
import { toast } from '../utils/toast-helpers';
import { useGraphStore } from '../store/useGraphStore';
import {
  SPATIAL_CHANNELS,
  describeChannels,
  describeZoneShape,
  parseChannelsSpec,
  parseObjectsSpec,
  parseVec3,
  type KinematicSourceName,
  type SpatialChannelName,
} from '../store/slices/spatialFxSlice';

const inputCls =
  'w-full px-2.5 py-1.5 bg-gray-800 text-white text-xs rounded border border-gray-700 focus:border-cyan-500 focus:outline-none';
const selectCls =
  'w-full px-2 py-1.5 bg-gray-800 text-white text-xs rounded border border-gray-700 focus:border-cyan-500 focus:outline-none';
const removeBtnCls = 'text-red-400 hover:text-red-300 text-[11px] ml-2 flex-shrink-0';

function Section({
  title,
  count,
  onClear,
  children,
}: {
  title: string;
  count: number;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-gray-500 text-[10px] font-semibold uppercase tracking-wider">
          {title} ({count})
        </h4>
        {onClear && count > 0 && (
          <button onClick={onClear} className="text-gray-600 hover:text-red-400 text-[10px]">
            clear all
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

export default function SpatialFxPanel() {
  // Sélecteurs granulaires — pas de full-store subscribe (60fps jank)
  const zones = useGraphStore((s) => s.zones);
  const modulations = useGraphStore((s) => s.modulations);
  const objectChannels = useGraphStore((s) => s.objectChannels);
  const graphZones = useGraphStore((s) => s.graphZones);
  const graphModulations = useGraphStore((s) => s.graphModulations);
  const refreshSpatialFx = useGraphStore((s) => s.refreshSpatialFx);
  const addZone = useGraphStore((s) => s.addZone);
  const removeZone = useGraphStore((s) => s.removeZone);
  const clearZones = useGraphStore((s) => s.clearZones);
  const addModulation = useGraphStore((s) => s.addModulation);
  const removeModulation = useGraphStore((s) => s.removeModulation);
  const clearModulations = useGraphStore((s) => s.clearModulations);
  const setKinematicSmoothing = useGraphStore((s) => s.setKinematicSmoothing);
  const setSpatialChannel = useGraphStore((s) => s.setSpatialChannel);
  const clearSpatialChannel = useGraphStore((s) => s.clearSpatialChannel);
  const clearAllSpatialChannels = useGraphStore((s) => s.clearAllSpatialChannels);

  // ── Zone form state ──
  const [zShape, setZShape] = React.useState<'sphere' | 'box'>('sphere');
  const [zA, setZA] = React.useState('0,0,0');
  const [zRadius, setZRadius] = React.useState('2');
  const [zB, setZB] = React.useState('1,1,1');
  const [zFalloff, setZFalloff] = React.useState('0.5');
  const [zChannels, setZChannels] = React.useState('');
  const [zObjects, setZObjects] = React.useState('');

  // ── Modulation form state ──
  const [mSource, setMSource] = React.useState<KinematicSourceName>('Speed');
  const [mChannel, setMChannel] = React.useState<SpatialChannelName>('Spread');
  const [mScale, setMScale] = React.useState('0.1');
  const [mOffset, setMOffset] = React.useState('');
  const [mMin, setMMin] = React.useState('');
  const [mMax, setMMax] = React.useState('');
  const [mObject, setMObject] = React.useState('');
  const [mListener, setMListener] = React.useState('0,0,0');
  const [smoothing, setSmoothing] = React.useState('0.5');

  // ── Channel form state ──
  const [cObject, setCObject] = React.useState('');
  const [cChannel, setCChannel] = React.useState<SpatialChannelName>('Gain');
  const [cValue, setCValue] = React.useState('');

  React.useEffect(() => {
    refreshSpatialFx();
  }, [refreshSpatialFx]);

  const handleAddZone = async () => {
    const a = parseVec3(zA);
    const channels = parseChannelsSpec(zChannels);
    if (!a || Object.keys(channels).length === 0) return;
    try {
      await addZone({
        shape: zShape,
        a,
        radius: zShape === 'sphere' ? parseFloat(zRadius) || 1 : null,
        b: zShape === 'box' ? parseVec3(zB) : null,
        falloff: parseFloat(zFalloff) || 0,
        channels,
        objects: parseObjectsSpec(zObjects),
      });
      setZChannels('');
    } catch (e) {
      console.error('Failed to add zone:', e);
      toast.error(`Add zone failed: ${e}`);
    }
  };

  const handleAddModulation = async () => {
    const scale = parseFloat(mScale);
    if (isNaN(scale)) return;
    const num = (s: string) => (s.trim() === '' ? null : parseFloat(s));
    try {
      const sourceMap: Record<string, 'speed' | 'accel' | 'jerk' | 'angvel'> = {
        Speed: 'speed',
        Acceleration: 'accel',
        Jerk: 'jerk',
        AngularSpeed: 'angvel',
      };
      await addModulation({
        source: sourceMap[mSource] ?? 'speed',
        channel: mChannel.toLowerCase(),
        scale,
        offset: num(mOffset),
        min: num(mMin),
        max: num(mMax),
        object_index: mObject.trim() === '' ? null : parseInt(mObject, 10),
        listener: mSource === 'AngularSpeed' ? parseVec3(mListener) : null,
      });
    } catch (e) {
      console.error('Failed to add modulation:', e);
      toast.error(`Add modulation failed: ${e}`);
    }
  };

  const handleSetChannel = async () => {
    const obj = parseInt(cObject, 10);
    const val = parseFloat(cValue);
    if (isNaN(obj) || isNaN(val)) return;
    try {
      await setSpatialChannel(obj, cChannel.toLowerCase(), val);
    } catch (e) {
      console.error('Failed to set channel:', e);
      toast.error(`Set channel failed: ${e}`);
    }
  };

  const channelEntries = Object.entries(objectChannels);

  return (
    <div className="p-3 h-full flex flex-col gap-3 overflow-y-auto">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
          <span className="text-white text-[10px]">FX</span>
        </div>
        <h3 className="text-white font-semibold text-sm">Spatial FX</h3>
      </div>

      {/* ── Zones ── */}
      <Section title="Zones" count={zones.length} onClear={() => clearZones().catch((e) => toast.error(`Spatial FX failed: ${e}`))}>
        <div className="space-y-1.5 mb-2">
          <div className="flex gap-1.5">
            <select value={zShape} onChange={(e) => setZShape(e.target.value as 'sphere' | 'box')} className={selectCls}>
              <option value="sphere">Sphere</option>
              <option value="box">Box</option>
            </select>
            <input
              type="text"
              value={zFalloff}
              onChange={(e) => setZFalloff(e.target.value)}
              placeholder="falloff"
              className={inputCls}
              title="Falloff width (transition douce au-delà du bord)"
            />
          </div>
          <input
            type="text"
            value={zA}
            onChange={(e) => setZA(e.target.value)}
            placeholder={zShape === 'sphere' ? 'center x,y,z' : 'min x,y,z'}
            className={`${inputCls} font-mono`}
          />
          {zShape === 'sphere' ? (
            <input
              type="text"
              value={zRadius}
              onChange={(e) => setZRadius(e.target.value)}
              placeholder="radius"
              className={`${inputCls} font-mono`}
            />
          ) : (
            <input
              type="text"
              value={zB}
              onChange={(e) => setZB(e.target.value)}
              placeholder="max x,y,z"
              className={`${inputCls} font-mono`}
            />
          )}
          <input
            type="text"
            value={zChannels}
            onChange={(e) => setZChannels(e.target.value)}
            placeholder="channels: gain=0,spread=1"
            className={`${inputCls} font-mono`}
          />
          <input
            type="text"
            value={zObjects}
            onChange={(e) => setZObjects(e.target.value)}
            placeholder="objects (optional: 0,1,2 — empty = all)"
            className={`${inputCls} font-mono`}
          />
          <button
            onClick={handleAddZone}
            disabled={!parseVec3(zA) || Object.keys(parseChannelsSpec(zChannels)).length === 0}
            className="w-full py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white text-xs rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add Zone
          </button>
        </div>
        {zones.length === 0 ? (
          <div className="text-gray-600 text-[11px] text-center py-2 bg-gray-800/30 rounded border border-gray-700/30">
            No zones
          </div>
        ) : (
          <div className="space-y-1">
            {zones.map((zone, i) => (
              <div key={i} className="p-2 bg-gray-800/50 rounded border border-gray-700/50">
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-[11px] font-mono">{describeZoneShape(zone.shape)}</div>
                    <div className="text-gray-500 text-[10px] truncate">
                      {describeChannels(zone.channels)}
                      {zone.falloff > 0 && ` · falloff=${zone.falloff}`}
                      {zone.objects && ` · objs=[${zone.objects.join(',')}]`}
                      {!zone.enabled && ' · disabled'}
                    </div>
                  </div>
                  <button onClick={() => removeZone(i).catch((e) => toast.error(`Spatial FX failed: ${e}`))} className={removeBtnCls} aria-label="Remove zone">
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Kinematic modulations ── */}
      <Section title="Modulations" count={modulations.length} onClear={() => clearModulations().catch((e) => toast.error(`Spatial FX failed: ${e}`))}>
        <div className="space-y-1.5 mb-2">
          <div className="flex gap-1.5">
            <select value={mSource} onChange={(e) => setMSource(e.target.value as KinematicSourceName)} className={selectCls}>
              <option value="Speed">speed</option>
              <option value="Acceleration">accel</option>
              <option value="Jerk">jerk</option>
              <option value="AngularSpeed">angvel°/s</option>
            </select>
            <span className="text-gray-600 self-center text-xs">→</span>
            <select value={mChannel} onChange={(e) => setMChannel(e.target.value as SpatialChannelName)} className={selectCls}>
              {SPATIAL_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c.toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-1.5">
            <input type="text" value={mScale} onChange={(e) => setMScale(e.target.value)} placeholder="scale" className={`${inputCls} font-mono`} />
            <input type="text" value={mOffset} onChange={(e) => setMOffset(e.target.value)} placeholder="offset" className={`${inputCls} font-mono`} />
          </div>
          <div className="flex gap-1.5">
            <input type="text" value={mMin} onChange={(e) => setMMin(e.target.value)} placeholder="min (-∞)" className={`${inputCls} font-mono`} />
            <input type="text" value={mMax} onChange={(e) => setMMax(e.target.value)} placeholder="max (+∞)" className={`${inputCls} font-mono`} />
            <input type="text" value={mObject} onChange={(e) => setMObject(e.target.value)} placeholder="obj (all)" className={`${inputCls} font-mono`} />
          </div>
          {mSource === 'AngularSpeed' && (
            <div className="flex gap-1.5">
              <input
                type="text"
                value={mListener}
                onChange={(e) => setMListener(e.target.value)}
                placeholder="listener x,y,z"
                className={`${inputCls} font-mono`}
                title="Position du point d'écoute — la vitesse angulaire est mesurée autour de ce point (°/s)"
              />
            </div>
          )}
          <button
            onClick={handleAddModulation}
            disabled={isNaN(parseFloat(mScale))}
            className="w-full py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white text-xs rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add Modulation
          </button>
          <div className="flex gap-1.5 items-center">
            <input
              type="text"
              value={smoothing}
              onChange={(e) => setSmoothing(e.target.value)}
              placeholder="0.5"
              className={`${inputCls} font-mono`}
              title="Lissage cinématique [0, 0.99] — 0 = brut, élevé = très lissé"
            />
            <button
              onClick={() => {
                const v = parseFloat(smoothing);
                if (!isNaN(v) && v >= 0 && v < 1) {
                  setKinematicSmoothing(v).catch((e) => toast.error(`Spatial FX failed: ${e}`));
                }
              }}
              className="px-2 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded whitespace-nowrap"
            >
              Set smoothing
            </button>
          </div>
        </div>
        {modulations.length === 0 ? (
          <div className="text-gray-600 text-[11px] text-center py-2 bg-gray-800/30 rounded border border-gray-700/30">
            No modulations
          </div>
        ) : (
          <div className="space-y-1">
            {modulations.map((mod, i) => (
              <div key={i} className="p-2 bg-gray-800/50 rounded border border-gray-700/50">
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-[11px] font-mono">
                      {mod.source.toLowerCase()} → {mod.channel.toLowerCase()}
                      {mod.object !== null && ` [obj ${mod.object}]`}
                    </div>
                    <div className="text-gray-500 text-[10px] font-mono truncate">
                      ×{mod.scale}
                      {mod.offset !== 0 && ` +${mod.offset}`}
                      {mod.min !== null && ` min=${mod.min}`}
                      {mod.max !== null && ` max=${mod.max}`}
                    </div>
                  </div>
                  <button onClick={() => removeModulation(i).catch((e) => toast.error(`Spatial FX failed: ${e}`))} className={removeBtnCls} aria-label="Remove modulation">
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Object channels ── */}
      <Section
        title="Object channels"
        count={channelEntries.length}
        onClear={() => clearAllSpatialChannels().catch((e) => toast.error(`Spatial FX failed: ${e}`))}
      >
        <div className="space-y-1.5 mb-2">
          <div className="flex gap-1.5">
            <input type="text" value={cObject} onChange={(e) => setCObject(e.target.value)} placeholder="obj" className={`${inputCls} font-mono`} />
            <select value={cChannel} onChange={(e) => setCChannel(e.target.value as SpatialChannelName)} className={selectCls}>
              {SPATIAL_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c.toLowerCase()}
                </option>
              ))}
            </select>
            <input type="text" value={cValue} onChange={(e) => setCValue(e.target.value)} placeholder="value" className={`${inputCls} font-mono`} />
          </div>
          <button
            onClick={handleSetChannel}
            disabled={isNaN(parseInt(cObject, 10)) || isNaN(parseFloat(cValue))}
            className="w-full py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white text-xs rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Set Channel
          </button>
        </div>
        {channelEntries.length === 0 ? (
          <div className="text-gray-600 text-[11px] text-center py-2 bg-gray-800/30 rounded border border-gray-700/30">
            No static channels
          </div>
        ) : (
          <div className="space-y-1">
            {channelEntries.map(([obj, channels]) => (
              <div key={obj} className="p-2 bg-gray-800/50 rounded border border-gray-700/50">
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-[11px] font-mono">obj {obj}</div>
                    <div className="text-gray-500 text-[10px] font-mono truncate">{describeChannels(channels)}</div>
                  </div>
                  <button
                    onClick={() => clearSpatialChannel(parseInt(obj, 10)).catch((e) => toast.error(`Spatial FX failed: ${e}`))}
                    className={removeBtnCls}
                    aria-label="Clear object channels"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Graph-declared effects (read-only — gérés via l'éditeur de graphe) ── */}
      {(graphZones.length > 0 || graphModulations.length > 0) && (
        <div>
          <h4 className="text-gray-500 text-[10px] font-semibold uppercase tracking-wider mb-1.5">
            Graph effects ({graphZones.length + graphModulations.length})
          </h4>
          <div className="space-y-1">
            {graphZones.map((zone, i) => (
              <div key={`z${i}`} className="p-2 bg-cyan-900/20 rounded border border-cyan-800/40">
                <div className="text-cyan-200 text-[11px] font-mono">{describeZoneShape(zone.shape)}</div>
                <div className="text-gray-500 text-[10px] truncate">
                  {describeChannels(zone.channels)}
                  {zone.falloff > 0 && ` · falloff=${zone.falloff}`}
                  {zone.objects && ` · objs=[${zone.objects.join(',')}]`}
                  {!zone.enabled && ' · disabled'}
                </div>
              </div>
            ))}
            {graphModulations.map((mod, i) => (
              <div key={`m${i}`} className="p-2 bg-cyan-900/20 rounded border border-cyan-800/40">
                <div className="text-cyan-200 text-[11px] font-mono">
                  {mod.source.toLowerCase()} → {mod.channel.toLowerCase()}
                  {mod.object !== null && ` [obj ${mod.object}]`}
                </div>
                <div className="text-gray-500 text-[10px] font-mono truncate">
                  ×{mod.scale}
                  {mod.offset !== 0 && ` +${mod.offset}`}
                  {mod.min !== null && ` min=${mod.min}`}
                  {mod.max !== null && ` max=${mod.max}`}
                </div>
              </div>
            ))}
          </div>
          <p className="text-gray-600 text-[10px] mt-1.5">
            Declared by Zone/Velocity nodes in the global graph — edit via the node editor (Global tab).
          </p>
        </div>
      )}
    </div>
  );
}
