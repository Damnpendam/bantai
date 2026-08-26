import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRetryAfter } from "./types.ts";

test("reads a delay expressed in seconds", () => {
  assert.equal(parseRetryAfter("30"), 30_000);
  assert.equal(parseRetryAfter("0"), 0);
});

test("reads a delay expressed as an HTTP date", () => {
  const ms = parseRetryAfter(new Date(Date.now() + 10_000).toUTCString());
  assert.ok(ms !== undefined && ms > 8_000 && ms <= 10_000);
});

test("never returns a negative delay for a date already past", () => {
  assert.equal(parseRetryAfter(new Date(Date.now() - 60_000).toUTCString()), 0);
});

test("ignores absent or unparseable values", () => {
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter(undefined), undefined);
  assert.equal(parseRetryAfter("soon"), undefined);
  assert.equal(parseRetryAfter("-5"), undefined);
});
