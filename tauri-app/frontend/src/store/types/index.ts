// Généré depuis Rust (ts-rs) — l'enum `NodeType` vit dans rust-engines/graph.rs
// et son catalogue dans node_spec.rs (voir types/generated/nodeSpecs.json).
export type { NodeType } from '../../types/generated/NodeType';

export type AppStatus = 'idle' | 'compiling' | 'compiled' | 'playing' | 'error';

// Généré depuis Rust (ts-rs) — voir src-tauri/src/lib.rs `MovementInfo`.
export type { MovementInfo } from '../../types/generated/MovementInfo';

export interface HolTrack {
  id: number;
  name: string;
  position: [number, number, number];
  color: string;
}

export interface HolProject {
  tracks: HolTrack[];
  /** Données malformées droppées par le parser .hol (surfacées via toast). */
  warnings?: string[];
}
