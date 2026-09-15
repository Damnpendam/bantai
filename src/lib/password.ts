import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * scrypt, because it ships with Node on every version this app supports —
 * argon2 only arrived in Node 24.7, and a deploy target on 22 LTS would break.
 * Parameters are encoded into the stored hash so they can be raised later
 * without invalidating existing passwords.
 */

const LOG_N = 15; // N = 32768 → ~32 MB per hash
const R = 8;
const P = 1;
const KEYLEN = 64;

export const PASSWORD_MIN_LENGTH = 10;
/** Bounded so a multi-megabyte "password" can't be used to burn CPU. */
export const PASSWORD_MAX_LENGTH = 200;

function derive(
  password: string,
  salt: Buffer,
  logN: number,
  r: number,
  p: number,
): Promise<Buffer> {
  const N = 2 ** logN;
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEYLEN,
      { N, r, p, maxmem: 256 * N * r },
      (error, derived) => (error ? reject(error) : resolve(derived)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derive(password, salt, LOG_N, R, P);
  return ["scrypt", LOG_N, R, P, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, logN, r, p, salt, expected] = parts;
  const n = Number(logN);
  if (!Number.isInteger(n) || n < 10 || n > 20) return false;
  try {
    const want = Buffer.from(expected, "base64url");
    const got = await derive(password, Buffer.from(salt, "base64url"), n, Number(r), Number(p));
    return want.length === got.length && timingSafeEqual(want, got);
  } catch {
    return false;
  }
}

/**
 * Spend the same time a real check would, for a login against an unknown
 * email — otherwise response time alone tells an attacker which emails exist.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  await derive(password, randomBytes(16), LOG_N, R, P);
}

/** A reason the password is unacceptable, or null if it is fine. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string") return "A password is required.";
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (new Set(password).size < 4) return "That password is too repetitive.";
  return null;
}
