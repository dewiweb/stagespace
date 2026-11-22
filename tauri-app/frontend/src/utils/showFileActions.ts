import { open, save } from '@tauri-apps/plugin-dialog';
import { useGraphStore } from '../store/useGraphStore';
import { useSessionStore } from '../store/useSessionStore';
import { guardDirty } from './sessionSafety';
import { toast } from './toast-helpers';

/// Actions fichier partagées Toolbar + MenuBar — une seule implémentation
/// des dialogs .hfg/.hol pour que les deux points d'entrée fassent
/// exactement la même chose (même toasts, mêmes filtres).

/// Retourne true si un fichier a réellement été écrit (le caller peut
/// enchaîner l'action différée — ex "Save & quit" de la modale unsaved).
export async function saveShow(saveAs = false): Promise<boolean> {
  try {
    // Save direct : le show a déjà un chemin → pas de dialog, même chemin
    // que Ctrl+S d'une app desktop. saveAs force le dialog.
    const existing = useSessionStore.getState().currentShowPath;
    const filePath = existing && !saveAs
      ? existing
      : await save({
          filters: [{ name: 'STAGESPACE Show', extensions: ['hfg'] }],
          defaultPath: existing ?? 'show.hfg',
        });
    if (!filePath) return false;
    await useGraphStore.getState().saveGraphToFile(filePath);
    toast.success('Show saved');
    return true;
  } catch (e) {
    console.error('Save show failed:', e);
    toast.error(`Save show failed: ${e}`);
    return false;
  }
}

export function loadShow(): void {
  guardDirty('Load show', () => { void doLoadShow(); });
}

async function doLoadShow(): Promise<void> {
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

/// Recent files — même chemin que loadShow sans la boîte de dialogue.
export function loadShowFromPath(filePath: string): void {
  guardDirty(`Load ${basename(filePath)}`, () => {
    void (async () => {
      try {
        await useGraphStore.getState().loadGraphFromFile(filePath);
        toast.success('Show loaded');
      } catch (e) {
        console.error('Load show failed:', e);
        toast.error(`Load show failed: ${e}`);
      }
    })();
  });
}

export function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() ?? p;
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
    // Document neuf = untitled (clean, plus de chemin associé).
    useSessionStore.getState().markUntitled();
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
