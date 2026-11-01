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
};

export type ConduiteHandlers = {
  onGo: () => void;
  onPrev: () => void;
  onNext: () => void;
  onPanic: () => void;
  onArmToggle: () => void;
  onRecallCue: (id: string) => void;
};
