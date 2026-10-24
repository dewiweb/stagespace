import React from 'react';
import { X } from 'lucide-react';
import { toast } from '../utils/toast-helpers';
import { useGraphStore } from '../store/useGraphStore';
import EmptyState from './ui/EmptyState';
import {
  SPATIAL_CHANNELS,
  describeChannels,
  describeZoneShape,
  parseObjectsSpec,
  parseVec3,
  type KinematicSourceName,
  type SpatialChannelName,
  type ZoneParams,
} from '../store/slices/spatialFxSlice';

const inputCls =
  'w-full px-2.5 py-1.5 bg-gray-800 text-white text-xs rounded border border-gray-700 focus:border-cyan-500 focus:outline-none';
const selectCls =
  'w-full px-2 py-1.5 bg-gray-800 text-white text-xs rounded border border-gray-700 focus:border-cyan-500 focus:outline-none';
const removeBtnCls = 'text-red-400 hover:text-red-300 text-xs ml-2 flex-shrink-0';

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
        <h4 className="text-gray-500 text-xs font-semibold uppercase tracking-wider">
          {title} ({count})
        </h4>
        {onClear && count > 0 && (
          <button onClick={onClear} className="text-gray-400 hover:text-red-400 text-xs">
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
  const zonePlaceMode = useGraphStore((s) => s.zonePlaceMode);
  const setZonePlaceMode = useGraphStore((s) => s.setZonePlaceMode);
  const pendingZonePoint = useGraphStore((s) => s.pendingZonePoint);
  const setPendingZonePoint = useGraphStore((s) => s.setPendingZonePoint);
  const zonePlaceTarget = useGraphStore((s) => s.zonePlaceTarget);
  const setZonePlaceTarget = useGraphStore((s) => s.setZonePlaceTarget);
  const updateZone = useGraphStore((s) => s.updateZone);

  // ── Zone form state ──
  const [zShape, setZShape] = React.useState<'sphere' | 'box'>('sphere');
  const [zA, setZA] = React.useState('0,0,0');
  const [zRadius, setZRadius] = React.useState('2');
  const [zB, setZB] = React.useState('1,1,1');
  const [zFalloff, setZFalloff] = React.useState('0.5');
  const [zcName, setZcName] = React.useState<SpatialChannelName>('Gain');
  const [zcValue, setZcValue] = React.useState('1');
  const [zChannelRows, setZChannelRows] = React.useState<[SpatialChannelName, number][]>([]);
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

  // Place-on-scene : le clic au sol (Scene3D → pendingZonePoint, coords
  // backend) — deux cibles : le formulaire de nouvelle zone (remplit le
  // champ centre) ou le re-place d'une zone existante (updateZone, les
  // autres params préservés — le point devient le nouveau centre ; pour
  // une box, min/max sont translatés autour de lui, taille préservée).
  React.useEffect(() => {
    if (!pendingZonePoint) return;
    const pt = pendingZonePoint.map((v) => Math.round(v * 100) / 100) as [number, number, number];
    setPendingZonePoint(null);
    if (zonePlaceTarget === null) {
      setZA(pt.join(','));
      return;
    }
    const zone = zones[zonePlaceTarget];
    setZonePlaceTarget(null);
    if (!zone) return;
    const channels = Object.fromEntries(
      Object.entries(zone.channels).filter(([, v]) => v !== null && v !== undefined),
    ) as Record<string, number>;
    const params: ZoneParams =
      zone.shape.shape === 'sphere'
        ? {
            shape: 'sphere',
            a: pt,
            radius: zone.shape.radius,
            b: null,
            falloff: zone.falloff,
            channels,
            objects: zone.objects ?? null,
          }
        : {
            shape: 'box',
            a: pt.map((c, k) => c - (zone.shape.max[k] - zone.shape.min[k]) / 2) as [number, number, number],
            radius: null,
            b: pt.map((c, k) => c + (zone.shape.max[k] - zone.shape.min[k]) / 2) as [number, number, number],
            falloff: zone.falloff,
            channels,
            objects: zone.objects ?? null,
          };
    updateZone(zonePlaceTarget, params).catch((e) => toast.error(`Zone re-place failed: ${e}`));
  }, [pendingZonePoint, zonePlaceTarget, zones, updateZone, setPendingZonePoint, setZonePlaceTarget]);

  // Validation live de la zone — le bouton Add reste grisé tant que le
  // centre est invalide ou qu'aucun canal valide n'est saisi ; le hint
  // sous le bouton dit exactement ce qui manque.
  const zoneCenterValid = parseVec3(zA) !== null;
  const zoneChannels = Object.fromEntries(
    zChannelRows.map(([c, v]) => [c.toLowerCase(), v])
  );
  const zoneChannelsValid = zChannelRows.length > 0;
  const zoneHint = !zoneCenterValid
    ? zShape === 'sphere'
      ? 'invalid center — format x,y,z (ex: 0,0,0)'
      : 'invalid min — format x,y,z'
    : !zoneChannelsValid
      ? 'add at least one channel (e.g. spread = 1)'
      : null;

  const handleAddChannelRow = () => {
    const v = parseFloat(zcValue);
    if (isNaN(v)) return;
    setZChannelRows((rows) => {
      const next = rows.filter(([c]) => c !== zcName);
      next.push([zcName, v]);
      return next;
    });
  };

  const handleAddZone = async () => {
    const a = parseVec3(zA);
    if (!a || !zoneChannelsValid) return;
    try {
      await addZone({
        shape: zShape,
        a,
        radius: zShape === 'sphere' ? parseFloat(zRadius) || 1 : null,
        b: zShape === 'box' ? parseVec3(zB) : null,
        falloff: parseFloat(zFalloff) || 0,
        channels: zoneChannels,
        objects: parseObjectsSpec(zObjects),
      });
      setZChannelRows([]);
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
          <span className="text-white text-xs">FX</span>
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
              title="Falloff width (soft transition beyond the edge)"
            />
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={zA}
              onChange={(e) => setZA(e.target.value)}
              placeholder={zShape === 'sphere' ? 'center x,y,z' : 'min x,y,z'}
              className={`${inputCls} font-mono`}
            />
            <button
              onClick={() => setZonePlaceMode(!zonePlaceMode)}
              className={`px-2.5 py-1.5 text-xs rounded whitespace-nowrap transition-colors ${
                zonePlaceMode
                  ? 'bg-cyan-600 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
              }`}
              title="Place the zone center on the 3D scene — then click the floor"
            >
              ⌖ Place
            </button>
          </div>
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
          <div className="space-y-1">
            <label className="text-gray-400 text-xs">Channels affected by the zone</label>
            <div className="flex gap-1.5">
              <select value={zcName} onChange={(e) => setZcName(e.target.value as SpatialChannelName)} className={selectCls} title="Spatial channel">
                {SPATIAL_CHANNELS.map((c) => (
                  <option key={c} value={c}>{c.toLowerCase()}</option>
                ))}
              </select>
              <input
                type="text"
                value={zcValue}
                onChange={(e) => setZcValue(e.target.value)}
                placeholder="value"
                className={`${inputCls} font-mono`}
                title="Channel value (e.g. spread=1, gain=-3, yaw=45)"
              />
              <button
                onClick={handleAddChannelRow}
                disabled={isNaN(parseFloat(zcValue))}
                className="px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded whitespace-nowrap disabled:opacity-40"
                title="Add this channel to the zone"
              >
                +
              </button>
            </div>
            {zChannelRows.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {zChannelRows.map(([c, v]) => (
                  <span key={c} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-cyan-900/40 border border-cyan-800/50 rounded text-cyan-200 text-xs font-mono">
                    {c.toLowerCase()}={v}
                    <button
                      onClick={() => setZChannelRows((rows) => rows.filter(([rc]) => rc !== c))}
                      className="text-cyan-400 hover:text-red-400"
                      aria-label={`Remove ${c} channel`}
                    ><X size={10} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <input
            type="text"
            value={zObjects}
            onChange={(e) => setZObjects(e.target.value)}
            placeholder="objects (optional: 0,1,2 — empty = all)"
            className={`${inputCls} font-mono`}
          />
          <button
            onClick={handleAddZone}
            disabled={!zoneCenterValid || !zoneChannelsValid}
            className="w-full py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white text-xs rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add Zone
          </button>
          {zoneHint && (
            <div className="text-amber-500/90 text-xs font-mono px-0.5">{zoneHint}</div>
          )}
          {!zoneHint && zoneChannelsValid && (
            <div className="text-green-500/80 text-xs font-mono px-0.5">
              → {describeChannels(zoneChannels)}
            </div>
          )}
        </div>
        {zones.length === 0 ? (
          <EmptyState
            size="sm"
            title="No zones"
            hint="Add one above to change spatial channels inside a region."
          />
        ) : (
          <div className="space-y-1">
            {zones.map((zone, i) => (
              <div key={i} className="p-2 bg-gray-800/50 rounded border border-gray-700/50">
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-xs font-mono">{describeZoneShape(zone.shape)}</div>
                    <div className="text-gray-500 text-xs truncate">
                      {describeChannels(zone.channels)}
                      {zone.falloff > 0 && ` · falloff=${zone.falloff}`}
                      {zone.objects && ` · objs=[${zone.objects.join(',')}]`}
                      {!zone.enabled && ' · disabled'}
                    </div>
                  </div>
                  <button
                    onClick={() => { setZonePlaceTarget(i); setZonePlaceMode(true); }}
                    className={removeBtnCls}
                    title="Re-place this zone's center on the scene — then click the floor"
                    aria-label={`Re-place zone ${i}`}
                  >⌖</button>
                  <button onClick={() => removeZone(i).catch((e) => toast.error(`Spatial FX failed: ${e}`))} className={removeBtnCls} aria-label="Remove zone"><X size={11} /></button>
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
            <span className="text-gray-400 self-center text-xs">→</span>
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
                title="Listener point position — angular speed is measured around this point (°/s)"
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
              title="Kinematic smoothing [0, 0.99] — 0 = raw, high = heavily smoothed"
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
          <EmptyState
            size="sm"
            title="No modulations"
            hint="Drive a channel from motion (speed → spread, angular speed → yaw…)."
          />
        ) : (
          <div className="space-y-1">
            {modulations.map((mod, i) => (
              <div key={i} className="p-2 bg-gray-800/50 rounded border border-gray-700/50">
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-xs font-mono">
                      {mod.source.toLowerCase()} → {mod.channel.toLowerCase()}
                      {mod.object !== null && ` [obj ${mod.object}]`}
                    </div>
                    <div className="text-gray-500 text-xs font-mono truncate">
                      ×{mod.scale}
                      {mod.offset !== 0 && ` +${mod.offset}`}
                      {mod.min !== null && ` min=${mod.min}`}
                      {mod.max !== null && ` max=${mod.max}`}
                    </div>
                  </div>
                  <button onClick={() => removeModulation(i).catch((e) => toast.error(`Spatial FX failed: ${e}`))} className={removeBtnCls} aria-label="Remove modulation"><X size={11} /></button>
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
          <EmptyState
            size="sm"
            title="No static channels"
            hint="Pin a channel value on a specific object."
          />
        ) : (
          <div className="space-y-1">
            {channelEntries.map(([obj, channels]) => (
              <div key={obj} className="p-2 bg-gray-800/50 rounded border border-gray-700/50">
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-xs font-mono">obj {obj}</div>
                    <div className="text-gray-500 text-xs font-mono truncate">{describeChannels(channels)}</div>
                  </div>
                  <button
                    onClick={() => clearSpatialChannel(parseInt(obj, 10)).catch((e) => toast.error(`Spatial FX failed: ${e}`))}
                    className={removeBtnCls}
                    aria-label="Clear object channels"
                  ><X size={11} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Graph-declared effects (read-only — gérés via l'éditeur de graphe) ── */}
      {(graphZones.length > 0 || graphModulations.length > 0) && (
        <div>
          <h4 className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-1.5">
            Graph effects ({graphZones.length + graphModulations.length})
          </h4>
          <div className="space-y-1">
            {graphZones.map((zone, i) => (
              <div key={`z${i}`} className="p-2 bg-cyan-900/20 rounded border border-cyan-800/40">
                <div className="text-cyan-200 text-xs font-mono">{describeZoneShape(zone.shape)}</div>
                <div className="text-gray-500 text-xs truncate">
                  {describeChannels(zone.channels)}
                  {zone.falloff > 0 && ` · falloff=${zone.falloff}`}
                  {zone.objects && ` · objs=[${zone.objects.join(',')}]`}
                  {!zone.enabled && ' · disabled'}
                </div>
              </div>
            ))}
            {graphModulations.map((mod, i) => (
              <div key={`m${i}`} className="p-2 bg-cyan-900/20 rounded border border-cyan-800/40">
                <div className="text-cyan-200 text-xs font-mono">
                  {mod.source.toLowerCase()} → {mod.channel.toLowerCase()}
                  {mod.object !== null && ` [obj ${mod.object}]`}
                </div>
                <div className="text-gray-500 text-xs font-mono truncate">
                  ×{mod.scale}
                  {mod.offset !== 0 && ` +${mod.offset}`}
                  {mod.min !== null && ` min=${mod.min}`}
                  {mod.max !== null && ` max=${mod.max}`}
                </div>
              </div>
            ))}
          </div>
          <p className="text-gray-400 text-xs mt-1.5">
            Declared by Zone/Velocity nodes in the global graph — edit via the node editor (Global tab).
          </p>
        </div>
      )}
    </div>
  );
}
