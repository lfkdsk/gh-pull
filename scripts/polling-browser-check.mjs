import test from 'node:test';
import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';

const pull = {
  id: 'fixture-one', number: 1, title: 'Improve polling', repo: 'example/dashboard',
  url: 'https://github.com/example/dashboard/pull/1', author: 'alice', status: 'OPEN',
  checks: 'PENDING', checkCounts: { passed: 1, total: 8 }, review: 'NONE', reviewers: [], labels: [],
  branch: 'feature/polling', additions: 12, deletions: 3, changedFiles: 2, commentCount: 0,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T01:00:00Z',
};
const pageOf = (items, next = false) => ({ viewer: 'alice', total: 2, items, pageInfo: { hasNextPage: next, endCursor: next ? 'page2' : null } });

async function pollingFixture(t) {
  const f = await browserFixture(t, { list: async () => pageOf([pull]) });
  const { page, origin } = f;
  await page.clock.install();
  let listCalls = 0, statusCalls = 0, hold, release, failure = false, paging = false;
  let current = structuredClone(pull);
  await page.route(/\/api\/pulls\?/, async route => {
    listCalls++;
    if (hold) await hold;
    if (failure) return route.fulfill({ status: 429, headers: { 'Retry-After': '120' }, json: { error: 'Fixture rate limit' } });
    const second = new URL(route.request().url()).searchParams.has('cursor');
    await route.fulfill({ json: pageOf(second ? [{ ...current, id: 'fixture-two', number: 2 }] : [current], paging && !second) });
  });
  await page.route(/\/api\/pulls\/status\?/, route => {
    statusCalls++;
    return route.fulfill({ json: { items: [current] } });
  });
  await page.addInitScript(() => {
    window.fixtureHidden = false; window.fixtureOnline = true;
    Object.defineProperty(document, 'hidden', { get: () => window.fixtureHidden });
    Object.defineProperty(navigator, 'onLine', { get: () => window.fixtureOnline });
  });
  t.after(() => release?.());
  await page.goto(origin);
  await page.locator('.pr-row').waitFor();
  const idle = () => page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  await idle();
  return { ...f, idle, counts: () => [listCalls, statusCalls],
    update: values => { current = { ...current, ...values }; },
    fail: value => { failure = value; },
    paging: () => { paging = true; },
    hold: () => { hold = new Promise(resolve => { release = resolve; }); },
    release: () => { hold = null; release(); },
  };
}

test('active checks refresh at 15s, lists at 30s, with rows retained and refresh disabled in flight', async t => {
  const f = await pollingFixture(t), { page } = f;
  assert.deepEqual(f.counts(), [1, 0]);
  await page.clock.fastForward(15_000);
  await page.waitForFunction(() => document.querySelector('#updated').textContent.startsWith('Checked'));
  await f.idle();
  assert.deepEqual(f.counts(), [1, 1]);
  f.hold();
  await page.clock.fastForward(15_000);
  await page.waitForFunction(() => document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('.pr-row').count(), 1);
  assert.deepEqual(f.counts(), [2, 1]);
  f.release(); await f.idle();
  f.update({ checks: 'SUCCESS', checkCounts: { passed: 8, total: 8 } });
  await page.clock.fastForward(15_000);
  await page.waitForFunction(() => document.querySelector('.pr-row').textContent.includes('Checks passed'));
  assert.deepEqual(f.counts(), [2, 2]);
  assert.deepEqual(f.errors, []);
});

