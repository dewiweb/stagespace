/// Poses — presets de positions nommés (design : docs/position-presets-design.md).
/// Miroir frontend de la table backend (source de vérité = `AppState.poses`) —
/// rafraîchi après chaque mutation. Utilisé par le panel Poses, le dispatch
/// OSC et l'enveloppe .hfg.
import { create } from 'zustand';
import { safeInvoke as invoke } from '../utils/tauri';
import { toast } from '../utils/toast-helpers';
import type { Pose } from '../types/generated/Pose';

interface PoseStore {
  poses: Pose[];
  refreshPoses: () => Promise<void>;
  /// Capture les positions live — `trackIds` undefined = toutes les
  /// tracks connues ; la sélection courante est passée par l'UI.
  capturePose: (name: string, trackIds?: number[]) => Promise<Pose | null>;
  snapPose: (name: string) => Promise<void>;
  /// Rampe animée vers la pose (oneshot + hold — la cible est tenue).
  gotoPose: (name: string, duration?: number, easing?: string) => Promise<void>;
  /// Morph animé pose A → pose B (départ live pour les objets hors de A).
  morphPose: (fromPose: string, toPose: string, duration?: number, easing?: string) => Promise<void>;
  deletePose: (name: string) => Promise<void>;
  savePose: (pose: Pose) => Promise<void>;
}

export const usePoseStore = create<PoseStore>((set, get) => ({
  poses: [],

  refreshPoses: async () => {
    try {
      const poses = await invoke<Pose[]>('pose_list');
      set({ poses });
    } catch (e) {
      console.error('[poseStore] pose_list failed:', e);
    }
  },

  capturePose: async (name, trackIds) => {
    try {
      const pose = await invoke<Pose>('pose_capture', {
        name,
        trackIds: trackIds?.length ? trackIds : null,
      });
      await get().refreshPoses();
      const n = Object.keys(pose.positions).length;
      toast.success(`Pose '${name}' captured — ${n} track${n > 1 ? 's' : ''}`);
      return pose;
    } catch (e) {
      toast.error(`Pose capture failed: ${e}`);
      return null;
    }
  },

  snapPose: async (name) => {
    try {
      const applied = await invoke<number>('pose_snap', { name });
      toast.success(`Pose '${name}' — ${applied} object${applied > 1 ? 's' : ''} snapped`);
    } catch (e) {
      toast.error(`Pose snap failed: ${e}`);
    }
  },

  gotoPose: async (name, duration, easing) => {
    try {
      const res = await invoke<{ movement_id: string; objects: number; skipped: number[] }>(
        'pose_goto',
        { name, duration: duration ?? null, easing: easing ?? null },
      );
      const skip = res.skipped.length ? ` — ${res.skipped.length} track(s) skipped` : '';
      toast.success(`Goto '${name}' — ${res.objects} object${res.objects > 1 ? 's' : ''} ramping${skip}`);
    } catch (e) {
      toast.error(`Pose goto failed: ${e}`);
    }
  },

  morphPose: async (fromPose, toPose, duration, easing) => {
    try {
      const res = await invoke<{ movement_id: string; objects: number; skipped: number[] }>(
        'pose_morph',
        { fromPose, toPose, duration: duration ?? null, easing: easing ?? null },
      );
      const skip = res.skipped.length ? ` — ${res.skipped.length} track(s) skipped` : '';
      toast.success(`Morph '${fromPose}' → '${toPose}' — ${res.objects} object${res.objects > 1 ? 's' : ''}${skip}`);
    } catch (e) {
      toast.error(`Pose morph failed: ${e}`);
    }
  },

  deletePose: async (name) => {
    try {
      await invoke('pose_delete', { name });
      await get().refreshPoses();
    } catch (e) {
      toast.error(`Pose delete failed: ${e}`);
    }
  },

  savePose: async (pose) => {
    try {
      await invoke('pose_save', { pose });
      await get().refreshPoses();
    } catch (e) {
      toast.error(`Pose save failed: ${e}`);
    }
  },
}));
