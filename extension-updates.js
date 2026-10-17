const CHECK_INTERVAL = 5 * 60 * 1000;

function releaseParts(tag) {
  const match = typeof tag === 'string' && /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  return match ? match.slice(1).map(BigInt) : null;
}

export function createUpdateCheck(version, { fetchImpl = fetch, now = Date.now } = {}) {
  const current = releaseParts(version);
  let cached = null, nextCheck = 0, pending;
  return async function checkUpdate() {
    if (!current) return null;
    if (pending) return pending;
    if (now() < nextCheck) return cached;
    pending = (async () => {
      try {
        const response = await fetchImpl('https://api.github.com/repos/shiqicao/gh-pull/releases/latest', {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'gh-pull' },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) return cached;
        const release = await response.json();
        const latest = releaseParts(release.tag_name);
        const differing = latest?.findIndex((part, index) => part !== current[index]);
        cached = !release.draft && !release.prerelease && latest && differing >= 0 && latest[differing] > current[differing]
          ? { version: release.tag_name, url: `https://github.com/shiqicao/gh-pull/releases/tag/${encodeURIComponent(release.tag_name)}` }
          : null;
        return cached;
      } catch { return cached; }
      finally { nextCheck = now() + CHECK_INTERVAL; }
    })();
    try { return await pending; }
    finally { pending = null; }
  };
}
