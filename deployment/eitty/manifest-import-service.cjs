"use strict";
// Privacy-preserving import of a user's existing Stremio/Nuvio manifest.
// This endpoint does not retain the source URL/token or return arbitrary fields.
const { fetchPublicHttps, validateTarget } = require("../utils/public-fetch");

const TYPES = new Set(["movie", "series", "tv"]);
function normalizeManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
      !Array.isArray(manifest.catalogs)) {
    throw new Error("This URL does not return a Stremio/Nuvio manifest with catalogs.");
  }
  if (manifest.catalogs.length > 700) {
    throw new Error("Manifest has too many catalogs.");
  }
  const seen = new Set();
  const catalogs = [];
  for (const entry of manifest.catalogs) {
    if (!entry || typeof entry !== "object") continue;
    const id = String(entry.id || "").trim();
    const type = String(entry.type || "").trim();
    if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(id) || !TYPES.has(type)) continue;
    const key = type + ":" + id;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = String(entry.name || id).trim().slice(0, 120);
    catalogs.push({ id, type, name });
  }
  if (!catalogs.length) throw new Error("The manifest contains no supported catalog entries.");
  return {
    format: "ultramax-manifest-preview-v1",
    name: String(manifest.name || "Imported addon").slice(0, 120),
    catalogs,
    total: manifest.catalogs.length,
    // Deliberately no URL, access token, provider secrets or arbitrary metadata.
    warning: "A manifest only describes the public addon contract. Private provider settings, credentials, collections and passwords cannot be recovered from it."
  };
}

function registerManifestImportRoutes(app, options = {}) {
  const fetchManifest = options.fetchPublicHttps || fetchPublicHttps;
  const attempts = new Map();
  app.post("/api/import-manifest", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const expectedOrigin = new URL(process.env.BASE_URL || "https://localhost").origin;
    const origin = String(req.get("origin") || "");
    const fetchSite = String(req.get("sec-fetch-site") || "");
    if ((origin && origin !== expectedOrigin) ||
        (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")) {
      return res.status(403).json({ error: "Same-origin requests only." });
    }

    const now = Date.now();
    const ip = String(req.ip || "unknown");
    if (attempts.size > 3000) {
      for (const [key, value] of attempts) {
        if (now - value.since >= 60000) attempts.delete(key);
      }
      if (attempts.size > 3000) attempts.clear();
    }
    const prev = attempts.get(ip);
    const current = prev && now - prev.since < 60000
      ? { since: prev.since, count: prev.count + 1 }
      : { since: now, count: 1 };
    attempts.set(ip, current);
    if (current.count > 6) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({ error: "Too many imports. Please retry shortly." });
    }

    try {
      const input = req.body && req.body.url;
      const { url } = validateTarget(input);
      if (!/\\/manifest\\.json$/i.test(url.pathname)) {
        return res.status(400).json({ error: "Enter a full HTTPS manifest.json URL." });
      }
      const upstream = await fetchManifest(url.toString(), {
        timeout: 9000,
        maxBytes: 256 * 1024,
        headers: { Accept: "application/json" }
      });
      if (!upstream.ok) {
        return res.status(502).json({ error: "The remote manifest is unavailable." });
      }
      const result = normalizeManifest(await upstream.json());
      return res.json(result);
    } catch (error) {
      // Do not echo tokens, full URLs, upstream bodies or network errors.
      const message = error && error.message || "";
      if (/^(Invalid external addon URL|Only public HTTPS|Non-public addon hostname|Enter a full HTTPS|This URL does not return|Manifest has too many|The manifest contains no supported)/.test(message)) {
        return res.status(400).json({ error: message });
      }
      return res.status(502).json({ error: "Manifest could not be retrieved or parsed. Check the link and try again." });
    }
  });
}
module.exports = { normalizeManifest, registerManifestImportRoutes };