test('polling pauses while hidden or offline, but preserves edits while refreshing', async t => {
  const f = await pollingFixture(t), { page } = f;
  for (const property of ['fixtureHidden', 'fixtureOnline']) {
    await page.evaluate(property => {
      window[property] = property === 'fixtureHidden';
      window.dispatchEvent(new Event(property === 'fixtureOnline' ? 'offline' : 'focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    }, property);
    const before = f.counts();
    await page.clock.fastForward(60_000);
    assert.deepEqual(f.counts(), before);
    await page.evaluate(property => {
      window[property] = property !== 'fixtureHidden';
      window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange'));
    }, property);
    await f.idle();
    assert.equal(f.counts()[0], before[0] + 1);
  }
  await page.click('.edit-title'); await page.fill('.title-editor input', 'Keep my draft');
  const before = f.counts();
  await page.clock.fastForward(60_000);
  await f.idle();
  assert.ok(f.counts()[0] > before[0]);
  assert.equal(await page.locator('.title-editor input').inputValue(), 'Keep my draft');
  await page.press('.title-editor input', 'Escape');
  await page.clock.fastForward(1000); await f.idle();
  assert.ok(f.counts()[0] > before[0]);
});

test('rate-limit backoff survives returning to the tab and preserves existing rows', async t => {
  const f = await pollingFixture(t), { page } = f;
  f.fail(true);
  await page.clock.fastForward(30_000); await f.idle();
  await page.locator('#error').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.pr-row').count(), 1);
  assert.deepEqual(f.counts(), [2, 0]);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.clock.fastForward(119_000);
  assert.deepEqual(f.counts(), [2, 0]);
  f.fail(false);
  await page.clock.fastForward(1000); await f.idle();
  assert.deepEqual(f.counts(), [3, 0]);
});

test('background list refresh preserves loaded pagination and edits started during a request', async t => {
  const f = await pollingFixture(t), { page } = f;
  f.paging();
  await page.click('#refresh'); await f.idle();
  await page.click('#more'); await f.idle();
  assert.equal(await page.locator('.pr-row').count(), 2);
  await page.clock.fastForward(30_000); await f.idle();
  assert.equal(await page.locator('.pr-row').count(), 2);
  f.hold(); await page.clock.fastForward(30_000);
  await page.waitForFunction(() => document.querySelector('#refresh').disabled);
  await page.locator('.edit-title').first().click();
  await page.fill('.title-editor input', 'Do not replace this');
  f.release(); await f.idle();
  assert.equal(await page.locator('.title-editor input').inputValue(), 'Do not replace this');
});

test('tabs share list requests and receive local mutation invalidations over SSE', async t => {
  let current = { ...pull, checks: 'SUCCESS' }, calls = 0;
  const list = async () => { calls++; return pageOf([current]); };
  const { page, origin } = await browserFixture(t, { list, updateTitle: async ({ title }) => {
    current = { ...current, title, updatedAt: '2026-01-01T02:00:00Z' }; return current;
  } });
  await page.goto(origin); await page.locator('.pr-row').waitFor();
  const other = await page.context().newPage();
  await other.goto(origin); await other.locator('.pr-row').waitFor();
  assert.equal(calls, 1);
  await page.evaluate(async () => {
    const response = await fetch('/api/pulls/title', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'fixture-one', title: 'Updated in another tab', expectedTitle: 'Improve polling' }) });
    if (!response.ok) throw Error('Fixture mutation failed');
  });
  await other.waitForFunction(() => document.querySelector('.pr-title').textContent === 'Updated in another tab');
  assert.equal(calls, 2);
  await other.close();
});

test('merging in the open view stays removed through stale background/manual results and filter changes', async t => {
  const stale = { ...pull, checks: 'SUCCESS', canMerge: true, headOid: 'a'.repeat(40), mergeMethod: 'SQUASH' };
  const list = async () => pageOf([stale]); // GitHub search has not caught up yet.
  const { page, origin } = await browserFixture(t, { list, merge: async () => ({
    id: stale.id, status: 'MERGED', updatedAt: '2026-01-01T02:00:00Z', canMerge: false,
  }) });
  await page.clock.install();
  await page.goto(origin); await page.locator('.pr-row').waitFor();
  assert.equal(await page.locator('#state').inputValue(), 'open');
  await page.click('.merge-action');
  await page.waitForFunction(() => !document.querySelector('.pr-row'));
  await page.clock.fastForward(1000);
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('.pr-row').count(), 0);
  await page.click('#refresh');
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('.pr-row').count(), 0);
  await page.selectOption('#state', 'all'); await page.locator('.pr-row').waitFor();
  assert.equal(await page.locator('.title-line > .badge').first().textContent(), 'Merged');
  assert.equal(await page.locator('.merge-action').count(), 0);
  await page.selectOption('#state', 'open');
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('.pr-row').count(), 0);
});

test('a status refresh removes a PR merged elsewhere from the open view', async t => {
  const f = await pollingFixture(t), { page } = f;
  f.update({ status: 'MERGED', updatedAt: '2026-01-01T02:00:00Z' });
  await page.clock.fastForward(15_000);
  await page.waitForFunction(() => !document.querySelector('.pr-row'));
  await page.clock.fastForward(1000); await f.idle();
  assert.equal(await page.locator('.pr-row').count(), 0);
});
