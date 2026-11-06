"use strict";
// Server-side retrieval of user-configured *public HTTPS* addon manifests.
// Resolve DNS before requesting and pin the validated IPv4 address to avoid
// SSRF to localhost/private Docker networks, link-local or cloud metadata.
const axios = require("axios");
const dns = require("node:dns").promises;
const https = require("node:https");
const net = require("node:net");

// Conservative IANA special-use IPv4 ranges, checked once per process.
// Blocking all reserved/documentation/benchmark ranges avoids a malicious
// addon host using DNS to point at an internal or unroutable endpoint.
const deniedIPv4 = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
]) deniedIPv4.addSubnet(network, prefix, "ipv4");

function isPublicIPv4(value) {
  return net.isIP(value) === 4 && !deniedIPv4.check(value, "ipv4");
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
  const records = await dns.lookup(hostname, { all: true, family: 4 });
  if (!records.length || records.some(r => r.family !== 4 || !isPublicIPv4(r.address))) {
    throw new Error("External addon hostname did not resolve to public IPv4");
  }
  const pinnedIp = records[0].address;
  const agent = new https.Agent({
    keepAlive: false,
    lookup(_hostname, options, callback) {
      // Node 20+ may request all:true and then expects a DNS record array.
      // Returning a bare IP in that mode raises ERR_INVALID_IP_ADDRESS.
      if (typeof options === "function") {
        callback = options;
        options = {};
      }
      if (options && options.all === true) {
        callback(null, [{ address: pinnedIp, family: 4 }]);
      } else {
        callback(null, pinnedIp, 4);
      }
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
