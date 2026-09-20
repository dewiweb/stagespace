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
      await invoke('save_graph_to_file', { filePath, graphJson: { nodes, edges } });
    } catch (e) {
      console.error('Failed to save graph to file:', e);
      throw e;
    }
  },

  loadGraphFromFile: async (filePath) => {
    try {
      const graph = await invoke<{ nodes: Node[]; edges: Edge[] }>('load_graph_from_file', { filePath });
      set({ nodes: graph.nodes, edges: graph.edges });
    } catch (e) {
      console.error('Failed to load graph from file:', e);
      throw e;
    }
  },
});
