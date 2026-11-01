import { emit } from '@tauri-apps/api/event';

/// Broadcast `timers:cancel` à toutes les fenêtres — chaque webview
/// possède SES propres timers pre_wait/follow (contextes JS séparés) :
/// annuler localement ne suffit pas, un panic/stop dans une fenêtre
/// détachée laisserait ceux de la principale armés → la cue tirerait
/// après le panic (revue des fixs H1). Le listener est dans perfSlice ;
/// le backend émet le même event depuis le sink panic/stop.
///
/// L'appelant doit AUSSI annuler localement (chemin synchrone, ce
/// helper ne touche pas le store pour éviter les cycles d'import).
export function broadcastTimerCancel() {
  void emit('timers:cancel', {}).catch(() => {});
}
