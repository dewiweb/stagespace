import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

/// Ouvre (ou focus si déjà ouverte) une surface détachable — la vue est
/// servie par le même frontend via `?view=<label>`, dans son propre
/// process webview posé sur un écran dédié (FOH). En remote navigateur
/// (bridge), WebviewWindow n'existe pas : l'appel échoue en silence —
/// le bouton qui l'appelle reste sans effet plutôt que de crasher.
export function detachWindow(label: string, title: string, width: number, height: number) {
  WebviewWindow.getByLabel(label)
    .then((w) => {
      if (w) void w.setFocus();
      else new WebviewWindow(label, { url: `/?view=${label}`, title, width, height, resizable: true });
    })
    .catch(() => {});
}
