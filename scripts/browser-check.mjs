import test from 'node:test';
import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';
import { ApiError } from '../github.js';

async function fixture(t) {
  let pr = {
    id: 'fixture-pr', number: 1, title: 'Improve keyboard navigation',
    url: 'https://github.com/example/dashboard/pull/1', repo: 'example/dashboard',
    author: 'alice', status: 'OPEN', branch: 'feature/keyboard',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T01:00:00Z',
    additions: 520, deletions: 148, changedFiles: 8, commentCount: 12, review: 'NONE',
    checks: 'SUCCESS', reviewers: [], labels: [], canMerge: true,
    headOid: 'a'.repeat(40), mergeMethod: 'SQUASH',
  };
  let reject = false, hour = 1, hold, release;
  const list = async ({ query = '' } = {}) => {
    if (hold) await hold;
    const items = query.includes('does-not-exist') ? [] : [{ ...pr }];
    return { viewer: 'alice', total: items.length, items, pageInfo: { hasNextPage: false } };
  };
  list.mergeReadiness = async () => ({ items: [] });
  const update = fields => {
    if (reject) throw new ApiError('Fixture rejected this change', 403);
    pr = { ...pr, ...fields, updatedAt: `2026-01-01T${String(++hour).padStart(2, '0')}:00:00Z` };
    return { ...pr };
  };
  // Every action is implemented by this fixture. Nothing calls GitHub or gh CLI.
  const { page, origin, errors } = await browserFixture(t, {
    list,
    updateTitle: async ({ title }) => update({ title }),
    convertToDraft: async () => update({ status: 'DRAFT', canMerge: false }),
    markReadyForReview: async () => update({ status: 'OPEN', canMerge: true }),
    merge: async () => update({ status: 'MERGED', canMerge: false }),
  });
  t.after(() => release?.());
  await page.addInitScript(() => {
    window.copiedText = null;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => {
      if (window.failClipboard) throw new Error('Clipboard denied');
      window.copiedText = text;
    } } });
  });
  const open = async () => {
    await page.goto(`${origin}/?state=all`);
    await page.locator('.pr-row').waitFor();
  };
  const unread = () => page.locator('.pr-row').evaluate(row => row.classList.contains('has-updates'));
  const waitRead = () => page.waitForFunction(() => !document.querySelector('.pr-row').classList.contains('has-updates'));
  const refresh = async () => {
    await page.click('#refresh');
    await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  };
  return {
    page, open, unread, waitRead, refresh, errors,
    reject: value => { reject = value; },
    laterUpdate: () => update({}),
    holdRefresh: () => { hold = new Promise(resolve => { release = resolve; }); },
    releaseRefresh: () => { release(); hold = null; },
  };
}

test('title, draft, ready and merge interactions preserve read state and retry behavior', async t => {
  const f = await fixture(t), { page } = f;
  await f.open();
  await page.click('.edit-title');
  await page.fill('.title-editor input', 'Cancelled edit');
  await page.press('.title-editor input', 'Escape');
  assert.equal(await page.locator('.pr-title').textContent(), 'Improve keyboard navigation');
  assert.equal(await f.unread(), true);
  await page.click('.edit-title');
  await page.fill('.title-editor input', 'Updated title');
  f.reject(true);
  await page.press('.title-editor input', 'Enter');
  await page.locator('.title-error').waitFor();
  assert.equal(await page.locator('.title-editor input').inputValue(), 'Updated title');
  assert.equal(await f.unread(), true);
  f.reject(false);
  await page.press('.title-editor input', 'Enter');
  await f.waitRead();
  assert.equal(await page.locator('.pr-title').textContent(), 'Updated title');
  await f.open();
  assert.equal(await f.unread(), false);
  for (const state of ['Draft', 'Open', 'Merged']) {
    f.laterUpdate(); await f.refresh();
    assert.equal(await f.unread(), true);
    const button = state === 'Merged' ? '.merge-action' : '.draft-action';
    f.reject(true); await page.click(button); await page.locator('.draft-error').waitFor();
    assert.equal(await f.unread(), true);
    f.reject(false); await page.click(button); await f.waitRead();
    assert.equal(await page.locator('.title-line > .badge').first().textContent(), state);
    await f.open(); assert.equal(await f.unread(), false);
  }
  assert.deepEqual(f.errors, []);
});

test('clipboard, filters, background refresh, icons and responsive metadata styling', async t => {
  const f = await fixture(t), { page } = f;
  await page.clock.install();
  await f.open();
  for (const [selector, text] of [['.copy-link', 'https://github.com/example/dashboard/pull/1'], ['.branch-copy', 'feature/keyboard']]) {
    await page.click(selector);
    await page.waitForFunction(expected => window.copiedText === expected, text);
    assert.match(await page.locator(selector).getAttribute('title'), /copied/);
    await page.clock.fastForward(2100);
    assert.equal(await page.locator(`${selector} svg`).count(), 1);
    await page.evaluate(() => { window.failClipboard = true; });
    await page.click(selector);
    await page.waitForFunction(s => document.querySelector(s).title.startsWith('Could not copy'), selector);
    await page.clock.fastForward(2100);
    assert.equal(await page.locator(`${selector} svg`).count(), 1);
    await page.evaluate(() => { window.failClipboard = false; });
  }
  for (const scope of ['authored', 'involved', 'review']) {
    await page.selectOption('#scope', scope);
    await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
    await page.selectOption('#scope', scope);
    assert.equal(await page.locator('#scope').inputValue(), scope);
  }
  await page.locator('.cm-content').fill('does-not-exist');
  await page.click('#query-submit');
  await page.waitForFunction(() => !document.querySelector('.pr-row'));
  await page.locator('.cm-content').fill(''); await page.click('#query-submit'); await page.locator('.pr-row').waitFor();
  f.holdRefresh(); await page.click('#refresh');
  assert.equal(await page.locator('#refresh').isDisabled(), true);
  assert.equal(await page.locator('.pr-row').count(), 1);
  f.releaseRefresh(); await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('.diff-counts + .file-count').textContent(), '8');
  assert.equal(await page.locator('.file-count').getAttribute('aria-label'), '8 files changed');
  assert.equal(await page.locator('.file-count').getAttribute('title'), null);
  assert.equal(await page.locator('.file-count + .comment-count').textContent(), '12');
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    const styles = await page.locator('.branch-copy, .updated-time, .file-count, .comment-count').evaluateAll(nodes => nodes.map(node => {
      const s = getComputedStyle(node); return [s.backgroundColor, s.padding, s.borderRadius];
    }));
    for (const style of styles.slice(1)) assert.deepEqual(styles[0], style);
    for (const width of [1280, 375, 320]) {
      await page.setViewportSize({ width, height: 800 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
  }
  assert.deepEqual(f.errors, []);
});
