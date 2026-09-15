import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, passwordProblem, verifyPassword } from "./password.ts";

test("a hashed password verifies, and a wrong one does not", async () => {
  const stored = await hashPassword("correct horse battery");
  assert.equal(await verifyPassword("correct horse battery", stored), true);
  assert.equal(await verifyPassword("correct horse batterY", stored), false);
});

test("hashes are salted: the same password never stores the same way twice", async () => {
  const a = await hashPassword("correct horse battery");
  const b = await hashPassword("correct horse battery");
  assert.notEqual(a, b);
  assert.ok(a.startsWith("scrypt$15$8$1$"));
});

test("a malformed or foreign stored hash never verifies", async () => {
  assert.equal(await verifyPassword("anything", ""), false);
  assert.equal(await verifyPassword("anything", "bcrypt$2b$10$abc"), false);
  assert.equal(await verifyPassword("anything", "scrypt$99$8$1$aa$bb"), false);
});

test("password rules reject short, huge and repetitive passwords", () => {
  assert.ok(passwordProblem("short"));
  assert.ok(passwordProblem("a".repeat(300)));
  assert.ok(passwordProblem("aaaaaaaaaaaa"));
  assert.ok(passwordProblem(undefined));
  assert.equal(passwordProblem("a perfectly fine passphrase"), null);
});
