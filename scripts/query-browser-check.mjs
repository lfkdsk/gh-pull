import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { browserFixture } from './browser-fixture.mjs';
import { ApiError } from '../github.js';
import { DEFAULT_QUERY } from '../public/query.js';
import AxeBuilder from '@axe-core/playwright';

const pulls = [
  { id: 'one', number: 12, title: 'Improve keyboard navigation', repo: 'example/dashboard', author: 'alice', labels: ['good first issue', 'accessibility'], comments: 12 },
  { id: 'two', number: 13, title: 'Keep search results visible while refreshing', repo: 'example/dashboard', author: 'bob', labels: ['bug'], comments: 3 },
  { id: 'three', number: 8, title: 'Document the new query API', repo: 'example/sdk', author: 'carol', labels: ['docs'], comments: 0 },
].map((pr, index) => ({ ...pr,
  url: `https://github.com/${pr.repo}/pull/${pr.number}`, status: 'OPEN', branch: 'feature/query-search',
  createdAt: `2026-01-0${index + 1}T00:00:00Z`, updatedAt: `2026-01-0${index + 1}T01:00:00Z`,
  additions: 520, deletions: 148, commentCount: pr.comments, review: 'NONE',
  checks: 'SUCCESS', reviewers: [{ name: 'dave', state: 'APPROVED' }], canMerge: false,
}));

async function fixture(t, options = {}) {
  const calls = [];
  let fail = false, hold, release;
  const list = async args => {
    calls.push(args);
    if (hold) await hold;
    if (fail) throw new ApiError('GitHub: Search is temporarily unavailable.', 503);
    let items = args.cursor ? [pulls[1], pulls[2]] : pulls.slice(0, 2);
    if (args.query.includes('no-results')) items = [];
    return { viewer: 'alice', total: items.length ? 3 : 0, items, limited: false,
      pageInfo: { hasNextPage: items.length > 0 && !args.cursor, endCursor: args.cursor ? null : 'page2' } };
  };
  list.mergeReadiness = async () => ({ items: [] });
  const f = await browserFixture(t, { list, ...options });
  t.after(() => release?.());
  const { page, origin } = f;
  const editor = page.locator('.cm-content');
  const open = async (query = DEFAULT_QUERY) => {
    await page.goto(`${origin}/?${new URLSearchParams({ q: query })}`);
    await editor.waitFor();
    if (!query.includes('"unfinished')) await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  };
  const submit = async value => {
    await editor.fill(value);
    await page.click('#query-submit');
    await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  };
  return { ...f, editor, open, submit, calls,
    fail: value => { fail = value; },
    hold: () => { hold = new Promise(resolve => { release = resolve; }); },
    release: () => { release?.(); hold = null; },
  };
}

test('query presets, server search, grouping, custom values, reset and shareable URLs', async t => {
  const { page, editor, open, submit, calls, errors, origin } = await fixture(t);
  await open();
  assert.equal(await editor.innerText(), DEFAULT_QUERY);
  assert.equal(await page.locator('#scope').inputValue(), 'involved');
  const firstCalls = calls.length;
  await editor.fill('is:pr repo:example/dashboard author:alice label:"good first issue" sort:comments-desc');
  assert.equal(calls.length, firstCalls);
  assert.equal(await page.locator('#scope').inputValue(), 'custom');
  assert.equal(await page.locator('#state').inputValue(), 'all');
  assert.equal(await page.locator('#sort').inputValue(), 'custom');
  assert.match(await page.locator('#query-feedback').textContent(), /press Enter/);
  await page.click('#query-submit');
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.ok(calls.at(-1).query.includes('label:"good first issue"'));
  for (const [id, value, expected] of [['scope', 'review', 'review-requested:@me'], ['state', 'closed', 'is:closed is:unmerged'], ['sort', 'oldest', 'sort:created-asc']]) {
    await page.selectOption(`#${id}`, value);
    await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
    assert.ok(calls.at(-1).query.includes(expected));
    await page.selectOption(`#${id}`, value);
    await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
    assert.equal(await page.locator(`#${id}`).inputValue(), value);
  }
  assert.ok(calls.at(-1).query.includes('repo:example/dashboard'));
  assert.ok(!calls.at(-1).query.includes('author:alice'));
  const beforeGroup = calls.length;
  await page.selectOption('#group', 'none');
  assert.equal(calls.length, beforeGroup);
  assert.deepEqual(await page.locator('.pr-row').evaluateAll(rows => rows.map(row => row.dataset.prId)), ['one', 'two']);
  const shared = page.url();
  await page.goto(shared);
  await page.locator('.pr-row').first().waitFor();
  assert.equal(await page.locator('#group').inputValue(), 'none');
  assert.equal(await page.locator('#scope').inputValue(), 'review');
  assert.equal(new URL(shared).searchParams.get('q'), await editor.innerText());
  await submit('no-results');
  await page.locator('.empty').waitFor();
  assert.equal(calls.at(-1).query, 'is:pr no-results');
  await page.click('#query-reset');
  await page.locator('.pr-row').first().waitFor();
  assert.equal(await editor.innerText(), DEFAULT_QUERY);
  await page.goto(`${origin}/?scope=authored&state=all&sort=oldest&search=keyboard`);
  await page.locator('.pr-row').first().waitFor();
  assert.match(await editor.innerText(), /author:@me/);
  assert.match(calls.at(-1).query, /keyboard/);
  assert.deepEqual(errors, []);
});

