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

function verifyPassword(password, encoded) {
  if (typeof password !== "string" || !password || typeof encoded !== "string") {
    return false;
  }

  const parts = encoded.split(":");
  if (parts[0] === "scrypt") {
    if (parts.length !== 3 || !/^[0-9a-f]{32}$/i.test(parts[1]) ||
        !/^[0-9a-f]{128}$/i.test(parts[2])) return false;
    try {
      const expected = Buffer.from(parts[2], "hex");
      const actual = crypto.scryptSync(password, parts[1], expected.length);
      return crypto.timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  // Verify configurations created before the move from unsalted SHA-256.
  if (!/^[0-9a-f]{64}$/i.test(encoded)) return false;
  const oldHash = crypto.createHash("sha256")
    .update(password + LEGACY_SALT).digest();
  return crypto.timingSafeEqual(oldHash, Buffer.from(encoded, "hex"));
}

function generateToken() {
  // Configuration URLs are bearer credentials. 128 bits avoids 32-bit guessing.
  return crypto.randomBytes(16).toString("hex").toUpperCase();
}

module.exports = { hashPassword, verifyPassword, generateToken };
