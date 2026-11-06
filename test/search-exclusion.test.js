"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { applySearchExclusion, ROBOTS_TXT, SEARCH_EXCLUSION } =
  require("../utils/search-exclusion");

test("legacy addon marks all responses noindex and disallows referrer leakage", () => {
  const headers = {};
  let reached = false;
  applySearchExclusion({}, {
    setHeader(name, value) { headers[name.toLowerCase()] = value; }
  }, () => { reached = true; });
  assert.equal(reached, true);
  assert.equal(headers["x-robots-tag"], SEARCH_EXCLUSION);
  assert.match(headers["x-robots-tag"], /noimageindex/);
  assert.equal(headers["referrer-policy"], "no-referrer");
});

test("crawler access stays enabled so noindex can be observed", () => {
  assert.match(ROBOTS_TXT, /^User-agent: \*/);
  assert.match(ROBOTS_TXT, /^Allow: \/$/m);
  assert.doesNotMatch(ROBOTS_TXT, /Disallow:/i);
});

test("legacy configuration HTML has both robots and googlebot noindex", () => {
  const html = fs.readFileSync(path.join(__dirname, "../configure.html"), "utf8");
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex">/);
  assert.match(html, /<meta name="googlebot" content="noindex, nofollow, noarchive, nosnippet, noimageindex">/);
});
