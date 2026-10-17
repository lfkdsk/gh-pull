import test from 'node:test';
import assert from 'node:assert/strict';
import { repositoryScope } from '../public/query.js';
import { createGitHub } from '../github.js';
import { createApp } from '../server.js';

test('repository scope ignores narrowing filters and incomplete values but preserves people', () => {
  assert.equal(repositoryScope('is:open sort:updated-desc involves:@me repo:shinamicorp/nyx repo:'), 'involves:@me');
  assert.equal(repositoryScope('author:Alice review-requested:bob -commenter:bot label:bug'), '-commenter:bot author:alice review-requested:bob');
  assert.equal(repositoryScope('repo:foo/bar author: is:closed'), 'involves:@me');
  assert.equal(repositoryScope('-author:bot'), '-author:bot involves:@me');
  assert.throws(() => repositoryScope('a'.repeat(2001)));
});

test('repository discovery paginates lightweight PR results and deduplicates repositories', async () => {
  const calls = [];
  const list = createGitHub({ getToken: async () => 'test', fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body); calls.push(request);
    const second = request.variables.cursor === 'next';
    return Response.json({ data: { search: { issueCount: 101,
      pageInfo: { hasNextPage: !second, endCursor: second ? null : 'next' },
      nodes: [null, ... (second ? ['team/other', 'team/current'] : ['team/current']).map(nameWithOwner => ({ repository: { nameWithOwner } }))],
    } } });
  } });
  assert.deepEqual(await list.repositories('is:open author:alice repo:team/current'), {
    repositories: ['team/current', 'team/other'], limited: false, source: 'scope',
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].variables.query, 'is:pr author:alice sort:updated-desc');
  assert.doesNotMatch(calls[0].query, /mergeable|reviewThreads|commits/);
});

test('empty scope results fall back to me and then accessible repositories', async () => {
  const calls = [];
  const list = createGitHub({ getToken: async () => 'test', fetchImpl: async (url, options) => {
    const { query, variables } = JSON.parse(options.body); calls.push(variables.query ?? 'viewer');
    if (query.includes('ViewerRepositorySuggestions')) return Response.json({ data: { viewer: { repositories: {
      pageInfo: { hasNextPage: false }, nodes: [{ nameWithOwner: 'alice/new-repo' }],
    } } } });
    return Response.json({ data: { search: { issueCount: 0, pageInfo: { hasNextPage: false }, nodes: [] } } });
  } });
  assert.deepEqual(await list.repositories('review-requested:other'), { repositories: ['alice/new-repo'], limited: false, source: 'me' });
  assert.deepEqual(calls, ['is:pr review-requested:other sort:updated-desc', 'is:pr involves:@me sort:updated-desc', 'viewer']);
});

test('repository search reports the GitHub search limit instead of claiming completeness', async () => {
  let calls = 0;
  const list = createGitHub({ getToken: async () => 'test', fetchImpl: async () => {
    calls++;
    return Response.json({ data: { search: { issueCount: 2000, pageInfo: { hasNextPage: true, endCursor: String(calls) }, nodes: [{ repository: { nameWithOwner: 'team/repo' } }] } } });
  } });
  const result = await list.repositories('');
  assert.equal(result.limited, true);
  assert.equal(calls, 10);
});

test('repository endpoint caches by people scope, not the selected repository', async t => {
  const calls = [];
  const list = async () => ({ items: [] });
  list.repositories = async scope => { calls.push(scope); return { repositories: ['team/one', 'team/two'], limited: false }; };
  const server = createApp({ list });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const endpoint = `http://127.0.0.1:${server.address().port}/api/repositories`;
  for (const q of ['involves:@me repo:team/one', 'is:open involves:@me repo:', 'author:alice']) {
    const response = await fetch(`${endpoint}?${new URLSearchParams({ q })}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).repositories.length, 2);
  }
  assert.deepEqual(calls, ['involves:@me', 'author:alice']);
  assert.equal((await fetch(`${endpoint}?q=${'x'.repeat(2001)}`)).status, 400);
});
