// Relative imports only: this module is exercised directly by the node test runner.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./data-dir.ts";

/**
 * At-rest encryption for secrets stored in the database (provider API keys),
 * and the random-token helpers auth builds on.
 *
 * The master secret comes from APP_SECRET. In development, one is generated
 * once and kept next to the database so restarts don't orphan encrypted rows;
 * in production a missing APP_SECRET is a hard error rather than a silent
 * fallback, because a generated secret on the same volume as the database
 * protects nothing.
 */

const MIN_SECRET_LENGTH = 32;
const VERSION = "v1";

let cachedKey: Buffer | null = null;

function loadSecret(): Buffer {
  const fromEnv = process.env.APP_SECRET;
  if (fromEnv) {
    if (fromEnv.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `APP_SECRET must be at least ${MIN_SECRET_LENGTH} characters. Generate one with: openssl rand -base64 48`,
      );
    }
    return Buffer.from(fromEnv, "utf8");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "APP_SECRET is not set. It is required in production to encrypt stored API keys. Generate one with: openssl rand -base64 48",
    );
  }
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, ".app-secret");
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, randomBytes(48).toString("base64"), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(file, "utf8").trim(), "utf8");
}

/** Derive the encryption key from a master secret. Exported for tests. */
export function deriveKey(secret: Buffer | string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", secret, "bantai", "settings-encryption:v1", 32),
  );
}

function key(): Buffer {
  if (!cachedKey) cachedKey = deriveKey(loadSecret());
  return cachedKey;
}

export function encryptWith(k: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, body].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptWith(k: Buffer, token: string): string {
  const [version, iv, tag, body] = token.split(".");
  if (version !== VERSION || !iv || !tag || body === undefined) {
    throw new Error("Not an encrypted value.");
  }
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function encrypt(plaintext: string): string {
  return encryptWith(key(), plaintext);
}

export function decrypt(token: string): string {
  return decryptWith(key(), token);
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}.`) && value.split(".").length === 4;
}

/** An unguessable token for a cookie or an emailed link. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * What the database stores in place of a token. A leaked database then yields
 * no usable sessions, invites or reset links.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
