/**
 * Pont dev headless — active UNIQUEMENT quand
 * `localStorage.stagespace_ipc_bridge` contient l'URL du pont
 * (ex. `http://127.0.0.1:4173`). Sinon : no-op, mode navigateur normal.
 *
 * Raccourci : `?bridge=http://hote:4173` dans l'URL persiste la valeur
 * en localStorage et nettoie l'URL — une seule URL à ouvrir sur une
 * machine distante, `?bridge=off` désactive.
 *
 * Installe `window.__TAURI_INTERNALS__` compatible avec @tauri-apps/api v2 :
 *  - invoke(cmd, args)      → POST {bridge}/invoke (vrai backend headless)
 *  - plugin:event|listen    → registry local + EventSource {bridge}/events
 *  - transformCallback etc. → callbacks locales
 *
 * Le pont : `cargo test --test dev_bridge -- --ignored` dans src-tauri.
 */
(function () {
  var bridge = null;
  try {
    var q = new URLSearchParams(location.search).get('bridge');
    if (q) {
      if (q === 'off') localStorage.removeItem('stagespace_ipc_bridge');
      else localStorage.setItem('stagespace_ipc_bridge', q);
      var u = new URL(location.href);
      u.searchParams.delete('bridge');
      history.replaceState(null, '', u.toString());
    }
    bridge = localStorage.getItem('stagespace_ipc_bridge');
  } catch (e) {
    return;
  }
  if (!bridge) return;

  var callbacks = new Map();
  var cbId = 0;
  var listeners = new Map(); // eventName -> Map<eventId, callbackId>
  var evtId = 0;

  function runCallback(id, data) {
    var cb = callbacks.get(id);
    if (!cb) return;
    if (cb.once) callbacks.delete(id);
    cb.fn(data);
  }

  // Un listener = paire (eventId -> callbackId) : la suppression doit
  // nettoyer les deux, comme le fait le unregisterListener natif de Tauri.
  function removeListener(event, eventId) {
    var m = listeners.get(event);
    if (!m) return;
    var cid = m.get(eventId);
    m.delete(eventId);
    if (cid !== undefined) callbacks.delete(cid);
  }

  var es = new EventSource(bridge + '/events');
  es.onmessage = function (m) {
    try {
      var msg = JSON.parse(m.data);
      var subs = listeners.get(msg.event);
      if (subs) {
        subs.forEach(function (cid, eid) {
          runCallback(cid, { event: msg.event, id: eid, payload: msg.payload });
        });
      }
    } catch (e) {}
  };

  window.__TAURI_INTERNALS__ = {
    callbacks: callbacks,
    __listeners: listeners,
    metadata: {
      currentWindow: { label: 'main' },
      currentWebviewWindow: { label: 'main' },
      currentWebview: { label: 'main' },
    },
    plugins: {},
    invoke: function (cmd, args, _options) {
      args = args || {};
      if (cmd === 'plugin:event|listen') {
        var id = ++evtId;
        if (!listeners.has(args.event)) listeners.set(args.event, new Map());
        listeners.get(args.event).set(id, args.handler);
        return Promise.resolve(id);
      }
      if (cmd === 'plugin:event|unlisten') {
        removeListener(args.event, args.eventId);
        return Promise.resolve();
      }
      if (cmd === 'plugin:event|emit' || cmd === 'plugin:event|emit_to') {
        var subs = listeners.get(args.event);
        if (subs) {
          subs.forEach(function (cid, eid) {
            runCallback(cid, { event: args.event, id: eid, payload: args.payload });
          });
        }
        return Promise.resolve();
      }
      return fetch(bridge + '/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: cmd, args: args }),
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if ('err' in res) return Promise.reject(res.err);
          return res.ok;
        });
    },
    transformCallback: function (fn, once) {
      var id = ++cbId;
      callbacks.set(id, { fn: fn, once: !!once });
      return id;
    },
    unregisterCallback: function (id) {
      callbacks.delete(id);
    },
    runCallback: runCallback,
    convertFileSrc: function (p) { return p; },
    canParseTarget: function () { return false; },
  };
  // Requis par @tauri-apps/api v2 : _unlisten() appelle cet hook AVANT
  // l'invoke plugin:event|unlisten — sans lui le unlisten jetait une
  // TypeError et le listener fuyait (doublons StrictMode / remounts).
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: function (event, eventId) {
      removeListener(event, eventId);
    },
  };
  window.__TAURI__ = {};
})();
