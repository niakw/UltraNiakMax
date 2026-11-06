const axios = require("axios");

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 1000;
const cache = new Map();
const pending = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return { found: false };
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return { found: false };
  }
  // Refresh insertion order for bounded LRU eviction without one timer per request.
  cache.delete(key);
  cache.set(key, entry);
  return { found: true, value: entry.value };
}

function storeCached(key, value) {
  cache.delete(key);
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  while (cache.size > MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

function cachedRequest(key, request) {
  const existing = getCached(key);
  if (existing.found) return Promise.resolve(existing.value);
  if (pending.has(key)) return pending.get(key);

  const task = Promise.resolve()
    .then(request)
    .then(value => {
      storeCached(key, value);
      return value;
    })
    .finally(() => pending.delete(key));

  pending.set(key, task);
  return task;
}

function fetchCached(url) {
  return cachedRequest(`http:${url}`, async () => {
    const response = await axios.get(url, { timeout: 5000 });
    return response.data;
  });
}

async function fetchTrakt(path, traktClientId) {
  if (!traktClientId) return [];

  const url = `https://api.trakt.tv${path}`;
  // Trakt responses may depend on client credentials. Never share their cache keys.
  const key = `trakt:${traktClientId}:${url}`;

  try {
    return await cachedRequest(key, async () => {
      const response = await axios.get(url, {
        timeout: 5000,
        headers: {
          "Content-Type": "application/json",
          "trakt-api-version": "2",
          "trakt-api-key": traktClientId
        }
      });
      return response.data;
    });
  } catch (error) {
    console.error("Trakt fetch error:", error.message);
    return [];
  }
}

module.exports = { fetchCached, fetchTrakt };
