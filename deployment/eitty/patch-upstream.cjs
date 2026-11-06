"use strict";
// Reproducible overlay. Source: https://github.com/niakw/ultra-max-addon
const fs = require("node:fs");
const path = require("node:path");
const PREFIX = "/projects-site/ultra-max";
const VALID_WEB_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".webmanifest"]);

function rewriteWebText(source) {
  // Root-relative frontend links, API calls, SPA routes, service worker assets.
  let result = source.replace(/(["'\x60])\/(?!\/|projects-site\/ultra-max(?:\/|["'\x60]))/g, (_, quote) => quote + PREFIX + "/");
  result = result.replace(/url\(\s*\/(?!\/|projects-site\/ultra-max\/)/gi, "url(" + PREFIX + "/");
  // No hosted-service tracking script.
  result = result.replace(/<script\b[^>]*\bsrc=["']https:\/\/umami-maxbase\.duckdns\.org\/[^"']*["'][^>]*>\s*<\/script>/gi, "");
  return result.replace(/\bcom\.ultramax\b/g, "com.niakw.ultramax");
}

function walk(directory, visit) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else if (entry.isFile()) visit(full);
  }
}

function apply(root) {
  const addon = path.join(root, "addon");
  const web = path.join(root, "web");
  if (!fs.existsSync(path.join(addon, "index.js")) ||
      !fs.existsSync(path.join(web, "setup.html"))) {
    throw new Error("Expected official UltraMax self-host source tree");
  }

  const seasonPaths = [
    path.join(addon, "services/meta-route-service.js"),
    path.join(addon, "services/meta-handler-service.js")
  ];
  for (const filepath of seasonPaths) {
    const before = fs.readFileSync(filepath, "utf8");
    const pattern = /\.filter\(\s*s\s*=>\s*s\.season_number\s*>\s*0\s*\)/g;
    if ((before.match(pattern) || []).length !== 1) {
      throw new Error("Season 0 patch no longer matches exactly once: " + filepath);
    }
    fs.writeFileSync(filepath, before.replace(pattern,
      ".filter(s => Number.isInteger(s?.season_number) && s.season_number >= 0)"), "utf8");
  }

  let webFiles = 0;
  walk(web, filepath => {
    if (!VALID_WEB_EXTENSIONS.has(path.extname(filepath).toLowerCase())) return;
    const original = fs.readFileSync(filepath, "utf8");
    const updated = rewriteWebText(original);
    if (updated !== original) fs.writeFileSync(filepath, updated, "utf8");
    webFiles += 1;
  });

  // The legacy configure page is also served dynamically by the addon.
  const legacyConfigure = path.join(addon, "configure.html");
  if (fs.existsSync(legacyConfigure)) {
    fs.writeFileSync(legacyConfigure,
      rewriteWebText(fs.readFileSync(legacyConfigure, "utf8")), "utf8");
  }

  // Never let user-supplied manifest URLs access Docker/private infrastructure.
  const publicFetchSource = path.join(__dirname, "public-fetch.cjs");
  if (!fs.existsSync(publicFetchSource)) throw new Error("Missing public-fetch.cjs");
  fs.writeFileSync(path.join(addon, "utils/public-fetch.js"),
    fs.readFileSync(publicFetchSource, "utf8"), "utf8");

  let addonFiles = 0;
  walk(addon, filepath => {
    if (!filepath.endsWith(".js")) return;
    const original = fs.readFileSync(filepath, "utf8");
    const updated = original
      .replace(/\bcom\.ultramax\b/g, "com.niakw.ultramax")
      .replace(/new URL\((["'\x60])\/auth\//g,
        (_, quote) => "new URL(" + quote + PREFIX + "/auth/");
    let final = updated;
    if (filepath.endsWith("/services/manifest-route-service.js")) {
      const hostCheck = 'if (url.hostname !== "ultramax.vip") return false;';
      if (!final.includes(hostCheck) || !final.includes("url.pathname.match(")) {
        throw new Error("Manifest URL matcher changed; review prefix support");
      }
      final = final.replace(hostCheck,
        'if (url.hostname !== "ultramax.vip" && url.origin !== new URL(process.env.BASE_URL).origin) return false;');
      final = final.replace("url.pathname.match(",
        'url.pathname.replace(/^\\/projects-site\\/ultra-max/, "").match(');
    }
    if (filepath.endsWith("/services/stream-wizard-service.js")) {
      const oldFetch = "await fetch(manifestUrl, {";
      if (!final.includes(oldFetch)) throw new Error("Stream wizard fetch signature changed");
      final = 'const { fetchPublicHttps } = require("../utils/public-fetch");\n' +
        final.replace(oldFetch, "await fetchPublicHttps(manifestUrl, {");
    }
    if (filepath.endsWith("/services/stream-bridge.js")) {
      const oldMeta = "const m = await fetchCached(manifestUrl);";
      const oldStreams = "await fetch(url, { signal: controller.signal })";
      if (!final.includes(oldMeta) || final.split(oldStreams).length !== 3) {
        throw new Error("Stream bridge fetch signatures changed");
      }
      final = 'const { fetchPublicHttps } = require("../utils/public-fetch");\n' +
        final.replace(oldMeta,
          "const remote = await fetchPublicHttps(manifestUrl);\n    const m = remote.ok ? await remote.json() : null;")
          .replaceAll(oldStreams,
            "await fetchPublicHttps(url, { signal: controller.signal })");
    }
    if (final !== original) fs.writeFileSync(filepath, final, "utf8");
    addonFiles += 1;
  });

  const index = fs.readFileSync(path.join(web, "index.html"), "utf8");
  const setup = fs.readFileSync(path.join(web, "setup.html"), "utf8");
  const handler = fs.readFileSync(seasonPaths[0], "utf8");
  if (!index.includes(PREFIX + "/setup.html") ||
      !setup.includes(PREFIX + "/setup-modules/") ||
      !handler.includes("season_number >= 0")) {
    throw new Error("Post-patch smoke assertions failed");
  }
  console.log("Ultra MAX Eitty overlay: Season 0 fixed; " +
    webFiles + " web files and " + addonFiles + " addon files inspected");
}

if (require.main === module) apply(path.resolve(process.argv[2] || "/src"));
module.exports = { apply, rewriteWebText, PREFIX };
