/// Contrat de la station de conduite — partagé par les deux adapters :
/// - ConduiteSurface (surface interne) → lit les stores Zustand directement
/// - ConduitePage (fenêtre détachée) → reçoit `conduite:state`, émet `conduite:cmd`

export type ConduiteCue = {
  id: string;
  label: string;
  current: boolean;
  next: boolean;
};

export type ConduiteViewState = {
  cues: ConduiteCue[];
  pending: { kind: string; remainingSec: number } | null;
  isRecalling: boolean;
  playingCount: number;
  tcChaseEnabled: boolean;
  tcActive: boolean;
  tcStr: string;
  showLog: { ts: number; label: string }[];
  armed: boolean;
  parked: number[];
  consoleAge: number | null;
  /// Prochain move de la setlist (nom) — pour le bouton SETLIST GO.
  nextSetlistName: string | null;
  /// Slots à rejouer après un solo — >0 = bouton UNSOLO visible.
  soloRestoreCount: number;
};

export type ConduiteHandlers = {
  /// GO = tirer la cue armée, ou la cue suivante si rien d'armé (modèle
  /// console — Prev/Next ne tirent pas, ils naviguent le marqueur).
  onGo: (armedCueId: string | null) => void;
  onPanic: () => void;
  onArmToggle: () => void;
  onRecallCue: (id: string) => void;
  /// SETLIST GO — crossfade vers le prochain move (≠ onGo = cue recall).
  onGoSetlist: () => void;
  /// Dégèle un objet parké (obj_index backend).
  onUnpark: (obj: number) => void;
  /// Rejoue les slots stoppés par le dernier solo.
  onUnsolo: () => void;
};
