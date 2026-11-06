"use strict";
/**
 * Build-only WebP optimization for bundled Ultra MAX user-interface artwork.
 * - No public URL fetching, personal profile reads, or runtime dependencies.
 * - Preserve original PNG files as compatibility fallbacks.
 * - Never touch PWA/Apple install icons, branding metadata, GIF animations.
 * - Replace references only when WebP decodes and saves at least 10%.
 */
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const webRoot = path.resolve(process.argv[2] || "/src/web");
const artwork = [
  "eclipse-2-desktop.png",
  "eclipse-2-refined-desktop.png",
  "eclipse-2-mobile.png",
  "eclipse-2-refined-mobile.png",
  "logos/btttr.png",
  "logos/nuvio-icon.png",
  "logos/rpdb.jpg",
  "logos/trakt.png",
  "logos/mdblist.png",
  "logos/stremio.png"
];

const textExtensions = new Set([".html", ".css", ".js", ".json"]);
function walk(dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".")) walk(path.join(dir, entry.name), output);
    } else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) {
      output.push(path.join(dir, entry.name));
    }
  }
  return output;
}
const textFiles = walk(webRoot);
let sourceBytes = 0;
let optimizedBytes = 0;
let count = 0;
for (const asset of artwork) {
  const input = path.join(webRoot, asset);
  if (!fs.existsSync(input)) throw new Error("Pinned upstream artwork missing: " + asset);
  // Skip source graphics not referenced anywhere in the bundled UI. This
  // avoids spending CPU on obsolete background assets or adding dead files.
  if (!textFiles.some(file => fs.readFileSync(file, "utf8").includes(asset))) {
    console.log("WebP skipped: " + asset + " (not referenced)");
    continue;
  }
  const output = input.replace(/\.(?:png|jpe?g)$/i, ".webp");
  const result = cp.spawnSync("cwebp", ["-quiet", "-q", "80", "-m", "6", "-metadata", "none", input, "-o", output], {
    encoding: "utf8", timeout: 25000
  });
  if (result.error || result.status !== 0 || !fs.existsSync(output)) {
    throw new Error("Failed to compress required UI artwork: " + asset);
  }
  const srcBytes = fs.statSync(input).size;
  const compressedBytes = fs.statSync(output).size;
  const magic = fs.readFileSync(output).subarray(0, 12);
  if (magic.toString("ascii", 0, 4) !== "RIFF" || magic.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("Invalid WebP file generated: " + asset);
  }
  if (compressedBytes >= Math.floor(srcBytes * 0.90)) {
    // The original remains the most efficient size for this artwork.
    fs.unlinkSync(output);
    console.log("WebP skipped: " + asset + " (no meaningful savings)");
    continue;
  }
  let references = 0;
  const replacement = asset.replace(/\.(?:png|jpe?g)$/i, ".webp");
  for (const textFile of textFiles) {
    const source = fs.readFileSync(textFile, "utf8");
    if (!source.includes(asset)) continue;
    const hits = source.split(asset).length - 1;
    const next = source.split(asset).join(replacement);
    if (next !== source) {
      fs.writeFileSync(textFile, next, "utf8");
      references += hits;
    }
  }
  if (!references) {
    fs.unlinkSync(output);
    console.log("WebP skipped: " + asset + " (not referenced)");
    continue;
  }
  sourceBytes += srcBytes;
  optimizedBytes += compressedBytes;
  count += 1;
  console.log("WebP optimized: " + asset + " -> " + replacement +
    " (saving " + Math.round((1 - compressedBytes/srcBytes)*100) + "%, refs=" + references + ")");
}
if (count < 3) throw new Error("Too few required UI images optimized");
console.log("UI WebP assets=" + count + " originalBytes=" + sourceBytes +
  " optimizedBytes=" + optimizedBytes +
  " savedPct=" + Math.round((1 - optimizedBytes/sourceBytes)*100));