test('autocomplete keyboard, mid-query replacements, escaped input, undo and focus', async t => {
  const { page, editor, open, calls, errors } = await fixture(t);
  await open();
  const before = calls.length;
  await editor.fill('is:pr ');
  await editor.press('End');
  await page.keyboard.type('rep');
  await page.locator('.cm-tooltip-autocomplete').waitFor();
  await editor.press('Enter');
  assert.equal(await editor.innerText(), 'is:pr repo:');
  assert.equal(calls.length, before);
  await editor.press('Control+Space');
  await page.getByRole('option', { name: 'example/dashboard', exact: true }).waitFor();
  await editor.press('Tab');
  assert.equal(await editor.innerText(), 'is:pr repo:example/dashboard');
  await editor.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.equal(calls.at(-1).query, 'is:pr repo:example/dashboard');

  await editor.fill('is:pr repo:ex label:bug');
  await editor.press('Home');
  for (let i = 0; i < 'is:pr repo:ex'.length; i++) await editor.press('ArrowRight');
  await editor.press('Control+Space');
  await page.getByRole('option', { name: 'example/dashboard', exact: true }).click();
  assert.equal(await editor.innerText(), 'is:pr repo:example/dashboard label:bug');

  await editor.fill('is:pr label:');
  await editor.press('End'); await editor.press('Control+Space');
  await page.getByRole('option', { name: '"good first issue"', exact: true }).click();
  assert.equal(await editor.innerText(), 'is:pr label:"good first issue"');
  await editor.press('Control+z');
  assert.equal(await editor.innerText(), 'is:pr label:');
  await editor.press('Control+y');
  assert.equal(await editor.innerText(), 'is:pr label:"good first issue"');
  await editor.fill('is:pr author:'); await editor.press('End'); await editor.press('Control+Space');
  await page.locator('.cm-tooltip-autocomplete').waitFor();
  await editor.press('ArrowDown');
  await editor.press('Escape');
  assert.equal(await page.locator('.cm-tooltip-autocomplete').count(), 0);
  assert.equal(await editor.innerText(), 'is:pr author:');
  await editor.fill('is:pr'); await editor.press('Escape'); await editor.press('Tab');
  assert.equal(await page.locator('#query-submit').evaluate(node => document.activeElement === node), true);
  await editor.fill('is:pr\nrepo:example/dashboard');
  assert.equal(await editor.innerText(), 'is:pr repo:example/dashboard');
  assert.equal(await page.locator('.query-value').count() > 0, true);
  assert.deepEqual(errors, []);
});

test('invalid drafts are local, failed searches can retry, pagination preserves query and refresh preserves drafts', async t => {
  const f = await fixture(t), { page, editor, calls } = f;
  await page.clock.install();
  await f.open();
  const before = calls.length;
  await editor.fill('label:"unfinished');
  assert.equal(await page.locator('#query-submit').isDisabled(), true);
  assert.match(await page.locator('#query-feedback').textContent(), /quotation/);
  await editor.press('Enter');
  assert.equal(calls.length, before);
  f.hold();
  await page.clock.fastForward(61_000);
  await page.waitForFunction(() => document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('.pr-row').count(), 2);
  f.release();
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.equal(calls.at(-1).query, DEFAULT_QUERY);
  assert.equal(await editor.innerText(), 'label:"unfinished');
  assert.equal(new URL(page.url()).searchParams.get('q'), DEFAULT_QUERY);

  f.fail(true);
  await f.submit('is:pr repo:example/sdk');
  await page.locator('#error').waitFor();
  assert.match(await page.locator('#error').textContent(), /Search is temporarily unavailable/);
  f.fail(false); await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.locator('.pr-row').first().waitFor();
  await page.click('#more');
  await page.waitForFunction(() => document.querySelectorAll('.pr-row').length === 3);
  assert.deepEqual(calls.at(-1), { query: 'is:pr repo:example/sdk', cursor: 'page2' });
  assert.equal(await page.locator('#more').isVisible(), false);
  await editor.fill('is:pr author:unsubmitted');
  await page.click('#refresh'); await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.deepEqual(calls.at(-1), { query: 'is:pr repo:example/sdk', cursor: null });
  assert.equal(await editor.innerText(), 'is:pr author:unsubmitted');
  assert.deepEqual(f.errors, []);
});

