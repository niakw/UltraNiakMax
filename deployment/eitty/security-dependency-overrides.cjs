"use strict";
/**
 * Reviewed security-only dependency pins for the pinned Ultra MAX 8.1.4
 * self-hosted source. Run once in the Docker *builder*, before regenerating
 * package-lock.json. The runtime continues to use npm ci.
 *
 * This script intentionally fails if upstream direct dependencies change:
 * incompatible major upgrades require a separate, tested source review.
 */
const fs = require("node:fs");
const path = require("node:path");
const directory = path.resolve(process.argv[2] || "/src/addon");
const file = path.join(directory, "package.json");
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
if (pkg.name !== "stremio-catalog-addon" || pkg.version !== "8.1.4") {
  throw new Error("Unexpected upstream package; refusing blind security overrides");
}
if (pkg.dependencies?.multer !== "2.4.0" ||
    pkg.dependencies?.compression !== "^1.8.1") {
  throw new Error("Upstream direct dependency versions changed; review before patching");
}
// Patched in October/November 2026. Exact versions avoid a new floating
// dependency range; npm audit checks the resulting full dependency tree.
pkg.dependencies.multer = "2.5.0";
pkg.dependencies.compression = "1.8.2";
const overrides = { ...(pkg.overrides || {}) };
delete overrides["body-parser@1.20.6"];
delete overrides["express@4.22.1"];
Object.assign(overrides, {
  "body-parser@^1.0.0": "1.20.9",
  "express@^4.0.0": "4.22.3",
  "qs": "6.16.1",
  "body-parser@^2.0.0": "2.4.0",
  "follow-redirects": "1.16.2",
  "proxy-addr": "2.0.8"
});
pkg.overrides = overrides;
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n", "utf8");
console.log("Reviewed production dependency overrides applied: multer 2.5.0, compression 1.8.2, body-parser 1.x/2.x patched, follow-redirects 1.16.2, proxy-addr 2.0.8, express 4.22.3, qs 6.16.1.");
