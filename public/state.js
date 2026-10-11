import { normalizeViewedUpdates, hasUnviewedUpdate } from './model.js';

// Storage is injected so browser persistence is optional and logic stays testable.
export function createViewedStore(storage) {
  let key = null, viewed = {};
  function read() {
    try { return normalizeViewedUpdates(JSON.parse(storage.getItem(key))); }
    catch { return viewed; }
  }
  function sync() {
    for (const [id, timestamp] of Object.entries(read())) {
      viewed[id] = Math.max(viewed[id] ?? 0, timestamp);
    }
  }
  return {
    selectAccount(login) {
      const next = `gh-pull.viewed.v1:${login.toLowerCase()}`;
      const changed = key !== next;
      if (changed) { key = next; viewed = {}; }
      sync();
      return changed;
    },
    hasUpdates(pr) { return hasUnviewedUpdate(pr, viewed); },
    mark(pr) {
      const timestamp = Date.parse(pr.updatedAt);
      if (!key || !Number.isFinite(timestamp)) return false;
      sync();
      // Record the confirmed version, never wall-clock time or a future update.
      viewed[pr.id] = Math.max(viewed[pr.id] ?? 0, timestamp);
      try { storage.setItem(key, JSON.stringify(viewed)); } catch { /* Keep session-only tracking. */ }
      return true;
    },
    storageChanged(changedKey) {
      if (!key || (changedKey !== key && changedKey !== null)) return false;
      // Explicit removal/clear resets history; normal loads merge monotonically.
      viewed = read();
      return true;
    },
  };
}

// Cancellation is best effort: the identity check also rejects responses that
// completed just before abort, or transports that ignore the abort signal.
export function createLatestRequest() {
  let current = null, revision = 0;
  return {
    get revision() { return revision; },
    start() {
      current?.controller.abort();
      const controller = new AbortController();
      current = { controller, signal: controller.signal, revision: ++revision };
      return current;
    },
    isCurrent(request) { return request === current && !request.signal.aborted; },
    cancel() {
      current?.controller.abort();
      current = null;
      revision++;
    },
  };
}

export function mergePullPages(previous, incoming, append) {
  return [...new Map([...(append ? previous : []), ...incoming].map(pr => [pr.id, pr])).values()];
}
