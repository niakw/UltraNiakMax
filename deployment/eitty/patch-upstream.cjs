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

  // Reproducible, privacy-preserving manifest import: both UI and API.
  const importFiles = [
    ["manifest-link-import.js", path.join(web, "setup-modules/manifest-link-import.js")],
    ["portable-profile-normalizer.js", path.join(web, "setup-modules/portable-profile-normalizer.js")],
    ["manifest-import-service.cjs", path.join(addon, "services/manifest-import-service.js")]
  ];
  for (const [name, destination] of importFiles) {
    const source = path.join(__dirname, name);
    if (!fs.existsSync(source)) throw new Error("Missing manifest import overlay: " + name);
    fs.copyFileSync(source, destination);
  }
  // The upstream JSON project import restores only a subset of portable
  // profiles; migrate all safe profile fields before it clears current state.
  const projectImporterPath = path.join(web, "setup-modules/project-import.js");
  let projectImporter = fs.readFileSync(projectImporterPath, "utf8");
  const importerFunction = "function importProjectData(data){";
  if (projectImporter.split(importerFunction).length !== 2) {
    throw new Error("Upstream project importer changed; review portable migration");
  }
  const importerPrefix = [
    "function importProjectData(data){",
    "  const isPortableV2 = !!(data && data.kind === 'ultramax-portable-profile');",
    "  if (isPortableV2) {",
    "    if (!window.UltraMaxPortableProfile) throw new Error('Portable importer unavailable');",
    "    data = window.UltraMaxPortableProfile.normalizePortableProfile(data);",
    "    const originalSetup = data.setup || {};",
    "    const preservedKeys = {};",
    "    ['mdblistKey','tmdbKey','tvdbKey','tvdbPin','rpdbKey','tpKey','traktUser'].forEach(function(id){",
    "      const control = document.getElementById(id);",
    "      if(control && control.value) preservedKeys[id] = control.value;",
    "    });",
    "    data.setup = Object.assign({}, preservedKeys, originalSetup);",
    "  }"
  ].join("\\n");
  projectImporter = projectImporter.replace(importerFunction, importerPrefix);
  const importerSelectionMarker = "  applyImportedSelections(data.selectedCatalogs || [], data.hiddenCatalogs || []);";
  if (projectImporter.split(importerSelectionMarker).length !== 2) {
    throw new Error("Could not locate project importer catalog selection");
  }
  projectImporter = projectImporter.replace(importerSelectionMarker,
    "  if(typeof setContentFilterFields === 'function' && data.contentFilters) setContentFilterFields(data.contentFilters);\\n" +
    "  customCatalogs = Array.isArray(data.customCatalogs) ? data.customCatalogs : [];\\n" +
    "  customMdbLists = Array.isArray(data.customMdbLists) ? data.customMdbLists : [];\\n" +
    "  window.catalogOverrides = (data.catalogOverrides && typeof data.catalogOverrides === 'object' && !Array.isArray(data.catalogOverrides)) ? data.catalogOverrides : {};\\n" +
    "  if(typeof renderCustomCatalogList === 'function') renderCustomCatalogList();\\n" +
    importerSelectionMarker);
  fs.writeFileSync(projectImporterPath, projectImporter, "utf8");

  const setupPath = path.join(web, "setup.html");
  const setupBefore = fs.readFileSync(setupPath, "utf8");
  const projectImportScript = '<script src="/setup-modules/project-import.js?v=20260925-streamlangs1"></script>';
  if (setupBefore.split(projectImportScript).length !== 2) {
    throw new Error("Project importer script changed; review import UI insertion");
  }
  fs.writeFileSync(setupPath, setupBefore.replace(projectImportScript,
    '<script src="/setup-modules/portable-profile-normalizer.js"></script>\\n' +
    projectImportScript + '\\n<script src="/setup-modules/manifest-link-import.js"></script>'), "utf8");

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

  const backendIndexPath = path.join(addon, "index.js");
  const backendIndex = fs.readFileSync(backendIndexPath, "utf8");
  const routeMarker = "registerArtworkRoutes(app);";
  if (backendIndex.split(routeMarker).length !== 2) {
    throw new Error("Could not locate express API registration for manifest import");
  }
  fs.writeFileSync(backendIndexPath, backendIndex.replace(routeMarker,
    routeMarker + '\nrequire("./services/manifest-import-service").registerManifestImportRoutes(app);'), "utf8");

  const index = fs.readFileSync(path.join(web, "index.html"), "utf8");
  const setup = fs.readFileSync(path.join(web, "setup.html"), "utf8");
  const handler = fs.readFileSync(seasonPaths[0], "utf8");
  if (!index.includes(PREFIX + "/setup.html") ||
      !setup.includes(PREFIX + "/setup-modules/manifest-link-import.js") ||
      !setup.includes(PREFIX + "/setup-modules/portable-profile-normalizer.js") ||
      !handler.includes("season_number >= 0")) {
    throw new Error("Post-patch smoke assertions failed");
  }
  console.log("Ultra MAX Eitty overlay: Season 0 fixed; " +
    webFiles + " web files and " + addonFiles + " addon files inspected");
}

if (require.main === module) apply(path.resolve(process.argv[2] || "/src"));
module.exports = { apply, rewriteWebText, PREFIX };
