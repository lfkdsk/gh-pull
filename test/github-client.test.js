import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraphQLClient } from '../github-client.js';

test('GraphQL clients isolate credentials, cache locally, and reacquire after rejection', async () => {
  let tokens = 0, reject = false;
  const headers = [];
  const graphql = createGraphQLClient({
    getToken: async () => `token-${++tokens}`, authError: 'Sign in again.',
    fetchImpl: async (url, options) => {
      headers.push(options.headers.Authorization);
      assert.deepEqual(JSON.parse(options.body), { query: 'query fixture', variables: { id: 'one' } });
      return reject ? new Response('', { status: 401 }) : Response.json({ data: { ok: true } });
    },
  });
  await graphql('query fixture', { id: 'one' });
  await graphql('query fixture', { id: 'one' });
  reject = true;
  await assert.rejects(graphql('query fixture', { id: 'one' }), { status: 401, message: 'Sign in again.' });
  reject = false;
  assert.deepEqual(await graphql('query fixture', { id: 'one' }), { ok: true });
  assert.deepEqual(headers, ['Bearer token-1', 'Bearer token-1', 'Bearer token-1', 'Bearer token-2']);
});

test('hosted GraphQL clients obtain current session credentials on every request', async () => {
  let token = 'alice';
  const headers = [];
  const graphql = createGraphQLClient({ cacheToken: false, getToken: async () => token,
    fetchImpl: async (url, options) => { headers.push(options.headers.Authorization); return Response.json({ data: {} }); },
  });
  await graphql('query fixture', {});
  token = 'rotated-alice'; await graphql('query fixture', {});
  const other = createGraphQLClient({ getToken: async () => 'bob', fetchImpl: async (url, options) => {
    headers.push(options.headers.Authorization); return Response.json({ data: {} });
  } });
  await other('query fixture', {}); await graphql('query fixture', {});
  assert.deepEqual(headers, ['Bearer alice', 'Bearer rotated-alice', 'Bearer bob', 'Bearer rotated-alice']);
});

test('rate limits honor Retry-After and prevent additional requests across callers', async () => {
  let calls = 0;
  const graphql = createGraphQLClient({ getToken: async () => 'fixture', fetchImpl: async () => {
    calls++;
    return new Response('', { status: 429, headers: { 'Retry-After': '120' } });
  } });
  await assert.rejects(graphql('query', {}), error => error.status === 429 && error.retryAfter >= 119);
  await assert.rejects(graphql('other query', {}), { status: 429 });
  assert.equal(calls, 1);
});

test('GraphQL rate limit errors and exhausted successful responses share reset cooldowns', async () => {
  for (const errors of [undefined, [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }]]) {
    let calls = 0;
    const graphql = createGraphQLClient({ getToken: async () => 'fixture', fetchImpl: async () => {
      calls++;
      return Response.json({ data: { ok: true }, errors }, { headers: {
        'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 600),
      } });
    } });
    if (errors) await assert.rejects(graphql('query', {}), { status: 429 });
    else assert.deepEqual(await graphql('query', {}), { ok: true });
    await assert.rejects(graphql('query', {}), error => error.status === 429 && error.retryAfter >= 599);
    assert.equal(calls, 1);
  }
});
