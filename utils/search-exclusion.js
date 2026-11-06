"use strict";

// Search engine exclusion is not an access-control mechanism. Keep crawlable so
// bots can see noindex; do not publish profile URLs in links or sitemaps.
const SEARCH_EXCLUSION = "noindex, nofollow, noarchive, nosnippet, noimageindex";
const ROBOTS_TXT = "User-agent: *\nAllow: /\n";

function applySearchExclusion(_req, res, next) {
  res.setHeader("X-Robots-Tag", SEARCH_EXCLUSION);
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
}

module.exports = { applySearchExclusion, ROBOTS_TXT, SEARCH_EXCLUSION };
