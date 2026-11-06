"use strict";
// Server-side retrieval of user-configured *public HTTPS* addon manifests.
// Resolve DNS before requesting and pin the validated IPv4 address to avoid
// SSRF to localhost/private Docker networks, link-local or cloud metadata.
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
  if (hostname.startsWith("[") || hostname.includes(":") ||
      net.isIP(hostname) || hostname === "localhost" ||
      hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
      hostname.endsWith(".internal") || hostname.endsWith(".lan") ||
      hostname.endsWith(".test") || hostname.endsWith(".invalid") ||
      hostname.endsWith(".home.arpa") || hostname.endsWith(".onion") ||
      hostname.endsWith(".localdomain")) {
    throw new Error("Non-public addon hostname rejected");
  }
  return { url, hostname };
}

// Connect directly to a resolved and validated *public* IPv4 endpoint.
// The untrusted URL supplies only a path and the TLS identity; it never
// determines a second DNS lookup, a proxy hop or a redirect destination.
async function fetchPublicHttps(input, { signal, headers = {}, timeout = 10000,
  maxBytes = 4 * 1024 * 1024 } = {}) {
  const {url, hostname}=validateTarget(input);
  if (!Number.isSafeInteger(maxBytes) || maxBytes<1 || maxBytes>16*1024*1024 ||
      !Number.isSafeInteger(timeout) || timeout<250 || timeout>30000) {
    throw new Error("Invalid external fetch limits");
  }
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  const onAbort=()=>controller.abort();
  signal?.addEventListener("abort",onAbort,{once:true});
  if(signal?.aborted) controller.abort();
  try {
    const records=await Promise.race([
      dns.lookup(hostname,{all:true,family:4}),
      new Promise((_,reject)=>controller.signal.addEventListener("abort",
        ()=>reject(new Error("External addon lookup timed out")),{once:true}))
    ]);
    if (!records.length || records.some(r=>r.family!==4 || !isPublicIPv4(r.address))) {
      throw new Error("External addon hostname did not resolve to public IPv4");
    }
    const pinnedIp=records[0].address;
    // Native HTTPS does not follow redirects, respects TLS verification and
    // keeps DNS and proxy selection outside the request. Host/SNI remain the
    // original validated domain while the socket goes to the pinned IPv4.
    const pathAndQuery=url.pathname+url.search;
    return await new Promise((resolve,reject)=>{
      const request=https.request({
        protocol:"https:",hostname:pinnedIp,port:443,method:"GET",
        servername:hostname,headers:{...headers,Host:hostname,"Accept-Encoding":"identity"},
        rejectUnauthorized:true,agent:false,timeout,signal:controller.signal,
        path:pathAndQuery
      }, response=>{
        const status=response.statusCode || 0;
        const encoding=String(response.headers["content-encoding"]||"identity").toLowerCase();
        const declared=Number(response.headers["content-length"]||0);
        if (encoding!=="identity" || declared>maxBytes) {
          response.destroy(new Error("External addon response encoding or size rejected"));
          return;
        }
        const chunks=[];let count=0;
        response.on("data",chunk=>{
          count+=chunk.length;
          if(count>maxBytes) {
            response.destroy(new Error("External addon response exceeds size limit"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error",reject);
        response.on("end",()=>{
          const body=Buffer.concat(chunks,count).toString("utf8");
          resolve({
            status,
            ok:status>=200&&status<300,
            text:async()=>body,
            json:async()=>JSON.parse(body)
          });
        });
      });
      request.on("timeout",()=>request.destroy(new Error("External addon request timed out")));
      request.on("error",reject);
      request.end();
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort",onAbort);
  }
}

module.exports = { fetchPublicHttps, validateTarget, isPublicIPv4 };
