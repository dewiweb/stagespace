/// État de sync show — module feuille (aucun import store : les slices
/// l'importent sans créer de cycle). L'orchestration vit dans showSync.ts.

/// Identifie cette instance frontend — un client ignore les événements
/// `show-state-changed` portant son propre id (écho de son propre push).
export const SYNC_CLIENT_ID = crypto.randomUUID();

let lastPushed = '';
let lastApplied = '';
let applying = false;

export const markPushed = (json: string) => {
  lastPushed = json;
};
export const markApplied = (json: string) => {
  lastApplied = json;
};
/// Déjà connu (poussé par nous ou reçu d'un pair) → rien à refaire.
export const isDuplicateSyncContent = (json: string) =>
  json === lastPushed || json === lastApplied;

/// Fenêtre "application d'un snapshot distant" — les mutations qu'elle
/// produit ne doivent PAS être repoussées (boucle d'écho).
export const beginApply = () => {
  applying = true;
};
export const endApply = () => {
  applying = false;
};
export const isApplying = () => applying;

/// Comparaison d'enveloppes sans le volatile (`savedAt` change à chaque
/// build et rendrait toute égalité impossible).
export function envelopeComparable(env: unknown): string {
  if (env && typeof env === 'object' && 'savedAt' in env) {
    const { savedAt: _savedAt, ...rest } = env as Record<string, unknown>;
    return JSON.stringify(rest);
  }
  return JSON.stringify(env);
}
