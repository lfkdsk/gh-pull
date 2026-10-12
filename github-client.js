import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export class ApiError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export function createGraphQLClient({ fetchImpl = fetch, getToken = defaultToken, cacheToken = true, authError = 'GitHub login expired. Run gh auth login, then retry.' } = {}) {
  let token;
  return async function graphql(query, variables) {
    if (!cacheToken || !token) token = await getToken();
    let response;
    try {
      response = await fetchImpl('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'gh-pull' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch { throw new ApiError('Could not reach GitHub. Check your connection and retry.'); }
    if (response.status === 401) {
      token = undefined;
      throw new ApiError(authError, 401);
    }
    if (response.status === 403 || response.status === 429) {
      throw new ApiError('GitHub denied the request or its rate limit was reached. Check your token permissions or retry later.', 429);
    }
    if (!response.ok) throw new ApiError(`GitHub returned HTTP ${response.status}. Retry shortly.`);
    const payload = await response.json();
    if (payload.errors?.length) throw new ApiError(`GitHub: ${payload.errors.map(error => error.message).join('; ')}`);
    return payload.data;
  };
}

export async function defaultToken() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  try {
    const { stdout } = await exec('gh', ['auth', 'token', '--hostname', 'github.com'], { timeout: 10_000 });
    if (stdout.trim()) return stdout.trim();
  } catch { /* Return actionable instructions without exposing CLI output. */ }
  throw new ApiError('Sign in with gh auth login, or set GH_TOKEN before starting the server, then retry.', 401);
}
