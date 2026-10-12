// Cache promises as well as results: even forced refreshes join work in flight.
// Callers own the Map, keeping local and authenticated sessions isolated.
export async function cachedRequest(cache, key, fetchResult, { ttl = 30_000, force = false } = {}) {
  let entry = cache.get(key);
  if (!entry || (!entry.pending && (force || entry.expires <= Date.now()))) {
    entry = { pending: true, expires: Infinity };
    cache.set(key, entry);
    entry.result = Promise.resolve().then(fetchResult).then(result => {
      entry.pending = false;
      entry.expires = Date.now() + ttl;
      return result;
    }, error => {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    });
    if (cache.size > 100) {
      const oldest = [...cache].find(([, value]) => !value.pending);
      if (oldest) cache.delete(oldest[0]);
    }
  }
  return entry.result;
}
