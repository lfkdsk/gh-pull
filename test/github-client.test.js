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
