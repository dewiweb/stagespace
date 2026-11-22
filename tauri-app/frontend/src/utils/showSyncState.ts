/// État de sync show — module feuille (aucun import store : les slices
/// l'importent sans créer de cycle). L'orchestration vit dans showSync.ts.

/// Identifie cette instance frontend — un client ignore les événements
/// `show-state-changed` portant son propre id (écho de son propre push).
/// crypto.randomUUID n'existe qu'en secure context (HTTPS/localhost) :
/// la webui servie en HTTP LAN a besoin du fallback.
export const SYNC_CLIENT_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

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
/// produit ne doivent PAS être repoussées (boucle d'écho). Une marge de
/// settle couvre les effets post-apply asynchrones (rebind movements,
/// normalize, polls) qui écrivent après endApply et repousseraient un
/// contenu drifté → ping-pong entre clients.
export const beginApply = () => {
  applying = true;
};
let lastApplyEnd = 0;
const APPLY_SETTLE_MS = 1500;
export const endApply = () => {
  applying = false;
  lastApplyEnd = Date.now();
};
export const isApplying = () => applying || Date.now() - lastApplyEnd < APPLY_SETTLE_MS;

/// Champs volatils exclus du comparable : métadonnée de save, états de
/// vue React Flow, bindings runtime, états possédés par le backend ou
/// par la vue opérateur. Ils restent dans l'enveloppe (save/load) mais
/// ne doivent pas décider "contenu différent → repush".
const VOLATILE_KEYS = new Set([
  'savedAt',
  'selected',
  'dragging',
  'measured',
  'positionAbsolute',
  'movementId',
  'lastMovementId',
  'manualPositions', // runtime backend — converge via le poll, pas l'enveloppe
  'selectedTrackIds', // sélection opérateur — vue locale
  'editingSlotId', // focus d'éditeur — vue locale par opérateur
]);

/// Les IDs de nodes/edges embeddassent timestamp + index de
/// matérialisation (`Objects-1795368030462-4`) — chaque client régénère
/// le graphe à l'affichage, donc deux graphes sémantiquement identiques
/// ont des IDs textuels différents. On les remplace par un rang canonique
/// dérivé de la signature de contenu du node.
const MATERIALIZATION_TS = /\d{10,}/g;

function canon(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return idMap.get(value) ?? value.replace(MATERIALIZATION_TS, '#');
  }
  if (Array.isArray(value)) return value.map((v) => canon(v, idMap));
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      if (VOLATILE_KEYS.has(k)) continue;
      out[k] = canon(src[k], idMap);
    }
    // L'id d'une edge embedde les ids de ses extrémités — on la dérive du
    // tuple canonique plutôt que de la chaîne générée.
    if (
      typeof src.id === 'string' &&
      typeof src.source === 'string' &&
      typeof src.target === 'string'
    ) {
      out.id = `e(${out.source},${out.target},${out.sourceHandle ?? ''},${out.targetHandle ?? ''})`;
    }
    return out;
  }
  return value;
}

/// Passe 1 : pour chaque tableau `nodes` trouvé dans l'enveloppe, map
/// node.id → `n<rang>` où le rang = position du node trié par signature
/// de contenu. Deux matérialisations du même graphe donnent le même map.
function buildIdMap(value: unknown, map: Map<string, string>): void {
  if (Array.isArray(value)) {
    for (const v of value) buildIdMap(v, map);
    return;
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (Array.isArray(o.nodes)) {
      const sigs = (o.nodes as Array<Record<string, unknown>>)
        .filter((n) => typeof n.id === 'string')
        .map((n) => {
          const { id: _id, ...rest } = n;
          return { id: n.id as string, sig: JSON.stringify(canon(rest, new Map())) };
        })
        .sort((a, b) => a.sig.localeCompare(b.sig));
      sigs.forEach((s, i) => map.set(s.id, `n${i}`));
      return; // les nodes eux-mêmes sont déjà traités via sigs
    }
    for (const k of Object.keys(o)) buildIdMap(o[k], map);
  }
}

/// Sérialisation canonique d'une enveloppe : ordre de clés stable, champs
/// volatils exclus, IDs de matérialisation renumérotés par signature.
/// Deux UIs avec le même show produisent le même comparable — sinon la
/// dédup casse et chaque apply repousse une version "driftée" (ping-pong).
export function envelopeComparable(env: unknown): string {
  const idMap = new Map<string, string>();
  buildIdMap(env, idMap);
  let target = env;
  // `macros` top-level = macros global, modulées en runtime par le signal
  // graph (SignalOut → yaw…) — vérité = commandes backend, pas le contenu
  // du show. Les `slot.macros` par-move restent dans le comparable
  // (contenu authoring), d'où l'exclusion au niveau racine seulement.
  if (env && typeof env === 'object' && 'macros' in env) {
    const { macros: _macros, ...rest } = env as Record<string, unknown>;
    target = rest;
  }
  return JSON.stringify(canon(target, idMap));
}
