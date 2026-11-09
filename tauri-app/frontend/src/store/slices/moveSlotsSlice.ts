import { StateCreator } from 'zustand';
import type { Edge } from '@xyflow/react';
import type { GraphNode } from '../../components/nodeParamSchema';
import type { HolProject } from '../types/index';
import { createSlotCrudMethods } from './moveSlotsCrud';
import { createSlotPlaybackMethods } from './moveSlotsPlayback';
import {
  loadSlotsFromStorage,
  loadSetlistFromStorage,
  type GoResult,
  type MoveSlot,
  type MoveMacros,
} from './moveSlotsTypes';

// Ré-export public — les consommateurs existants importent depuis ce module.
export { computeTrackIndices, normalizeSlot, saveSlotsToStorage } from './moveSlotsTypes';
export type { GoResult, MoveSlot, MoveMacros } from './moveSlotsTypes';

export interface MoveSlotsSlice {
  /// Tous les moves — persistés dans localStorage
  moveSlots: MoveSlot[];
  /// Setlist = ordre des moves pour le spectacle (liste de slot IDs)
  setlistOrder: string[];
  /// Index du move courant dans la setlist (-1 = aucun)
  currentSetlistIndex: number;
  /// ID du slot actuellement sélectionné pour édition (source de vérité pour l'UI)
  editingSlotId: string | null;
  /// Slot IDs avec une activation en cours (anti double-clic, non persisté)
  pendingPlays: string[];
  /// Slots stoppés par le dernier solo — restore candidat (unsolo).
  soloSavedIds: string[];

  // ─── CRUD moves ───
  addMoveSlot: () => void;
  removeMoveSlot: (id: string) => void;
  renameMoveSlot: (id: string, name: string) => void;
  setSlotTemplate: (id: string, templateId: string) => void;
  setSlotTracks: (id: string, trackIds: number[]) => void;
  setSlotMacros: (id: string, macros: Partial<MoveMacros>) => void;
  setSlotFadeDuration: (id: string, fade: number) => void;
  setSlotLoopMode: (id: string, mode: 'loop' | 'oneshot') => void;
  setSlotEndMode: (id: string, mode: 'revert' | 'hold') => void;
  setSlotAnchorMode: (id: string, mode: 'origin' | 'current' | 'follow') => void;
  setSlotAnchorTarget: (id: string, target: number) => void;
  setSlotDirection: (id: string, direction: 'forward' | 'backward' | 'ping_pong') => void;
  /// Champs "animation" du slot (fade cycle, phase spread, assignments, audio mods)
  /// — write-through depuis l'Inspector (updateCurrent → ici).
  updateSlotAnimationFields: (id: string, fields: Partial<Pick<MoveSlot, 'fadeIn' | 'fadeOut' | 'phaseSpread' | 'assignments' | 'audioMods'>>) => void;
  /// Bascule le mode preview (pas d'OSC out) / live (OSC out)
  toggleSlotPreview: (id: string) => void;
  /// Sélectionne un slot pour édition — sync selectedTrackIds + charge le graphe dans l'éditeur
  selectSlotForEditing: (id: string | null) => void;
  /// Met à jour le graphe de modulation per-move du slot (tab Mods).
  setSlotSignalGraph: (id: string, graph: { nodes: GraphNode[]; edges: Edge[] } | null) => void;

  // ─── Live (lancer/arrêter) ───
  /// Retourne true si le move est (ou sera) en lecture — false si l'activation a échoué.
  /// Un slot déjà playing/pending retourne true (objectif atteint).
  playSlot: (id: string) => Promise<boolean>;
  stopSlot: (id: string) => Promise<void>;
  stopSlotWithFade: (id: string, fadeDuration: number) => Promise<void>;
  goAllSlots: () => Promise<void>;
  stopAllSlots: () => Promise<void>;

  // ─── Édition graphe ───
  editSlotGraph: (id: string) => void;
  saveEditorToSlot: (id: string) => void;

  // ─── Setlist (spectacle) ───
  addToSetlist: (slotId: string) => void;
  removeFromSetlist: (slotId: string) => void;
  moveSetlistItem: (index: number, direction: 'up' | 'down') => void;
  /// GO = stoppe tous les moves actifs + lance le prochain move de la setlist
  goToNextMove: () => Promise<GoResult>;

  // ─── Sync ───
  syncSlotMovements: () => void;
}

export type MoveSlotsStore = MoveSlotsSlice & {
  // Dépendances
  holProject: HolProject | null;
  manualOscIds: number[];
  movements: any[];
  nodes: GraphNode[];
  edges: Edge[];
  setNodes: (nodes: GraphNode[]) => void;
  setEdges: (edges: Edge[]) => void;
  stopMovement: (movementId: string) => Promise<void>;
  stopMovementWithFade: (movementId: string, fadeDuration: number) => Promise<void>;
  stopAllMovements: () => Promise<void>;
  refreshMovements: () => Promise<void>;
  // OSC config globale
  oscAddress: string;
  oscPort: number;
  oscProfile: string;
  // Pour sync selectedTrackIds quand on sélectionne un slot
  setSelectedTrackIds: (ids: Set<number>) => void;
  selectedTrackIds: Set<number>;
  // Undo/redo — déclarés pour les appels internes (reset au switch de slot,
  // baseline push). pushHistory optionnel : le slice fonctionne aussi sans.
  pushHistory?: () => void;
  _history: Array<{ nodes: GraphNode[]; edges: Edge[] }>;
  _historyIndex: number;
  canUndo: boolean;
  canRedo: boolean;
};


export const createMoveSlotsSlice: StateCreator<MoveSlotsStore, [], [], MoveSlotsSlice> = (set, get) => ({
  moveSlots: loadSlotsFromStorage(),
  setlistOrder: loadSetlistFromStorage(),
  currentSetlistIndex: -1,
  editingSlotId: null,
  pendingPlays: [],
  soloSavedIds: [],

  ...createSlotCrudMethods(set, get),
  ...createSlotPlaybackMethods(set, get),
});
