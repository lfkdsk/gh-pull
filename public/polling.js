// Scheduling is independent of the DOM and transport so time/backoff can be tested.
export const LIST_INTERVAL = 30_000;
export const STATUS_INTERVAL = 15_000;
export function createPollingSchedule(now = Date.now) {
  let listAt = now(), statusAt = now(), failures = 0, blockedUntil = 0, invalidated = false, revision = 0;
  return {
    get revision() { return revision; },
    get backingOff() { return now() < blockedUntil; },
    invalidate() { invalidated = true; revision++; },
    nextAt(pending = false) {
      return Math.max(blockedUntil, invalidated ? 0 : Math.min(listAt + LIST_INTERVAL, pending ? statusAt + STATUS_INTERVAL : Infinity));
    },
    due({ visible = true, online = true, busy = false, pending = false } = {}) {
      if (!visible || !online || busy || now() < this.nextAt(pending)) return null;
      return invalidated || now() >= listAt + LIST_INTERVAL ? 'list' : 'status';
    },
    succeeded(kind, startedAtRevision = revision) {
      failures = 0; blockedUntil = 0;
      statusAt = now();
      if (kind === 'list') { listAt = now(); if (startedAtRevision === revision) invalidated = false; }
    },
    failed(retryAfter = 0) {
      failures++;
      blockedUntil = now() + Math.max(Math.min(30_000 * 2 ** Math.min(failures - 1, 4), 300_000), retryAfter * 1000);
    },
  };
}

export function pendingPulls(items) {
  return items.filter(pr => ['OPEN', 'DRAFT'].includes(pr.status) && (['PENDING', 'EXPECTED'].includes(pr.checks) || pr.mergePending));
}
