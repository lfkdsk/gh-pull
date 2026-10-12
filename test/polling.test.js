import test from 'node:test';
import assert from 'node:assert/strict';
import { createPollingSchedule, pendingPulls } from '../public/polling.js';
import { cachedRequest } from '../request-cache.js';

test('polling prioritizes full searches, checks active PRs between searches, and pauses when inactive', () => {
  let now = 0;
  const schedule = createPollingSchedule(() => now);
  now = 15_000;
  assert.equal(schedule.due(), null);
  assert.equal(schedule.due({ pending: true }), 'status');
  for (const state of [{ visible: false }, { online: false }, { busy: true }]) {
    assert.equal(schedule.due({ pending: true, ...state }), null);
  }
  schedule.succeeded('status');
  now = 30_000;
  assert.equal(schedule.due({ pending: true }), 'list');
  schedule.succeeded('list');
  now = 300_000;
  assert.equal(schedule.due({ visible: false }), null);
  assert.equal(schedule.due(), 'list', 'Returning after inactivity refreshes immediately');
  assert.deepEqual(pendingPulls([{ id: 1, status: 'DRAFT', checks: 'PENDING' }, { id: 2, status: 'MERGED', checks: 'PENDING' }, { id: 3, status: 'OPEN', mergePending: true }]).map(pr => pr.id), [1, 3]);
});

test('backoff respects Retry-After, survives focus/invalidation, caps exponential delay and resets on success', () => {
  let now = 0;
  const schedule = createPollingSchedule(() => now);
  schedule.failed(); assert.equal(schedule.nextAt(), 30_000);
  schedule.failed(); assert.equal(schedule.nextAt(), 60_000);
  schedule.failed(3600); assert.equal(schedule.nextAt(), 3_600_000);
  schedule.invalidate(); assert.equal(schedule.due(), null);
  now = 3_600_000;
  assert.equal(schedule.due(), 'list');
  schedule.succeeded('list');
  schedule.failed(); assert.equal(schedule.nextAt(), now + 30_000);
  for (let i = 0; i < 20; i++) schedule.failed();
  assert.equal(schedule.nextAt(), now + 300_000);
});

test('an invalidation during a full refresh is not lost when its older request completes', () => {
  const schedule = createPollingSchedule(() => 0);
  const revision = schedule.revision;
  schedule.invalidate();
  schedule.succeeded('list', revision);
  assert.equal(schedule.due(), 'list');
  schedule.succeeded('list');
  assert.equal(schedule.due(), null);
});

test('shared cache coalesces forced requests in flight, expires after completion, and invalidates safely', async () => {
  const cache = new Map();
  let release, calls = 0;
  const fetch = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const first = cachedRequest(cache, 'one', fetch);
  const second = cachedRequest(cache, 'one', fetch, { force: true });
  await Promise.resolve(); assert.equal(calls, 1);
  release('first'); assert.deepEqual(await Promise.all([first, second]), ['first', 'first']);
  assert.equal(await cachedRequest(cache, 'one', fetch), 'first');
  cache.get('one').expires = 0;
  const stale = cachedRequest(cache, 'one', fetch);
  await Promise.resolve(); const releaseStale = release;
  cache.clear();
  const fresh = cachedRequest(cache, 'one', async () => 'fresh');
  releaseStale('stale'); await stale; await fresh;
  assert.equal(await cachedRequest(cache, 'one', fetch), 'fresh');
  await assert.rejects(cachedRequest(cache, 'fail', async () => { throw Error('temporary'); }));
  assert.equal(await cachedRequest(cache, 'fail', async () => 'recovered'), 'recovered');
});
