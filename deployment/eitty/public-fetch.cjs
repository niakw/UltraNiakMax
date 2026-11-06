"use strict";
// Server-side retrieval of user-configured *public HTTPS* addon manifests.
// Resolve DNS before requesting and pin the validated IPv4 address to avoid
// SSRF to localhost/private Docker networks, link-local or cloud metadata.
const axios = require("axios");
const dns = require("node:dns").promises;
const https = require("node:https");
const net = require("node:net");

function isPublicIPv4(value) {
  if (net.isIP(value) !== 4) return false;
  const [a, b, c] = value.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) ||
    (b === 88 && c === 99))) return false;
  if (a === 198 && ((b === 18 || b === 19) || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function validateTarget(input) {
  if (typeof input !== "string" || input.length > 4096) {
    throw new Error("Invalid external addon URL");
  }
  const url = new URL(input);
  if (url.protocol !== "https:" || (url.port && url.port !== "443") ||
      url.username || url.password || url.hash) {
    throw new Error("Only public HTTPS addon URLs without credentials are supported");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (net.isIP(hostname) || hostname === "localhost" ||
      hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
      hostname.endsWith(".internal") || hostname.endsWith(".lan") ||
      hostname.endsWith(".test") || hostname.endsWith(".invalid") ||
      hostname.endsWith(".home.arpa") || hostname.endsWith(".onion") ||
      hostname.endsWith(".localdomain")) {
    throw new Error("Non-public addon hostname rejected");
  }
  return { url, hostname };
}

async function fetchPublicHttps(input, { signal, headers = {}, timeout = 10000,
  maxBytes = 4 * 1024 * 1024 } = {}) {
  const { url, hostname } = validateTarget(input);
  const records = await dns.lookup(hostname, { all: true });
  if (!records.length || records.some(r => r.family !== 4 || !isPublicIPv4(r.address))) {
    throw new Error("External addon hostname did not resolve to public IPv4 only");
  }
  const pinnedIp = records[0].address;
  const agent = new https.Agent({
    keepAlive: false,
    lookup(_hostname, _options, callback) {
      callback(null, pinnedIp, 4);
    }
  });
  try {
    const res = await axios.get(url.toString(), {
      signal, timeout, headers, httpsAgent: agent,
      proxy: false, maxRedirects: 0, maxContentLength: maxBytes,
      responseType: "text", validateStatus: () => true
    });
    const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      text: async () => body,
      json: async () => JSON.parse(body)
    };
  } finally {
    agent.destroy();
  }
}

module.exports = { fetchPublicHttps, validateTarget, isPublicIPv4 };
