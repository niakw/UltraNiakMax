const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CONFIGS_FILE = path.resolve(
  process.env.CONFIGS_FILE || path.join(__dirname, "..", "configs.json")
);

let configCache = null;
let configCacheMtime = null;

function loadConfigs() {
  try {
    const mtime = fs.statSync(CONFIGS_FILE).mtimeMs;
    if (configCache && configCacheMtime === mtime) return configCache;
    const parsed = JSON.parse(fs.readFileSync(CONFIGS_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid configurations file");
    }
    // Null prototype: token keys cannot mutate an inherited prototype.
    configCache = Object.assign(Object.create(null), parsed);
    configCacheMtime = mtime;
    return configCache;
  } catch (error) {
    if (error.code === "ENOENT") return configCache || Object.create(null);
    // Don't erase existing configurations after a corrupt file or I/O failure.
    throw error;
  }
}

function saveConfigs(configs) {
  const directory = path.dirname(CONFIGS_FILE);
  fs.mkdirSync(directory, { recursive: true });

  // Synchronous atomic replacement: responses are not sent before data is saved.
  const tempFile = CONFIGS_FILE + "." + process.pid + "." +
    crypto.randomBytes(6).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(tempFile, JSON.stringify(configs, null, 2), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    fs.renameSync(tempFile, CONFIGS_FILE);
    configCache = Object.assign(Object.create(null), configs);
    configCacheMtime = fs.statSync(CONFIGS_FILE).mtimeMs;
  } finally {
    try { fs.unlinkSync(tempFile); } catch (error) {
      if (error.code !== "ENOENT") console.error("Config temp cleanup:", error.message);
    }
  }
}

module.exports = { loadConfigs, saveConfigs };
