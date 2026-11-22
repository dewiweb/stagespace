import { open, save } from '@tauri-apps/plugin-dialog';
import { useGraphStore } from '../store/useGraphStore';
import { toast } from './toast-helpers';

/// Actions fichier partagées Toolbar + MenuBar — une seule implémentation
/// des dialogs .hfg/.hol pour que les deux points d'entrée fassent
/// exactement la même chose (même toasts, mêmes filtres).

export async function saveShow(): Promise<void> {
  try {
    const filePath = await save({
      filters: [{ name: 'STAGESPACE Show', extensions: ['hfg'] }],
      defaultPath: 'show.hfg',
    });
    if (filePath) {
      await useGraphStore.getState().saveGraphToFile(filePath);
      toast.success('Show saved');
    }
  } catch (e) {
    console.error('Save show failed:', e);
    toast.error(`Save show failed: ${e}`);
  }
}

export async function loadShow(): Promise<void> {
  try {
    const result = await open({
      filters: [{ name: 'STAGESPACE Show', extensions: ['hfg', 'json'] }],
      multiple: false,
    });
    if (result) {
      await useGraphStore.getState().loadGraphFromFile(result as string);
      toast.success('Show loaded');
    }
  } catch (e) {
    console.error('Load show failed:', e);
    toast.error(`Load show failed: ${e}`);
  }
}

/// New show — un show VIDE passe par le même chemin qu'un load
/// (loadShowEnvelope) : parité sémantique garantie, les futures sections
/// de l'enveloppe seront reset pareil. Sections vides = effacées
/// (slots, cues, graphes, zones, macros → neutre, mappings) ; sections
/// absentes = préservées (tracks/.hol, config OSC — la SALLE survit au
/// changement de show). La garde playback de loadShowEnvelope refuse
/// pendant le jeu — un New show live est refusé proprement.
export async function newShow(): Promise<void> {
  try {
    await useGraphStore.getState().loadShowEnvelope({
      format: 'stagespace-show',
      version: 2,
      nodes: [],
      edges: [],
      slots: [],
      setlistOrder: [],
      cues: [],
      oscMappings: [],
      globalGraph: { nodes: [], edges: [] },
      signalGraph: { nodes: [], edges: [] },
      spatialFx: { zones: [], modulations: [], objectChannels: {} },
    });
    toast.success('New show — empty scene, venue config kept');
  } catch (e) {
    // Le guard playback throw déjà avec son toast — ne pas re-toaster.
    console.error('New show failed:', e);
  }
}

export async function importHolProject(): Promise<void> {
  try {
    const result = await open({
      filters: [{ name: 'Holophonix Project', extensions: ['hol', 'json'] }],
      multiple: false,
    });
    if (result) {
      await useGraphStore.getState().importHol(result as string);
    }
  } catch (e) {
    console.error('Import .hol failed:', e);
    toast.error(`Import .hol failed: ${e}`);
  }
}
