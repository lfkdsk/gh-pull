import test from 'node:test';
import assert from 'node:assert/strict';
import { browserFixture } from './browser-fixture.mjs';

test('returning to the dashboard checks for a newly published extension release', async t => {
  const { page, origin, errors } = await browserFixture(t, {
    list: async () => ({ viewer: 'alice', items: [], total: 0, pageInfo: { hasNextPage: false } }),
    localControl: { version: 'v1.2.0' },
  });
  let update = null;
  await page.route('**/api/updates', route => route.fulfill({ json: { update } }));
  await page.goto(origin);
  await page.locator('#deployed-version').waitFor();
  assert.equal(await page.locator('#update-notice').isVisible(), false);
  update = { version: 'v1.3.0', url: 'https://github.com/shiqicao/gh-pull/releases/tag/v1.3.0' };
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.locator('#update-notice').waitFor();
  assert.equal(await page.locator('#update-release').textContent(), 'gh-pull v1.3.0');
  assert.deepEqual(errors, []);
});
