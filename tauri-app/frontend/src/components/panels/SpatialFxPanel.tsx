import React from 'react';
import { X } from 'lucide-react';
import { toast } from '../../utils/toast-helpers';
import { useGraphStore } from '../../store/useGraphStore';
import { safeInvoke as invoke } from '../../utils/tauri';
import EmptyState from '../ui/EmptyState';
import { ConfirmModal } from '../ui/ConfirmModal';
import {
  SPATIAL_CHANNELS,
  describeChannels,
  describeZoneShape,
  parseObjectsSpec,
  parseVec3,
  type KinematicSourceName,
  type SpatialChannelName,
  type ZoneParams,
  zoneToParams,
} from '../../store/slices/spatialFxSlice';

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
  const [confirming, setConfirming] = React.useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-gray-500 text-xs font-semibold uppercase tracking-wider">
          {title} ({count})
        </h4>
        {onClear && count > 0 && (
          <button onClick={() => setConfirming(true)} className="text-gray-400 hover:text-red-400 text-xs">
            clear all
          </button>
        )}
      </div>
      {children}
      {confirming && (
        <ConfirmModal
          title={`Clear ${title.toLowerCase()}`}
          message={<>Remove all <b>{count}</b> {title.toLowerCase()}? This can't be undone.</>}
          confirmLabel="Clear all"
          onConfirm={() => { setConfirming(false); onClear?.(); }}
          onCancel={() => setConfirming(false)}
        />
      )}
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
  const zoneEditMode = useGraphStore((s) => s.zoneEditMode);
  const setZoneEditMode = useGraphStore((s) => s.setZoneEditMode);
  const oscProfile = useGraphStore((s) => s.oscProfile);
  const [confirmRemove, setConfirmRemove] = React.useState<{ label: string; action: () => void } | null>(null);

  // Canaux que le profil OSC courant sérialise réellement — un réglage
  // sur un canal hors liste produit du silence (ex : holophonix → gain
  // seul). `null` = inconnu (backend down) → pas d'annotation.
  const [profileChannels, setProfileChannels] = React.useState<SpatialChannelName[] | null>(null);
  React.useEffect(() => {
    invoke<SpatialChannelName[]>('get_profile_channels', { profile: oscProfile })
      .then(setProfileChannels)
      .catch(() => setProfileChannels(null));
  }, [oscProfile]);
  const sentLabel = (c: SpatialChannelName) =>
    profileChannels && !profileChannels.includes(c) ? ' (not sent)' : '';

  // Readback live : canaux effectifs calculés par le merge par objet
  // (statiques ⊕ modulés ⊕ zones) — rend l'effet des FX visible sans
  // écouter le rendu. Poll ~2Hz comme les perf stats.
  const [liveChannels, setLiveChannels] = React.useState<Record<number, Record<string, number>>>({});
  React.useEffect(() => {
    const tick = () => {
      invoke<Record<number, Record<string, number>>>('list_effective_channels')
        .then(setLiveChannels)
        .catch(() => {});
    };
    tick();
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
  }, []);
  const liveEntries = Object.entries(liveChannels);

  // Modes interactifs → reset au démontage : sinon un mode place/edit
  // oublié survive au switch de tab et intercepte les clics du canvas 3D.
  React.useEffect(() => {
    return () => {
      useGraphStore.getState().setZonePlaceMode(false);
      useGraphStore.getState().setZoneEditMode(false);
      useGraphStore.getState().setPendingZonePoint(null);
      useGraphStore.getState().setZonePlaceTarget(null);
    };
  }, []);

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
  /// Effet positionnel : 'none' = zone canaux-only (comportement historique).
  const [zEffect, setZEffect] = React.useState<'none' | 'repel' | 'attract' | 'dampen' | 'vortex'>('none');
  const [zStrength, setZStrength] = React.useState('1');
  /// Mode édition : l'index de la zone chargée dans le formulaire —
  /// `null` = création. Sans ça impossible de savoir si les champs
  /// préparent une nouvelle zone ou modifient une existante.
  const [editingZoneIdx, setEditingZoneIdx] = React.useState<number | null>(null);

  // La zone éditée peut être supprimée par ailleurs (clear all, ×, autre
  // client) → retomber en création plutôt qu'updater un index mort.
  React.useEffect(() => {
    if (editingZoneIdx !== null && editingZoneIdx >= zones.length) {
      setEditingZoneIdx(null);
    }
  }, [zones.length, editingZoneIdx]);

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
    updateZone(zonePlaceTarget, zoneToParams(zone, pt))
      .catch((e) => toast.error(`Zone re-place failed: ${e}`));
  }, [pendingZonePoint, zonePlaceTarget, zones, updateZone, setPendingZonePoint, setZonePlaceTarget]);

  // Validation live de la zone — le bouton Add reste grisé tant que le
  // centre est invalide ou qu'aucun canal valide n'est saisi ; le hint
  // sous le bouton dit exactement ce qui manque.
  const zoneCenterValid = parseVec3(zA) !== null;
  const zoneChannels = Object.fromEntries(
    zChannelRows.map(([c, v]) => [c.toLowerCase(), v])
  );
  /// Une zone est valide avec des canaux OU un effet positionnel (ou les
  /// deux — une zone repel-only sans canal est légitime).
  const zoneChannelsValid = zChannelRows.length > 0 || zEffect !== 'none';
  const zoneHint = !zoneCenterValid
    ? zShape === 'sphere'
      ? 'invalid center — format x,y,z (ex: 0,0,0)'
      : 'invalid min — format x,y,z'
    : !zoneChannelsValid
      ? 'add at least one channel (e.g. spread = 1) or pick an effect'
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

  /// Formulaire → ZoneParams (partagé Add/Update) — null si invalide.
  const zoneParamsFromForm = (): ZoneParams | null => {
    const a = parseVec3(zA);
    if (!a || !zoneChannelsValid) return null;
    return {
      shape: zShape,
      a,
      radius: zShape === 'sphere' ? parseFloat(zRadius) || 1 : null,
      b: zShape === 'box' ? parseVec3(zB) : null,
      falloff: parseFloat(zFalloff) || 0,
      channels: zoneChannels,
      objects: parseObjectsSpec(zObjects),
      effect: zEffect === 'none'
        ? null
        : { kind: zEffect, strength: parseFloat(zStrength) || 1 },
    };
  };

  /// Retour en mode création — champs remis aux défauts.
  const resetZoneForm = () => {
    setEditingZoneIdx(null);
    setZChannelRows([]);
    setZEffect('none');
  };

  /// Charge une zone existante dans le formulaire — entrée du mode édition.
  const loadZoneIntoForm = (i: number) => {
    const z = zones[i];
    if (!z) return;
    setZShape(z.shape.shape);
    if (z.shape.shape === 'sphere') {
      setZA(z.shape.center.join(','));
      setZRadius(String(z.shape.radius));
    } else {
      setZA(z.shape.min.join(','));
      setZB(z.shape.max.join(','));
    }
    setZFalloff(String(z.falloff));
    setZChannelRows(
      (Object.entries(z.channels) as [string, number | null][])
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [(k[0].toUpperCase() + k.slice(1)) as SpatialChannelName, v as number]),
    );
    setZObjects((z.objects ?? []).join(','));
    setZEffect(z.effect?.kind ?? 'none');
    setZStrength(String(z.effect?.strength ?? 1));
    setEditingZoneIdx(i);
  };

  const handleAddZone = async () => {
    const params = zoneParamsFromForm();
    if (!params) return;
    try {
      await addZone(params);
      setZChannelRows([]);
      setZEffect('none');
    } catch (e) {
      console.error('Failed to add zone:', e);
      toast.error(`Add zone failed: ${e}`);
    }
  };

  const handleUpdateZone = async () => {
    if (editingZoneIdx === null) return;
    const params = zoneParamsFromForm();
    if (!params) return;
    try {
      await updateZone(editingZoneIdx, params);
      resetZoneForm();
    } catch (e) {
      toast.error(`Update zone failed: ${e}`);
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

      {/* Profil → canaux émis : rend visible ce qui produirait du silence
          (ex : holophonix ne sérialise que gain — les réglages sur les
          autres canaux sont calculés mais jamais envoyés au renderer). */}
      {profileChannels && profileChannels.length < SPATIAL_CHANNELS.length && (
        <div className="mx-2 mt-1.5 px-2 py-1 bg-amber-900/20 border border-amber-800/40 rounded text-amber-300/90 text-[10px] font-mono">
          profile {oscProfile} sends: {profileChannels.map((c) => c.toLowerCase()).join(' ')}
          — other channels produce silence
        </div>
      )}

      {/* ── Zones ── */}
      <Section title="Zones" count={zones.length} onClear={() => clearZones().catch((e) => toast.error(`Spatial FX failed: ${e}`))}>
        <div className={`space-y-1.5 mb-2 rounded transition-colors ${editingZoneIdx !== null ? 'border border-cyan-700/60 bg-cyan-950/20 p-1.5' : ''}`}>
          {/* Mode du formulaire — lever l'ambiguïté création/édition :
              un chip indique toujours ce que les champs vont faire. */}
          <div className="flex items-center gap-1.5 px-0.5">
            {editingZoneIdx !== null ? (
              <>
                <span className="text-cyan-300 text-[11px] font-mono font-semibold">
                  ✎ Editing zone {editingZoneIdx}
                </span>
                <span className="flex-1" />
                <button
                  onClick={resetZoneForm}
                  className="text-gray-500 hover:text-white text-[11px] font-mono"
                  title="Back to creating a new zone"
                >
                  ✕ new zone
                </button>
              </>
            ) : (
              <span className="text-gray-500 text-[11px] font-mono">+ New zone</span>
            )}
          </div>
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
                  <option key={c} value={c}>{c.toLowerCase()}{sentLabel(c)}</option>
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
          {/* Effet positionnel — déplace les objets mergés à travers la
              zone (blendé par l'influence SDF+falloff). Séparé des canaux :
              une zone peut déplacer ET envoyer des canaux au renderer. */}
          <div className="flex gap-1.5">
            <select
              value={zEffect}
              onChange={(e) => setZEffect(e.target.value as typeof zEffect)}
              className={selectCls}
              title="Position effect — displaces objects through the zone (blended by falloff)"
            >
              <option value="none">no position effect</option>
              <option value="repel">repel — push objects out</option>
              <option value="attract">attract — pull toward center</option>
              <option value="dampen">dampen — damp toward center</option>
              <option value="vortex">vortex — swirl around center</option>
            </select>
            {zEffect !== 'none' && (
              <input
                type="text"
                value={zStrength}
                onChange={(e) => setZStrength(e.target.value)}
                placeholder="strength"
                className={`${inputCls} font-mono w-20`}
                title="Effect strength — displacement magnitude (units/radians)"
              />
            )}
          </div>
          <button
            onClick={editingZoneIdx !== null ? handleUpdateZone : handleAddZone}
            disabled={!zoneCenterValid || !zoneChannelsValid}
            className={`w-full py-1.5 text-white text-xs rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              editingZoneIdx !== null
                ? 'bg-cyan-700 hover:bg-cyan-600 ring-1 ring-cyan-500/50'
                : 'bg-cyan-600 hover:bg-cyan-700'
            }`}
          >
            {editingZoneIdx !== null ? `Update zone ${editingZoneIdx}` : 'Add Zone'}
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
        {zones.length > 0 && (
          <button
            onClick={() => setZoneEditMode(!zoneEditMode)}
            className={`w-full mb-1.5 py-1.5 text-xs rounded font-medium transition-colors ${
              zoneEditMode
                ? 'bg-cyan-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
            }`}
            title="Edit zones on the scene — drag to move, scroll over a zone to resize"
          >
            {zoneEditMode ? '✓ Editing on scene — Esc to stop' : '✎ Edit on scene'}
          </button>
        )}
        {zones.length === 0 ? (
          <EmptyState
            size="sm"
            title="No zones"
            hint="Add one above to change spatial channels inside a region."
          />
        ) : (
          <div className="space-y-1">
            {zones.map((zone, i) => (
              <div key={i} className={`p-2 rounded border transition-colors ${
                editingZoneIdx === i
                  ? 'bg-cyan-950/40 border-cyan-600/70'
                  : 'bg-gray-800/50 border-gray-700/50'
              }`}>
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-xs font-mono">{describeZoneShape(zone.shape)}</div>
                    <div className="text-gray-500 text-xs truncate">
                      {describeChannels(zone.channels)}
                      {zone.effect && ` · ${zone.effect.kind}=${zone.effect.strength}`}
                      {zone.falloff > 0 && ` · falloff=${zone.falloff}`}
                      {zone.objects && ` · objs=[${zone.objects.join(',')}]`}
                      {!zone.enabled && ' · disabled'}
                    </div>
                  </div>
                  <button
                    onClick={() => (editingZoneIdx === i ? resetZoneForm() : loadZoneIntoForm(i))}
                    className={removeBtnCls}
                    title={editingZoneIdx === i ? 'Stop editing — back to new zone' : 'Edit this zone in the form above'}
                    aria-label={`Edit zone ${i}`}
                  >✎</button>
                  <button
                    onClick={() => { setZonePlaceTarget(i); setZonePlaceMode(true); }}
                    className={removeBtnCls}
                    title="Re-place this zone's center on the scene — then click the floor"
                    aria-label={`Re-place zone ${i}`}
                  >⌖</button>
                  <button onClick={() => setConfirmRemove({ label: `zone ${i}`, action: () => {
                    // Index décalés par la suppression — réaligner la zone
                    // en cours d'édition (ou sortir d'édition si c'est elle).
                    if (editingZoneIdx === i) setEditingZoneIdx(null);
                    else if (editingZoneIdx !== null && i < editingZoneIdx) setEditingZoneIdx(editingZoneIdx - 1);
                    removeZone(i).catch((e) => toast.error(`Spatial FX failed: ${e}`));
                  } })} className={removeBtnCls} aria-label="Remove zone"><X size={11} /></button>
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
                  {c.toLowerCase()}{sentLabel(c)}
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
                  <button onClick={() => setConfirmRemove({ label: `modulation ${i}`, action: () => removeModulation(i).catch((e) => toast.error(`Spatial FX failed: ${e}`)) })} className={removeBtnCls} aria-label="Remove modulation"><X size={11} /></button>
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
                  {c.toLowerCase()}{sentLabel(c)}
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
        {/* Readback live — canaux effectifs calculés par le merge
            (statiques ⊕ modulés ⊕ zones) : l'effet réel des réglages,
            visible sans écouter le rendu. */}
        {liveEntries.length > 0 && (
          <div className="mb-2 px-2 py-1.5 bg-cyan-950/30 rounded border border-cyan-900/40">
            <div className="text-[9px] text-cyan-500/80 uppercase tracking-widest mb-1">live — computed by merge</div>
            <div className="space-y-0.5 max-h-28 overflow-y-auto">
              {liveEntries.map(([obj, ch]) => (
                <div key={obj} className="text-[10px] font-mono text-cyan-200/80 truncate">
                  #{obj} · {describeChannels(ch)}
                </div>
              ))}
            </div>
          </div>
        )}
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
      {confirmRemove && (
        <ConfirmModal
          title="Remove spatial FX"
          message={<>Remove <b>{confirmRemove.label}</b>? This can't be undone.</>}
          confirmLabel="Remove"
          onConfirm={() => { confirmRemove.action(); setConfirmRemove(null); }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}
