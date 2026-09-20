import { StateCreator } from 'zustand';
import type { Node, Edge } from 'reactflow';
import { safeInvoke as invoke } from '../../utils/tauri';
import { safeSetItem, safeParseStoredJson } from '../../utils/safeStorage';

export interface PersistenceSlice {
  // Persistence (localStorage)
  saveGraph: (name: string) => Promise<void>;
  loadGraph: (name: string) => Promise<void>;
  deleteGraph: (name: string) => Promise<void>;
  listGraphs: () => Promise<string[]>;

  // Persistence sur disque (Tauri IPC)
  saveGraphToFile: (filePath: string) => Promise<void>;
  loadGraphFromFile: (filePath: string) => Promise<void>;
}

// Le slice accède à nodes/edges via get() — on étend le type attendu du store
type PersistenceStore = PersistenceSlice & {
  nodes: Node[];
  edges: Edge[];
};

// Enveloppe des fichiers .hfg — versionnée pour que les vieux fichiers
// restent lisibles et les fichiers futurs soient rejetés proprement
// plutôt que de produire des états corrompus silencieux.
const GRAPH_FILE_FORMAT = 'stagespace-graph';
const GRAPH_FILE_VERSION = 1;

interface GraphFileEnvelope {
  format?: string;
  version?: number;
  savedAt?: number;
  nodes: Node[];
  edges: Edge[];
}

/// Extrait nodes/edges d'un fichier .hfg — accepte le format legacy brut
/// `{nodes, edges}` (version implicite 0) et l'enveloppe v1+.
function parseGraphFile(raw: GraphFileEnvelope): { nodes: Node[]; edges: Edge[] } {
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new Error('Invalid graph file: missing nodes/edges');
  }
  if (raw.format === GRAPH_FILE_FORMAT) {
    const v = raw.version ?? 0;
    if (v > GRAPH_FILE_VERSION) {
      throw new Error(
        `Graph file version ${v} is newer than supported (${GRAPH_FILE_VERSION}) — update the app`,
      );
    }
  }
  // Fichiers legacy sans enveloppe (format absent) → acceptés tels quels.
  return { nodes: raw.nodes, edges: raw.edges };
}

export const createPersistenceSlice: StateCreator<PersistenceStore, [], [], PersistenceSlice> = (set, get) => ({
  saveGraph: async (name) => {
    const { nodes, edges } = get();
    const graphData = { nodes, edges, timestamp: Date.now() };
    safeSetItem(`stagespace_graph_${name}`, JSON.stringify(graphData));
  },

  loadGraph: async (name) => {
    const key = `stagespace_graph_${name}`;
    let exists = false;
    try {
      exists = localStorage.getItem(key) !== null;
    } catch {}
    if (!exists) throw new Error(`Graph "${name}" not found`);
    const graphData = safeParseStoredJson<{ nodes: Node[]; edges: Edge[] } | null>(key, null);
    if (!graphData) throw new Error(`Graph "${name}" is corrupted (backup saved)`);
    set({ nodes: graphData.nodes, edges: graphData.edges });
  },

  deleteGraph: async (name) => {
    localStorage.removeItem(`stagespace_graph_${name}`);
  },

  listGraphs: async () => {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith('stagespace_graph_'))
      .map((k) => k.replace('stagespace_graph_', ''));
  },

  saveGraphToFile: async (filePath) => {
    const { nodes, edges } = get();
    try {
      await invoke('save_graph_to_file', {
        filePath,
        graphJson: {
          format: GRAPH_FILE_FORMAT,
          version: GRAPH_FILE_VERSION,
          savedAt: Date.now(),
          nodes,
          edges,
        },
      });
    } catch (e) {
      console.error('Failed to save graph to file:', e);
      throw e;
    }
  },

  loadGraphFromFile: async (filePath) => {
    try {
      const raw = await invoke<GraphFileEnvelope>('load_graph_from_file', { filePath });
      const graph = parseGraphFile(raw);
      set({ nodes: graph.nodes, edges: graph.edges });
    } catch (e) {
      console.error('Failed to load graph from file:', e);
      throw e;
    }
  },
});
