import test from 'node:test';
import assert from 'node:assert/strict';
import { dependencyForest } from '../public/model.js';
const pr = (id, baseBranch = 'main', extra = {}) => ({ id, branch: id, baseBranch, repo: 'org/repo', branchRepository: 'org/repo', status: 'OPEN', ...extra });
const shape = nodes => nodes.map(n => [n.pr.id, shape(n.children)]);
test('orders parents before children and preserves sibling order from query', () => {
  assert.deepEqual(shape(dependencyForest([pr('C', 'B'), pr('B', 'A'), pr('D', 'A'), pr('A')])),
    [['A', [['B', [['C', []]]], ['D', []]]]]);
});
test('missing parents, forks, ambiguous heads and inactive PRs stay independent', () => {
  for (const extra of [{ branchRepository: 'fork/repo' }, { status: 'MERGED' }, { status: 'CLOSED' }, { branchRepository: null }]) {
    assert.equal(dependencyForest([pr('A', 'main', extra), pr('B', 'A')]).length, 2);
  }
  assert.equal(dependencyForest([pr('B', 'missing')]).length, 1);
  assert.equal(dependencyForest([pr('A'), pr('duplicate', 'main', { branch: 'A' }), pr('B', 'A')]).length, 3);
  assert.equal(dependencyForest([pr('A'), pr('B', 'A', { repo: 'other/repo' })]).length, 2);
});
test('drafts are connected; cycles and self references retain every PR exactly once', () => {
  assert.equal(dependencyForest([pr('A'), pr('B', 'A', { status: 'DRAFT' })])[0].children.length, 1);
  const forest = dependencyForest([pr('A', 'B'), pr('B', 'C'), pr('C', 'A'), pr('D', 'D')]);
  const ids = [];
  const visit = nodes => nodes.forEach(n => { ids.push(n.pr.id); visit(n.children); });
  visit(forest);
  assert.deepEqual(ids.sort(), ['A', 'B', 'C', 'D']);
});

test('API normalization preserves base branch and fork repository identity', async () => {
  const { normalizePullRequest } = await import('../pull-request.js');
  const normalized = normalizePullRequest({ id: 'x', headRefName: 'feature', baseRefName: 'parent',
    headRepository: { nameWithOwner: 'fork/repo' }, repository: { nameWithOwner: 'org/repo' },
    commits: { nodes: [] }, labels: { nodes: [] } });
  assert.equal(normalized.baseBranch, 'parent');
  assert.equal(normalized.branchRepository, 'fork/repo');
});
