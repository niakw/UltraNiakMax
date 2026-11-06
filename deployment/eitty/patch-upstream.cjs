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
  ].join("\n");
  projectImporter = projectImporter.replace(importerFunction, importerPrefix);
  const importerSelectionMarker = "  applyImportedSelections(data.selectedCatalogs || [], data.hiddenCatalogs || []);";
  if (projectImporter.split(importerSelectionMarker).length !== 2) {
    throw new Error("Could not locate project importer catalog selection");
  }
  projectImporter = projectImporter.replace(importerSelectionMarker,
    "  if(typeof setContentFilterFields === 'function' && data.contentFilters) setContentFilterFields(data.contentFilters);\n" +
    "  customCatalogs = Array.isArray(data.customCatalogs) ? data.customCatalogs : [];\n" +
    "  customMdbLists = Array.isArray(data.customMdbLists) ? data.customMdbLists : [];\n" +
    "  window.catalogOverrides = (data.catalogOverrides && typeof data.catalogOverrides === 'object' && !Array.isArray(data.catalogOverrides)) ? data.catalogOverrides : {};\n" +
    "  if(typeof renderCustomCatalogList === 'function') renderCustomCatalogList();\n" +
    importerSelectionMarker);
  fs.writeFileSync(projectImporterPath, projectImporter, "utf8");

  
  // Personal collection writes must never be authorized by the public
  // manifest token alone. The manifest token is shared with Stremio/Nuvio.
  const collectionRoutePath = path.join(addon, "services/config-route-service.js");
  let collectionRoute = fs.readFileSync(collectionRoutePath, "utf8");
  const collectionRouteMarker = [
    '  app.post("/c/:token/collections", async (req, res) => {',
    '    const { token } = req.params;',
    '    const config = await readConfig(token);',
    '',
    '    if (!config) {',
    '      return res.status(404).json({',
    '        error: "Not found"',
    '      });',
    '    }'
  ].join("\n");
  if (collectionRoute.split(collectionRouteMarker).length !== 2) {
    throw new Error("Collection write auth target changed upstream");
  }
  const collectionRouteAuthenticated = collectionRouteMarker + [
    '',
    '    // This token is intentionally public in manifest URLs; it cannot grant write access.',
    '    if (!config.passwordHash) return res.status(403).json({ error: "Password setup required" });',
    '    const writePassword = String(req.get("x-config-password") || "");',
    '    if (!writePassword) return res.status(401).json({ error: "Password required" });',
    '    if (passwordRateLimited(req, res, token)) return;',
    '    if (!await verifyStoredPassword(token, writePassword, config)) {',
    '      return res.status(401).json({ error: "Incorrect password" });',
    '    }',
    '    clearKey(token);'
  ].join("\n");
  collectionRoute = collectionRoute.replace(collectionRouteMarker, collectionRouteAuthenticated);
  // An install token is public. Never permit it to reset an account password.
  const resetMarker = [
    '  app.post("/c/:token/reset-password", async (req, res) => {',
    '    const { token } = req.params;'
  ].join("\n");
  if (collectionRoute.split(resetMarker).length !== 2) {
    throw new Error("Password reset target changed upstream");
  }
  collectionRoute = collectionRoute.replace(resetMarker, resetMarker + [
    '',
    '    const currentConfig = await readConfig(token);',
    '    if (!currentConfig) return res.status(404).json({ error: "Token not found" });',
    '    if (!currentConfig.passwordHash) return res.status(403).json({ error: "Password setup required" });',
    '    const currentPassword = String(req.get("x-config-password") || "");',
    '    if (!currentPassword) return res.status(401).json({ error: "Current password required" });',
    '    if (passwordRateLimited(req, res, token)) return;',
    '    if (!await verifyStoredPassword(token, currentPassword, currentConfig)) {',
    '      return res.status(401).json({ error: "Incorrect current password" });',
    '    }',
    '    clearKey(token);'
  ].join("\n"));

  // Debug account introspection must be authenticated too.
  const debugMarker = [
    '  app.get("/debug/config/:token", async (req, res) => {',
    '    const { token } = req.params;',
    '    const config = await readConfig(token);',
    '',
    '    if (!config) {',
    '      return res.status(404).json({',
    '        ok: false,',
    '        error: "Config not found",',
    '        token',
    '      });',
    '    }'
  ].join("\n");
  if (collectionRoute.split(debugMarker).length !== 2) {
    throw new Error("Debug config target changed upstream");
  }
  collectionRoute = collectionRoute.replace(debugMarker, debugMarker + [
    '',
    '    if (!config.passwordHash) return res.status(403).json({ error: "Password setup required" });',
    '    const diagnosticPassword = String(req.get("x-config-password") || "");',
    '    if (!diagnosticPassword) return res.status(401).json({ error: "Current password required" });',
    '    if (passwordRateLimited(req, res, token)) return;',
    '    if (!await verifyStoredPassword(token, diagnosticPassword, config)) {',
    '      return res.status(401).json({ error: "Incorrect password" });',
    '    }',
    '    clearKey(token);'
  ].join("\n"));

  // Account password change stays available with an existing authenticated
  // setup, but token-only "forgot password" no longer grants takeover.
  const passwordHelpersPath = path.join(web, "setup-modules/password-helpers.js");
  let passwordHelpers = fs.readFileSync(passwordHelpersPath, "utf8");
  const resetUiHeader = "method:'POST', headers:{'Content-Type':'application/json'},";
  if (passwordHelpers.split(resetUiHeader).length !== 2) {
    throw new Error("Password helper reset request changed upstream");
  }
  passwordHelpers = passwordHelpers.replace(resetUiHeader,
    "method:'POST', headers:{'Content-Type':'application/json', 'x-config-password': (document.getElementById('password')?.value || (typeof _configPassword === 'string' ? _configPassword : ''))},");
  fs.writeFileSync(passwordHelpersPath, passwordHelpers, "utf8");
  const passwordLoadPath = path.join(web, "setup-modules/setup-load-controller.js");
  let passwordLoad = fs.readFileSync(passwordLoadPath, "utf8");
  const modalReset = "method: 'POST', headers: {'Content-Type':'application/json'},";
  if (passwordLoad.split(modalReset).length !== 2) {
    throw new Error("Password modal reset request changed upstream");
  }
  passwordLoad = passwordLoad.replace(modalReset,
    "method: 'POST', headers: {'Content-Type':'application/json', 'x-config-password': (typeof _configPassword === 'string' ? _configPassword : '')},");
  fs.writeFileSync(passwordLoadPath, passwordLoad, "utf8");

  fs.writeFileSync(collectionRoutePath, collectionRoute, "utf8");

  // A known manifest token must never permit Fusion share creation or
  // revocation. Public read-only share endpoints remain usable by clients.
  const fusionRoutePath = path.join(addon, "services/fusion-route-service.js");
  let fusionRoute = fs.readFileSync(fusionRoutePath, "utf8");
  const fusionRegisterMarker =
    '  const { loadConfigs, readConfig = async token => loadConfigs()[token], rateLimit } = deps;';
  if (fusionRoute.split(fusionRegisterMarker).length !== 2) {
    throw new Error("Fusion route registration changed upstream");
  }
  fusionRoute = fusionRoute.replace(fusionRegisterMarker,
    fusionRegisterMarker + [
      '',
      '  const { verifyPassword } = require("../utils/auth");',
      '  function authorizeFusionWrite(req, res, config) {',
      '    if (!config?.passwordHash) { res.status(403).json({ error: "Password setup required" }); return false; }',
      '    const password = String(req.get("x-config-password") || "");',
      '    if (!password) { res.status(401).json({ error: "Current password required" }); return false; }',
      '    const ip = req.headers["x-real-ip"] || req.socket.remoteAddress;',
      '    if (rateLimit("fusion-auth:" + String(ip), 8, 60000)) {',
      '      res.status(429).json({ error: "Too many authentication attempts" }); return false;',
      '    }',
      '    if (!verifyPassword(password, config.passwordHash)) {',
      '      res.status(401).json({ error: "Incorrect password" }); return false;',
      '    }',
      '    return true;',
      '  }'
    ].join("\n"));
  const fusionCreateMarker = [
    '      const baseConfig = await readConfig(token);',
    '      if (!baseConfig) return res.status(404).json({ error: "Setup not found" });',
    '',
    '      const rawProfileId = (req.body && req.body.profile) || req.query.profile || null;'
  ].join("\n");
  if (fusionRoute.split(fusionCreateMarker).length !== 2) {
    throw new Error("Fusion share creation auth target changed upstream");
  }
  fusionRoute = fusionRoute.replace(fusionCreateMarker,
    fusionCreateMarker.replace(
      '      const rawProfileId',
      '      if (!authorizeFusionWrite(req, res, baseConfig)) return;\n\n      const rawProfileId'));
  const fusionStatusMarker = [
    '  app.get("/c/:token/fusion/share", async (req, res) => {',
    '    try {',
    '      const { token } = req.params;',
    '      if (!await readConfig(token)) return res.status(404).json({ error: "Setup not found" });'
  ].join("\n");
  if (fusionRoute.split(fusionStatusMarker).length !== 2) {
    throw new Error("Fusion share listing target changed upstream");
  }
  fusionRoute = fusionRoute.replace(fusionStatusMarker,
    fusionStatusMarker.replace(
      '      if (!await readConfig(token)) return res.status(404).json({ error: "Setup not found" });',
      '      const config = await readConfig(token);\n      if (!config) return res.status(404).json({ error: "Setup not found" });\n      if (!authorizeFusionWrite(req, res, config)) return;'));
  const fusionRevokeMarker = [
    '  app.post("/c/:token/fusion/share/revoke", async (req, res) => {',
    '    try {',
    '      const { token } = req.params;',
    '      if (!await readConfig(token)) return res.status(404).json({ error: "Setup not found" });'
  ].join("\n");
  if (fusionRoute.split(fusionRevokeMarker).length !== 2) {
    throw new Error("Fusion share revoke target changed upstream");
  }
  fusionRoute = fusionRoute.replace(fusionRevokeMarker,
    fusionRevokeMarker.replace(
      '      if (!await readConfig(token)) return res.status(404).json({ error: "Setup not found" });',
      '      const config = await readConfig(token);\n      if (!config) return res.status(404).json({ error: "Setup not found" });\n      if (!authorizeFusionWrite(req, res, config)) return;'));
  fs.writeFileSync(fusionRoutePath, fusionRoute, "utf8");

  const fusionUiPath = path.join(web, "setup-modules/fusion-controller.js");
  let fusionUi = fs.readFileSync(fusionUiPath, "utf8");
  const fusionUiWriteHeader = "headers: { 'Content-Type': 'application/json' },";
  if (fusionUi.split(fusionUiWriteHeader).length !== 3) {
    throw new Error("Fusion UI write requests changed upstream");
  }
  fusionUi = fusionUi.replaceAll(fusionUiWriteHeader,
    "headers: { 'Content-Type': 'application/json', 'x-config-password': (document.getElementById('password')?.value || (typeof _configPassword === 'string' ? _configPassword : '')) },");
  const fusionStatusFetch = [
    '          var res = await fetch(',
    "            '/c/' + encodeURIComponent(token) + '/fusion/share' + fusionQuery()",
    '          );'
  ].join("\n");
  if (fusionUi.split(fusionStatusFetch).length !== 2) {
    throw new Error("Fusion share status UI changed upstream");
  }
  fusionUi = fusionUi.replace(fusionStatusFetch, [
    '          var res = await fetch(',
    "            '/c/' + encodeURIComponent(token) + '/fusion/share' + fusionQuery(),",
    "            { headers: { 'x-config-password': (document.getElementById('password')?.value || (typeof _configPassword === 'string' ? _configPassword : '')) } }",
    '          );'
  ].join("\n"));
  fs.writeFileSync(fusionUiPath, fusionUi, "utf8");

  const writePasswordExpr = "(document.getElementById('password')?.value || (typeof _configPassword === 'string' ? _configPassword : ''))";
  // Keep both the generated setup flow and subsequent edits functional.
  const generationPath = path.join(web, "setup-modules/generation-controller.js");
  let generation = fs.readFileSync(generationPath, "utf8");
  const generationHeader = "headers: {'Content-Type':'application/json'},";
  if (generation.split(generationHeader).length !== 3) {
    throw new Error("Generation controller collection-write headers changed");
  }
  generation = generation.replaceAll(generationHeader,
    "headers: {'Content-Type':'application/json', 'x-config-password': " + writePasswordExpr + "},");
  fs.writeFileSync(generationPath, generation, "utf8");

  const nuvioCollectionsPath = path.join(web, "setup-modules/nuvio-collections.js");
  let nuvioCollections = fs.readFileSync(nuvioCollectionsPath, "utf8");
  const nuvioHeader = "headers: {'Content-Type': 'application/json'},";
  if (nuvioCollections.split(nuvioHeader).length !== 2) {
    throw new Error("Nuvio collection save header changed upstream");
  }
  nuvioCollections = nuvioCollections.replace(nuvioHeader,
    "headers: {'Content-Type': 'application/json', 'x-config-password': " + writePasswordExpr + "},");
  fs.writeFileSync(nuvioCollectionsPath, nuvioCollections, "utf8");


  const setupPath = path.join(web, "setup.html");
  const setupBefore = fs.readFileSync(setupPath, "utf8");
  const projectImportScript = '<script src="/setup-modules/project-import.js?v=20260925-streamlangs1"></script>';
  if (setupBefore.split(projectImportScript).length !== 2) {
    throw new Error("Project importer script changed; review import UI insertion");
  }
  fs.writeFileSync(setupPath, setupBefore.replace(projectImportScript,
    '<script src="/setup-modules/portable-profile-normalizer.js"></script>\n' +
    projectImportScript + '\n<script src="/setup-modules/manifest-link-import.js"></script>'), "utf8");

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
  // Immutable, content-addressed artwork for Nuvio / Stremio. It lives
  // strictly in the persistent /data volume, never in the public source tree.
  // Only images validated and written by the private VPS migration can exist
  // under this path; the server does not expose a generic image-fetch proxy.
  const artworkRouteLines = [
    '',
    'app.use("/images/user", express.static(path.join(process.env.DATA_DIR || "/data", "artwork", "user"), {',
    '  fallthrough: false, immutable: true, maxAge: "365d", index: false,',
    '  dotfiles: "deny",',
    '  setHeaders(res) {',
    '    res.setHeader("X-Content-Type-Options", "nosniff");',
    '    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");',
    '    res.setHeader("Referrer-Policy", "no-referrer");',
    '  }',
    '}));'
  ].join("\n");
  fs.writeFileSync(backendIndexPath, backendIndex.replace(routeMarker,
    routeMarker + artworkRouteLines +
    '\nrequire("./services/manifest-import-service").registerManifestImportRoutes(app);'), "utf8");

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
