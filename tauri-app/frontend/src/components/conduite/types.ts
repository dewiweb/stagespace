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
  /// Noms des moves live (slots avec movementId) — NOW les affiche quand
  /// aucune cue n'est courante : la scène jouée en busking n'est pas « — »,
  /// c'est la vérité de ce qui sonne.
  playingNames: string[];
  /// Mouvements backend vivants sans slot — émettent des positions mais
  /// n'ont ni pad ni transport. Doit être >0 que ponctuellement (recall
  /// ambigu, deactivate raté) : affiché en ⚠ dans le compteur.
  orphanCount: number;
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
  /// Cue armée — source unique : useCuelistStore.armedCueId (le même
  /// store que le fil OSC /stagespace/cue/arm et le menu CUE GO). La
  /// vue ne porte plus d'arm local : tous les chemins de contrôle
  /// (clic, OSC, menu, fenêtre détachée) visent la même cible.
  armedCueId: string | null;
};

export type ConduiteHandlers = {
  /// GO = tirer la cue armée, ou la cue suivante si rien d'armé (modèle
  /// console — Prev/Next ne tirent pas, ils naviguent le marqueur).
  onGo: (armedCueId: string | null) => void;
  onPanic: () => void;
  onArmToggle: () => void;
  onRecallCue: (id: string) => void;
  /// Arm/désarm une cue (null = désarmer) — écrit dans le store partagé
  /// (directement en surface interne, via `conduite:cmd` en détaché).
  onArmCue: (id: string | null) => void;
  /// SETLIST GO — crossfade vers le prochain move (≠ onGo = cue recall).
  onGoSetlist: () => void;
  /// Dégèle un objet parké (obj_index backend).
  /// Rejoue les slots stoppés par le dernier solo.
  onUnpark: (obj: number) => void;
  onUnsolo: () => void;
  /// Présent uniquement dans la fenêtre principale — la conduite déjà
  /// détachée ne peut pas se détacher elle-même (bouton ⧉ du header).
  onDetach?: () => void;
};
