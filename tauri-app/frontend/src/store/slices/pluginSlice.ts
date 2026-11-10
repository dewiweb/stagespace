import { StateCreator } from 'zustand';
import { safeInvoke } from '../../utils/tauri';
import { toast } from '../../utils/toast-helpers';
import type { PluginManifest } from '../../types/generated/PluginManifest';
import type { PluginRegistryReport } from '../../types/generated/PluginRegistryReport';

/**
 * Registry des plugins WASM (bundles `.ssx`) — manifestes chargés au boot,
 * re-scannés via `reload_plugins`. La palette du NodeEditor liste un item
 * par manifeste ; les schemas de params viennent du manifeste (`params[]`),
 * mergés dans `PARAM_SCHEMA['Plugin']` par `pluginParamDefs`.
 *
 * Les erreurs de scan (manifeste cassé, abi_version incompatible, wasm
 * invalide) sont collectées par le backend sans bloquer les autres plugins —
 * elles apparaissent ici pour être affichées dans la palette.
 */
export interface PluginSlice {
  plugins: PluginManifest[];
  /// Erreurs du dernier scan, formatées "path: message" par le backend.
  pluginErrors: string[];
  /// Dossier où déposer les `.ssx` (null = wasmtime indisponible).
  pluginsDir: string | null;
  /// Le premier `list_plugins` a répondu (même en erreur — évite de
  /// re-spammer à chaque mount du NodeEditor).
  pluginsLoaded: boolean;
  fetchPlugins: () => Promise<void>;
  reloadPlugins: () => Promise<void>;
  /// Copie un `.ssx` choisi via dialog dans le dossier plugins + rescan.
  /// Le backend valide AVANT la copie — bundle invalide ou id déjà
  /// installé → erreur (catch), aucun reliquat dans le dossier.
  importPlugin: (sourcePath: string) => Promise<void>;
}

export const createPluginSlice: StateCreator<
  PluginSlice,
  [],
  [],
  PluginSlice
> = (set) => ({
  plugins: [],
  pluginErrors: [],
  pluginsDir: null,
  pluginsLoaded: false,

  fetchPlugins: async () => {
    try {
      const r = await safeInvoke<PluginRegistryReport>('list_plugins');
      set({
        plugins: r.manifests,
        pluginErrors: r.errors,
        pluginsDir: r.plugins_dir,
        pluginsLoaded: true,
      });
    } catch (e) {
      // Backend sans registry (wasmtime indisponible) — pas bloquant.
      set({ pluginsLoaded: true });
      toast.error('Plugin registry unavailable: ' + e);
    }
  },

  reloadPlugins: async () => {
    try {
      const r = await safeInvoke<PluginRegistryReport>('reload_plugins');
      set({
        plugins: r.manifests,
        pluginErrors: r.errors,
        pluginsDir: r.plugins_dir,
        pluginsLoaded: true,
      });
      if (r.errors.length > 0) {
        toast.warning(`${r.errors.length} plugin(s) failed to load — see palette`);
      } else {
        toast.success(`${r.manifests.length} plugin(s) loaded`);
      }
    } catch (e) {
      toast.error('Plugin reload failed: ' + e);
    }
  },

  importPlugin: async (sourcePath) => {
    try {
      const r = await safeInvoke<PluginRegistryReport>('import_plugin', {
        sourcePath,
      });
      set({
        plugins: r.manifests,
        pluginErrors: r.errors,
        pluginsDir: r.plugins_dir,
        pluginsLoaded: true,
      });
      // Le fichier importé est validé avant copie — les erreurs du report
      // ne peuvent venir que d'autres bundles déjà cassés dans le dossier.
      if (r.errors.length > 0) {
        toast.warning(
          `Plugin imported — ${r.errors.length} broken bundle(s) in plugins folder`,
        );
      } else {
        toast.success('Plugin imported');
      }
    } catch (e) {
      toast.error('Plugin import failed: ' + e);
    }
  },
});
