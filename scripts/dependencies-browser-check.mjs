import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { browserFixture } from './browser-fixture.mjs';
const base = { author: 'alice', repo: 'example/dashboard', branchRepository: 'example/dashboard', status: 'OPEN', checks: 'SUCCESS', review: 'NONE', reviewers: [], labels: [], additions: 42, deletions: 8, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T01:00:00Z' };
export const dependencies = [
  ['A', 'main', 'Add the shared session API'], ['B', 'A', 'Build the sign-in flow'],
  ['C', 'B', 'Handle expired sessions'], ['D', 'A', 'Add session audit events'],
].map(([id, baseBranch, title], index) => ({ ...base, id, branch: id, baseBranch, title, number: index + 1, url: `https://github.com/example/dashboard/pull/${index + 1}` }));
test('dependency rows match the sketch, remain accessible and fit mobile themes', async t => {
  const { page, origin, errors } = await browserFixture(t, { list: async () => ({ viewer: 'alice', total: 4, items: [dependencies[2], dependencies[1], dependencies[3], dependencies[0]], pageInfo: { hasNextPage: false } }) });
  await page.goto(origin); await page.locator('.pr-row').first().waitFor();
  assert.deepEqual(await page.locator('.pr-row').evaluateAll(rows => rows.map(r => r.dataset.prId)), ['A', 'B', 'C', 'D']);
  assert.equal(await page.getByRole('list', { name: 'Pull requests merging into #1', exact: true }).locator(':scope > li').count(), 2);
  await mkdir('/tmp/gh-pull-dependencies', { recursive: true });
  for (const colorScheme of ['light', 'dark']) for (const width of [1280, 375, 320]) {
    await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width, height: 900 });
    const positions = await page.locator('.pr-row').evaluateAll(rows => rows.map(r => r.getBoundingClientRect().x));
    assert.ok(positions[0] < positions[1] && positions[1] < positions[2]);
    assert.equal(positions[1], positions[3]);
    const connectorsInside = await page.locator('.dependency-connector').evaluateAll(nodes => nodes.every(node => {
      const connector = node.getBoundingClientRect();
      const group = node.closest('.pr-group').getBoundingClientRect();
      return connector.left >= group.left + 5;
    }));
    assert.equal(connectorsInside, true, 'Connectors must have clearance from the group border');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `/tmp/gh-pull-dependencies/${colorScheme}-${width}.png` });
  }
  await page.locator('[data-pr-id="B"] .branch-copy').focus();
  assert.match(await page.locator('[data-pr-id="B"]').innerText(), /Merges into #1/);
  assert.deepEqual(errors, []);
});

test('shared SVG trunks remain continuous at enlarged zoom and after collapse', async t => {
  const { page, origin, errors } = await browserFixture(t, { list: async () => ({ viewer: 'alice', total: 4, items: dependencies, pageInfo: { hasNextPage: false } }) });
  await page.goto(origin); await page.locator('.dependency-trunk').first().waitFor();
  await page.setViewportSize({ width: 1000, height: 1200 });
  for (const zoom of [1.25, 1.5, 2]) {
    await page.evaluate(value => { document.documentElement.style.zoom = value; }, zoom);
    await page.waitForFunction(() => [...document.querySelectorAll('.dependency-children')].every(list => {
      const svg = list.parentElement.querySelector(':scope > .dependency-connector');
      const last = list.lastElementChild;
      return Number(svg.getAttribute('height')) === last.offsetTop + 30;
    }));
    const geometry = await page.locator('.dependency-connector').evaluateAll(nodes => nodes.map(svg => ({
      trunks: svg.querySelectorAll('.dependency-trunk').length,
      path: svg.querySelector('.dependency-trunk').getAttribute('d'),
      left: svg.getBoundingClientRect().left - svg.closest('.pr-group').getBoundingClientRect().left,
    })));
    assert.equal(geometry.length, 2);
    for (const item of geometry) {
      assert.equal(item.trunks, 1);
      assert.equal((item.path.match(/V/g) ?? []).length, 1);
      assert.ok(item.left >= 5);
    }
    await page.locator('.pr-group').screenshot({ path: `/tmp/gh-pull-dependencies/zoom-${zoom}.png` });
  }
  await page.locator('.pr-group > summary').click();
  await page.locator('.dependency-trunk').first().waitFor({ state: 'hidden' });
  await page.locator('.pr-group > summary').click();
  await page.locator('.dependency-trunk').first().waitFor();
  assert.equal(await page.locator('.dependency-trunk').count(), 2);
  assert.deepEqual(errors, []);
});
