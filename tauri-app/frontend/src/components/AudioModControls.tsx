import React from 'react';
import { X } from 'lucide-react';
import { Slider } from './ui/Slider';
import { IconButton } from './ui/IconButton';
import type { AudioMod, AudioModSource, AudioModTarget } from '../store/useMoveEditorStore';
import { useMoveEditorStore } from '../store/useMoveEditorStore';
import { audioSourceLabel, audioTargetLabel } from '../utils/audioModLabels';

// Le delta audio = amount × valeur (dans l'unité native de la macro).
// Pour yaw/pitch/roll l'unité est le DEGRÉ : un amount de 2 ne donne
// qu'un swing de ±2° — imperceptible. Les cibles rotation ont donc
// une plage d'intensité en degrés (jusqu'à 360° de swing).
const ROTATION_TARGETS: ReadonlySet<AudioModTarget> = new Set(['yaw', 'pitch', 'roll']);

const amountRange = (target: AudioModTarget) =>
  ROTATION_TARGETS.has(target)
    ? { max: 360, step: 1, decimals: 0 }
    : { max: 2, step: 0.05, decimals: 2 };

export function AudioModAdder({ onAdd, onCancel }: { onAdd: (mod: AudioMod) => void; onCancel: () => void }) {
  const [source, setSource] = React.useState<AudioModSource>('amplitude_bass');
  const [target, setTarget] = React.useState<AudioModTarget>('radius_scale');
  const [amount, setAmount] = React.useState(0.5);

  // Défaut sensé au changement de cible : 90° pour une rotation
  // (0.5 serait imperceptible), 0.5 sinon.
  const onTargetChange = (t: AudioModTarget) => {
    setTarget(t);
    setAmount(ROTATION_TARGETS.has(t) ? 90 : 0.5);
  };

  return (
    <div className="bg-gray-800/80 rounded p-2 space-y-2 border border-cyan-900/40">
      <div>
        <div className="text-gray-400 text-xs mb-0.5">Source</div>
        <select value={typeof source === 'string' ? source : 'spectrum_band'}
          onChange={(e) => setSource(e.target.value as AudioModSource)}
          className="w-full bg-gray-900 text-white text-xs rounded px-1.5 py-1 border border-gray-700">
          <option value="bpm">BPM</option>
          <option value="amplitude_rms">Amplitude RMS</option>
          <option value="amplitude_bass">Bass</option>
          <option value="amplitude_mid">Mid</option>
          <option value="amplitude_high">High</option>
        </select>
      </div>
      <div>
        <div className="text-gray-400 text-xs mb-0.5">Target (macro)</div>
        <select value={typeof target === 'string' ? target : 'radius_scale'}
          onChange={(e) => onTargetChange(e.target.value as AudioModTarget)}
          className="w-full bg-gray-900 text-white text-xs rounded px-1.5 py-1 border border-gray-700">
          <option value="radius_scale">Radius Scale</option>
          <option value="height_offset">Height Offset</option>
          <option value="speed">Speed</option>
          <option value="scale">Scale</option>
          <option value="offset_x">Offset X</option>
          <option value="offset_y">Offset Y</option>
          <option value="offset_z">Offset Z</option>
          <option value="yaw">Yaw</option>
          <option value="pitch">Pitch</option>
          <option value="roll">Roll</option>
        </select>
      </div>
      <Slider label={`Intensity${ROTATION_TARGETS.has(target) ? ' (deg)' : ''}`}
        value={amount} min={0} {...amountRange(target)}
        onChange={setAmount} accent="cyan" />
      <div className="flex gap-1.5">
        <button onClick={() => onAdd({ source, target, amount, base_value: 0, smoothing: 0.3 })}
          className="flex-1 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs rounded font-medium">
          Add
        </button>
        <IconButton onClick={onCancel}>
          <X size={11} />
        </IconButton>
      </div>
    </div>
  );
}

/// Liste éditable des audio mods du `current` (write-through vers le slot
/// édité + update_animation_state si live). Partagée Inspector / PerformView.
export function AudioModList() {
  const current = useMoveEditorStore((s) => s.current);
  const updateCurrent = useMoveEditorStore((s) => s.updateCurrent);
  const addAudioMod = useMoveEditorStore((s) => s.addAudioMod);
  const removeAudioMod = useMoveEditorStore((s) => s.removeAudioMod);
  const [showAdd, setShowAdd] = React.useState(false);

  return (
    <div className="space-y-1.5">
      {current.audio_mods.length === 0 && !showAdd && (
        <div className="text-gray-400 text-xs py-1">
          No audio mod. Click « + Add » to create an audio mapping.
        </div>
      )}
      {current.audio_mods.map((mod, i) => (
        <div key={i} className="bg-gray-800/60 rounded p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-cyan-400 text-xs font-mono">
              {audioSourceLabel(mod.source)} → {audioTargetLabel(mod.target)}
            </span>
            <button onClick={() => removeAudioMod(i)} className="text-red-400 text-xs"><X size={11} /></button>
          </div>
          <Slider label={`Intensity${ROTATION_TARGETS.has(mod.target) ? ' (deg)' : ''}`}
            value={mod.amount} min={0} {...amountRange(mod.target)}
            onChange={(v) => {
              const mods = [...current.audio_mods];
              mods[i] = { ...mod, amount: v };
              updateCurrent({ audio_mods: mods });
            }} accent="cyan" />
          <Slider label="Lissage" value={mod.smoothing} min={0} max={0.95} step={0.05}
            onChange={(v) => {
              const mods = [...current.audio_mods];
              mods[i] = { ...mod, smoothing: v };
              updateCurrent({ audio_mods: mods });
            }} accent="cyan" />
        </div>
      ))}
      {showAdd ? (
        <AudioModAdder onAdd={(mod) => { addAudioMod(mod); setShowAdd(false); }} onCancel={() => setShowAdd(false)} />
      ) : (
        <button onClick={() => setShowAdd(true)}
          className="w-full py-1.5 bg-cyan-900/40 hover:bg-cyan-800/60 text-cyan-300 text-xs rounded font-medium">
          + Add audio mod
        </button>
      )}
    </div>
  );
}
