// Fictional PRs reproduce handoff scenarios 3a and 3b without GitHub mutations.
const base = { author: 'alice', status: 'OPEN', checks: 'SUCCESS', review: 'REVIEW_REQUIRED', reviewers: [], labels: [],
  additions: 42, deletions: 8, changedFiles: 4, commentCount: 2, defaultBranch: 'main', createdAt: '2026-10-01T00:00:00Z' };
const make = (repo, number, parent, title, minutes, state = 'review', extra = {}) => ({
  ...base, id: `${repo}-${number}`, number, title, repo, branchRepository: repo,
  branch: `feature-${number}`, baseBranch: parent ? `feature-${parent}` : 'main',
  url: `https://github.com/${repo}/pull/${number}`,
  updatedAt: new Date(Date.UTC(2026, 9, 14, 20) - minutes * 60_000).toISOString(),
  checks: state === 'running' ? 'PENDING' : state === 'failed' ? 'FAILURE' : 'SUCCESS',
  review: state === 'ready' ? 'APPROVED' : 'REVIEW_REQUIRED', ...extra,
});
export const scenario3a = [
  [495, null, 'Add the shared session API', 2880, 'ready'],
  [503, 495, 'Build the sign-in flow', 1440],
  [504, 503, 'Add structured session validation', 400, 'running'],
  [507, 504, 'Inline field conversion', 360],
  [509, 507, 'Remove redundant validation checks', 12, 'running'],
  [510, 504, 'Precompute session constants', 180, 'failed'],
  [506, 495, 'Add session audit events', 1440],
  [511, 495, 'Benchmark session handling in CI', 1440, 'ready'],
  [520, null, 'Update the troubleshooting guide', 120],
].map(args => make('example/lanes-3a', ...args));
export const scenario3b = [
  make('example/lanes-3b', 512, null, 'Add retry budget to RPC client', 2880, 'ready'),
  make('example/lanes-3b', 513, 512, 'Surface retry metrics', 1440),
  make('example/lanes-3b', 515, 513, 'Retry dashboard panel', 20, 'running'),
  make('example/lanes-3b', 514, 512, 'Configurable backoff', 1440),
  make('example/lanes-3b', 520, null, 'Update the troubleshooting guide', 120),
  make('example/lanes-3b', 516, 488, 'Pin deployment artifacts', 4320, 'review', {
    dependencyParent: { id: 'hidden-parent', number: 488, status: 'OPEN' },
  }),
  make('example/lanes-3b', 517, 516, 'Update deployment scripts', 300, 'running'),
  make('example/lanes-3b', 490, null, 'Migrate to the next runtime version', 5760),
];
