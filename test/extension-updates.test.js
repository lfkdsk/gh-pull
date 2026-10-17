import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateCheck } from '../extension-updates.js';

test('only newer stable releases trigger updates, comparing numeric components', async () => {
  for (const [current, latest, expected] of [
    ['v1.9.0', 'v1.10.0', true], ['v1.10.0', 'v1.9.0', false],
    ['v1.0.0', 'v1.0.1', true], ['v1.9.9', 'v2.0.0', true],
    ['v2.0.0', 'v1.9.9', false], ['v1.0.0', 'v1.0.0', false],
    ['v1.0.0', 'v2.0.0-beta.1', false], ['v1.0.0', 'invalid', false],
  ]) {
    const check = createUpdateCheck(current, { fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: latest }) }) });
    assert.deepEqual(await check(), expected ? { version: latest, url: `https://github.com/shiqicao/gh-pull/releases/tag/${latest}` } : null);
  }
});

test('development and prerelease builds make no network requests', async () => {
  for (const version of [undefined, 'development', 'dev-abc1234', 'v1.0.0-beta.1']) {
    let calls = 0;
    const check = createUpdateCheck(version, { fetchImpl: async () => { calls++; } });
    assert.equal(await check(), null);
    assert.equal(calls, 0);
  }
});

test('concurrent tabs share requests and failures are cached for five minutes', async () => {
  let time = 1, calls = 0, fail = false;
  const check = createUpdateCheck('v1.0.0', {
    now: () => time,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.github.com/repos/shiqicao/gh-pull/releases/latest');
      assert.equal(options.headers.Authorization, undefined);
      if (fail) throw new Error('offline');
      return { ok: true, json: async () => ({ tag_name: 'v1.1.0' }) };
    },
  });
  const [first, second] = await Promise.all([check(), check()]);
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
  await check();
  assert.equal(calls, 1);
  time += 300000;
  fail = true;
  assert.deepEqual(await check(), first);
  await check();
  assert.equal(calls, 2);
});

test('unavailable, malformed, draft and prerelease responses do not trigger notices', async () => {
  for (const response of [
    { ok: false, status: 403 }, { ok: false, status: 404 }, { ok: false, status: 429 },
    { ok: true, json: async () => { throw new Error('invalid JSON'); } },
    { ok: true, json: async () => ({ tag_name: 'v2.0.0', draft: true }) },
    { ok: true, json: async () => ({ tag_name: 'v2.0.0', prerelease: true }) },
  ]) {
    let calls = 0;
    const check = createUpdateCheck('v1.0.0', { fetchImpl: async () => { calls++; return response; } });
    assert.equal(await check(), null);
    assert.equal(await check(), null);
    assert.equal(calls, 1);
  }
});

test('a newly published release is detected after five minutes', async () => {
  let time = 0, latest = 'v1.2.0', calls = 0;
  const check = createUpdateCheck('v1.2.0', {
    now: () => time,
    fetchImpl: async () => {
      calls++;
      return { ok: true, json: async () => ({ tag_name: latest }) };
    },
  });
  assert.equal(await check(), null);
  latest = 'v1.3.0';
  time = 299999;
  assert.equal(await check(), null);
  assert.equal(calls, 1);
  time = 300000;
  assert.equal((await check()).version, 'v1.3.0');
  assert.equal(calls, 2);
});
