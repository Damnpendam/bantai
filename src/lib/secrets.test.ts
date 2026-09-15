import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decryptWith,
  deriveKey,
  encryptWith,
  hashToken,
  isEncrypted,
  randomToken,
} from "./secrets.ts";

const key = deriveKey("a-test-secret-that-is-long-enough-to-pass");

test("encrypt then decrypt returns the original", () => {
  const sealed = encryptWith(key, "sk-or-v1-abc123");
  assert.ok(isEncrypted(sealed));
  assert.equal(decryptWith(key, sealed), "sk-or-v1-abc123");
});

test("the same plaintext encrypts differently every time", () => {
  assert.notEqual(encryptWith(key, "same"), encryptWith(key, "same"));
});

test("a tampered ciphertext is rejected, not silently misread", () => {
  const sealed = encryptWith(key, "sk-or-v1-abc123");
  const parts = sealed.split(".");
  const body = Buffer.from(parts[3], "base64url");
  body[0] ^= 0xff;
  parts[3] = body.toString("base64url");
  assert.throws(() => decryptWith(key, parts.join(".")));
});

test("a different master secret cannot decrypt", () => {
  const sealed = encryptWith(key, "sk-or-v1-abc123");
  const other = deriveKey("a-completely-different-secret-value-xyz");
  assert.throws(() => decryptWith(other, sealed));
});

test("plaintext is never mistaken for an encrypted value", () => {
  assert.equal(isEncrypted("sk-or-v1-abc123"), false);
  assert.throws(() => decryptWith(key, "sk-or-v1-abc123"));
});

test("tokens are unique and their stored hash is stable and not the token", () => {
  const a = randomToken();
  const b = randomToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40);
  assert.equal(hashToken(a), hashToken(a));
  assert.notEqual(hashToken(a), a);
});
