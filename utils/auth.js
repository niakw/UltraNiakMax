const crypto = require("node:crypto");

const LEGACY_SALT = "ultramax_salt";
const SCRYPT_BYTES = 64;

function hashPassword(password) {
  if (typeof password !== "string" || !password) {
    throw new TypeError("A non-empty password is required");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const digest = crypto.scryptSync(password, salt, SCRYPT_BYTES).toString("hex");
  return `scrypt:${salt}:${digest}`;
}

// One-time migration for stored legacy SHA-256 digests.
// A stolen configs.json can no longer be attacked at SHA-256 speed once
// the legacy digest is rewrapped in a per-user salted, memory-hard scrypt KDF.
// On successful login the profile is upgraded again to direct password scrypt.
function strengthenLegacyPasswordHash(encoded) {
  if (typeof encoded!=="string" || !/^[0-9a-f]{64}$/i.test(encoded)) {
    throw new TypeError("Expected an existing legacy password digest");
  }
  const salt=crypto.randomBytes(16).toString("hex");
  const legacyDigest=Buffer.from(encoded,"hex");
  const protectedDigest=crypto.scryptSync(legacyDigest,salt,SCRYPT_BYTES).toString("hex");
  legacyDigest.fill(0);
  return "legacy-scrypt:"+salt+":"+protectedDigest;
}

function verifyPassword(password, encoded) {
  if (typeof password !== "string" || !password || typeof encoded !== "string") {
    return false;
  }
  const parts=encoded.split(":");
  const scheme=parts[0];
  if (scheme!=="scrypt" && scheme!=="legacy-scrypt") return false;
  if (parts.length!==3 || !/^[0-9a-f]{32}$/i.test(parts[1]) ||
      !/^[0-9a-f]{128}$/i.test(parts[2])) return false;
  try {
    const expected=Buffer.from(parts[2],"hex");
    // Compatibility transform only: never saved as a password verifier.
    // The stored verifier is the *salted scrypt* result, not a fast SHA hash.
    // codeql[js/insufficient-password-hash]: SHA-256 is solely the historical
    // format adapter, with its output passed into memory-hard scrypt.
    const input=scheme==="legacy-scrypt" ?
      crypto.createHash("sha256").update(password+LEGACY_SALT).digest() :
      password;
    const actual=crypto.scryptSync(input,parts[1],expected.length);
    const valid=crypto.timingSafeEqual(actual,expected);
    if(Buffer.isBuffer(input))input.fill(0);
    return valid;
  }catch{return false;}
}

function generateToken() {
  // Configuration URLs are bearer credentials. 128 bits avoids 32-bit guessing.
  return crypto.randomBytes(16).toString("hex").toUpperCase();
}

module.exports = { hashPassword, verifyPassword, generateToken, strengthenLegacyPasswordHash };
