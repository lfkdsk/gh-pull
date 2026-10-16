import test from 'node:test';
import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';

async function fixture(t) {
  let items = [1, 2, 3].map(number => ({
    id: `pr-${number}`, number, title: `Pull ${number}`, repo: 'example/dashboard',
    url: `https://github.com/example/dashboard/pull/${number}`, author: 'alice', status: 'OPEN',
    checks: 'PENDING', checkCounts: { passed: 1, total: 8 }, review: 'NONE', reviewers: [], labels: [],
    branch: `feature/${number}`, defaultBranch: 'main', baseBranch: number === 2 ? 'feature/1' : 'main',
    branchRepository: 'example/dashboard', additions: 12, deletions: 3, changedFiles: 2, commentCount: 0,
    closingIssueCount: 1, closingIssues: [{ number: 10, title: 'Linked issue', state: 'OPEN', repo: 'example/dashboard', url: 'https://github.com/example/dashboard/issues/10' }],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T01:00:00Z',
  }));
  const list = async () => ({ viewer: 'alice', total: items.length, items, pageInfo: { hasNextPage: false } });
  list.status = async () => ({ items });
  const f = await browserFixture(t, { list });
  await f.page.clock.install();
  await f.page.goto(f.origin);
  await f.page.locator('.pr-row').first().waitFor();
  const idle = () => f.page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  await idle();
  return { ...f, idle,
    update: (id, values) => { items = items.map(pr => pr.id === id ? { ...pr, ...values } : pr); },
    remove: id => { items = items.filter(pr => pr.id !== id); },
    refresh: async () => { await f.page.click('#refresh'); await idle(); },
  };
}

test('unchanged rows, focus and dependency canvas survive refresh; only changed rows rebuild', async t => {
  const f = await fixture(t), { page } = f;
  await page.evaluate(() => {
    window.savedRow = document.querySelector('[data-pr-id="pr-1"]');
    window.savedCanvas = document.querySelector('.dependency-connector');
    window.savedControl = window.savedRow.querySelector('.branch-copy');
    window.savedControl.focus();
  });
  await page.clock.fastForward(15000); await f.idle();
  assert.equal(await page.evaluate(() => document.activeElement === window.savedControl && window.savedRow.isConnected && window.savedCanvas.isConnected), true);
  f.update('pr-3', { checks: 'SUCCESS', updatedAt: '2026-02-01T00:00:00Z' });
  await page.clock.fastForward(15000); await f.idle();
  await page.waitForFunction(() => document.querySelector('[data-pr-id="pr-3"]').textContent.includes('Checks passed'));
  assert.equal(await page.evaluate(() => document.activeElement === window.savedControl && document.querySelector('[data-pr-id="pr-1"]') === window.savedRow), true);
  assert.equal(await page.locator('.pr-row').first().getAttribute('data-pr-id'), 'pr-3');
  f.remove('pr-2'); await f.refresh();
  assert.equal(await page.locator('[data-pr-id="pr-2"]').count(), 0);
  assert.equal(await page.locator('.dependency-connector').count(), 0);
  assert.deepEqual(f.errors, []);
});

test('background updates refresh other rows without replacing an active editor or popover', async t => {
  const f = await fixture(t), { page } = f;
  await page.locator('[data-pr-id="pr-1"] .edit-title').click();
  await page.locator('.title-editor input').fill('Unsaved draft');
  await page.evaluate(() => {
    window.editor = document.querySelector('.title-editor input');
    window.editor.setSelectionRange(2, 6);
  });
  f.update('pr-1', { title: 'Server title' });
  f.update('pr-3', { checks: 'SUCCESS' });
  await page.clock.fastForward(15000); await f.idle();
  await page.waitForFunction(() => document.querySelector('[data-pr-id="pr-3"]').textContent.includes('Checks passed'));
  assert.deepEqual(await page.evaluate(() => [document.activeElement === window.editor, window.editor.value, window.editor.selectionStart, window.editor.selectionEnd]), [true, 'Unsaved draft', 2, 6]);
  await page.locator('.title-editor input').press('Escape');
  await page.locator('[data-pr-id="pr-1"] .issue-count').click();
  f.update('pr-3', { title: 'Updated while popover open' });
  await page.clock.fastForward(15000); await f.idle();
  await page.waitForFunction(() => document.querySelector('[data-pr-id="pr-3"] .pr-title').textContent === 'Updated while popover open');
  assert.equal(await page.locator('#closing-issues').evaluate(panel => panel.matches(':popover-open')), true);
  await page.keyboard.press('Escape');
  await f.refresh();
  assert.equal(await page.locator('[data-pr-id="pr-1"] .pr-title').textContent(), 'Server title');
  assert.deepEqual(f.errors, []);
});