test('late search responses cannot replace newer results', async t => {
  const { page, editor, open, submit, origin, errors } = await fixture(t);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  await page.route(`${origin}/api/pulls?*`, async route => {
    if (!new URL(route.request().url()).searchParams.get('q')?.includes('repo:slow/repo')) return route.continue();
    await held;
    await route.fulfill({ json: { viewer: 'alice', total: 1, items: [{ ...pulls[0], title: 'STALE RESPONSE' }], pageInfo: { hasNextPage: false } } }).catch(() => {});
  });
  await open();
  await editor.fill('is:pr repo:slow/repo'); await page.click('#query-submit');
  await submit('is:pr repo:fast/repo');
  release();
  // A full refresh after release also verifies the applied query stayed current.
  await page.click('#refresh'); await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.equal(await page.getByText('STALE RESPONSE').count(), 0);
  assert.equal(await editor.innerText(), 'is:pr repo:fast/repo');
  assert.deepEqual(errors, []);
});

test('editor and suggestions fit mobile and desktop in light and dark themes', async t => {
  const { page, editor, open, errors } = await fixture(t);
  await open();
  const dir = process.env.BROWSER_ARTIFACT_DIR || '/tmp/gh-pull-query-browser';
  await mkdir(dir, { recursive: true });
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1440, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await editor.fill('is:pr is:open involves:@me repo:example/dashboard label:"good first issue" r');
      await editor.press('End'); await editor.press('Control+Space');
      await page.locator('.cm-tooltip-autocomplete').waitFor();
      const rect = await page.locator('.cm-tooltip-autocomplete').boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= width, JSON.stringify({ width, rect }));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const bg = await page.locator('.cm-tooltip-autocomplete').evaluate(node => getComputedStyle(node).backgroundColor);
      assert.equal(bg, colorScheme === 'dark' ? 'rgb(22, 27, 34)' : 'rgb(255, 255, 255)');
      await page.screenshot({ path: `${dir}/query-${colorScheme}-${width}.png`, fullPage: true });
      await editor.press('Escape');
    }
  }
  assert.deepEqual(errors, []);
});

test('query controls and suggestions have accessible names, roles, contrast and invalid state', async t => {
  const { page, editor, open, errors } = await fixture(t);
  await open();
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await editor.fill('is:pr re'); await editor.press('End'); await editor.press('Control+Space');
    await page.locator('.cm-tooltip-autocomplete').waitFor();
    const result = await new AxeBuilder({ page }).include('#filters').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    assert.deepEqual(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), []);
    await editor.press('Escape');
  }
  await editor.fill('label:"unfinished');
  assert.equal(await editor.getAttribute('aria-invalid'), 'true');
  await editor.fill('is:pr');
  assert.equal(await editor.getAttribute('aria-invalid'), 'false');
  assert.deepEqual(errors, []);
});

test('hosted login skips the editor bundle and an invalid bookmarked query can be corrected', async t => {
  const f = await fixture(t), { page, origin, editor, calls } = f;
  const bundles = [];
  page.on('request', request => { if (request.url().endsWith('/query-editor.js')) bundles.push(request.url()); });
  await page.route(`${origin}/api/session`, route => route.fulfill({ json: { mode: 'github-app', authenticated: false } }));
  await page.goto(origin);
  await page.getByRole('link', { name: 'Sign in with GitHub' }).waitFor();
  assert.deepEqual(bundles, []);
  assert.equal(await page.locator('#dashboard').isVisible(), false);
  await page.unroute(`${origin}/api/session`);
  await page.goto(`${origin}/?${new URLSearchParams({ q: 'label:"unfinished' })}`);
  await editor.waitFor();
  assert.equal(calls.length, 0);
  assert.match(await page.locator('#summary').textContent(), /valid query/);
  await f.submit('is:pr');
  await page.locator('.pr-row').first().waitFor();
  assert.equal(calls.at(-1).query, 'is:pr');
  assert.deepEqual(f.errors, []);
});
