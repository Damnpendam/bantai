import { test } from "node:test";
import assert from "node:assert/strict";
import { findCandidatePairs, similarity } from "./similarity.ts";

test("scores identical text as 1 and unrelated text near 0", () => {
  assert.equal(similarity("add item to cart", "add item to cart"), 1);
  assert.ok(similarity("add item to cart", "revoke an admin session") < 0.15);
});

test("ignores case and punctuation", () => {
  assert.ok(similarity("Add item to cart!", "add item to cart") > 0.95);
});

test("scores rewordings of the same behaviour highly", () => {
  const score = similarity(
    "Promo code is rejected when the subtotal is below the minimum",
    "Promo code rejected when subtotal is below minimum",
  );
  assert.ok(score > 0.7, `expected a high score, got ${score}`);
});

test("keeps genuinely different boundaries apart", () => {
  const score = similarity(
    "Quantity accepts the maximum value of 99",
    "Adversary replays a completed payment intent",
  );
  assert.ok(score < 0.2, `expected a low score, got ${score}`);
});

test("surfaces the near-duplicate pair and not the unrelated ones", () => {
  const items = [
    { id: "a", title: "User can add a single item to the cart" },
    { id: "b", title: "User adds a single item to the cart" },
    { id: "c", title: "Admin revokes a shared payment method mid-checkout" },
  ];
  const pairs = findCandidatePairs(items, (i) => i.title);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].a.id, pairs[0].b.id].sort(), ["a", "b"]);
});

test("returns nothing when every case is distinct", () => {
  const items = [
    { title: "Cart rejects a 51st distinct item" },
    { title: "Screen reader announces the promo error" },
    { title: "Payment intent replay is idempotent" },
  ];
  assert.equal(findCandidatePairs(items, (i) => i.title).length, 0);
});

test("caps how many pairs it returns, strongest first", () => {
  const items = Array.from({ length: 40 }, (_, i) => ({
    title: `User can add item number ${i} to the shopping cart`,
  }));
  const pairs = findCandidatePairs(items, (i) => i.title, { limit: 10 });
  assert.equal(pairs.length, 10);
  for (let i = 1; i < pairs.length; i += 1) {
    assert.ok(pairs[i - 1].score >= pairs[i].score);
  }
});
