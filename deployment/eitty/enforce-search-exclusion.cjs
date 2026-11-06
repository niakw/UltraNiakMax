"use strict";
/**
 * Fail-closed build-time index exclusion for *every* bundled HTML page.
 * Nginx X-Robots-Tag is the authoritative cross-content directive; the HTML
 * meta is an additional guard for static pages in embedded browsers.
 * No network, user profile, manifest, or credential access.
 */
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(process.argv[2] || "/src/web");
const policy = "noindex, nofollow, noarchive, nosnippet, noimageindex";
let protectedPages = 0;
let totalHtml = 0;

function visit(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const filepath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".")) visit(filepath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    totalHtml++;
    const html = fs.readFileSync(filepath, "utf8");
    const head = /<head(?:\s[^>]*)?>/i;
    if (!head.test(html)) {
      throw new Error("HTML file has no <head> for noindex: " + path.relative(root, filepath));
    }
    const existing = /<meta\b[^>]*\bname\s*=\s*["']robots["'][^>]*>/ig;
    const conflicts = [...html.matchAll(existing)];
    if (conflicts.length > 0) {
      throw new Error("Unexpected existing robots meta; review before replacing: " +
        path.relative(root, filepath));
    }
    const result = html.replace(head, match => match +
      "\n<meta name=\"robots\" content=\"" + policy + "\">\n" +
      "<meta name=\"googlebot\" content=\"" + policy + "\">");
    if (result === html || !result.includes('name="robots" content="' + policy + '"')) {
      throw new Error("Failed to protect HTML page: " + filepath);
    }
    fs.writeFileSync(filepath, result, "utf8");
    protectedPages++;
  }
}
visit(root);
if (protectedPages < 30 || protectedPages !== totalHtml) {
  throw new Error("Search exclusion incomplete (" + protectedPages + "/" + totalHtml + ")");
}
console.log("Search exclusion applied to all " + protectedPages +
  " bundled HTML pages. No HTML page is eligible for search indexing.");
