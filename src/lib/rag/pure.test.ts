import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHILD_OVERLAP,
  CHILD_SIZE,
  MAX_PARENT,
  chunkDocument,
  searchText,
  textHash,
} from "./chunker.ts";
import { Bm25Index, fuse, stem, tokenize } from "./bm25.ts";
import { dot, fromBlob, normalize, toBlob } from "./vectors.ts";

const PRD = `# Checkout

Customers can pay by card or wallet. A cart must hold at least one item before payment is allowed.

## Coupons

The SPRING code takes 10 percent off orders above 50 dollars. Codes are case insensitive and expire at midnight UTC.

Only one code may be applied per order. Applying a second code replaces the first.

## Refunds

Refunds go back to the original payment method within five business days.
`;

test("chunker: parents follow headings and carry the heading trail", () => {
  const { parents } = chunkDocument("d1", PRD);
  assert.ok(parents.length >= 1);
  assert.ok(parents.every((p) => p.text.length <= MAX_PARENT));
  const all = parents.map((p) => p.text).join("\n");
  assert.match(all, /SPRING code/);
  assert.match(all, /Refunds go back/);
  assert.ok(parents[0].heading.startsWith("Checkout"));
});

test("chunker: a long document splits at headings once parents are big enough", () => {
  const filler = (n: number) => `${"Sentence about the payment flow. ".repeat(n)}`;
  const text = `# Alpha\n\n${filler(80)}\n\n# Beta\n\n${filler(80)}`;
  const { parents } = chunkDocument("d2", text);
  assert.ok(parents.length >= 2);
  assert.ok(parents.some((p) => p.heading === "Alpha"));
  assert.ok(parents.some((p) => p.heading === "Beta"));
});

test("chunker: children are bounded, linked to a parent, and overlap", () => {
  const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} explains rule ${i}.`).join(" ");
  const { parents, children } = chunkDocument("d3", text);
  assert.ok(children.length > 2);
  const parentIds = new Set(parents.map((p) => p.id));
  for (const child of children) {
    assert.ok(parentIds.has(child.parentId));
    assert.ok(child.text.length <= CHILD_SIZE, `child of ${child.text.length} chars`);
  }
  const first = children[0].text;
  const second = children[1].text;
  const tail = first.slice(-Math.min(CHILD_OVERLAP / 2, first.length));
  assert.ok(second.includes(tail.trim().split(" ").slice(-2).join(" ")), "windows overlap");
});

test("chunker: every word of the source survives into some child", () => {
  const { parents, children } = chunkDocument("d4", PRD);
  const joined = [...parents.map((p) => p.heading), ...children.map((c) => c.text)].join(" ");
  for (const word of PRD.match(/[A-Za-z]{5,}/g) ?? []) {
    assert.ok(joined.includes(word), `missing ${word}`);
  }
});

test("chunker: ids are deterministic, empty input yields nothing, CRLF is handled", () => {
  assert.deepEqual(chunkDocument("d", PRD), chunkDocument("d", PRD));
  assert.deepEqual(chunkDocument("d", "   \n\n  "), { parents: [], children: [] });
  const crlf = chunkDocument("d", PRD.replace(/\n/g, "\r\n"));
  assert.deepEqual(
    crlf.parents.map((p) => p.heading),
    chunkDocument("d", PRD).parents.map((p) => p.heading),
  );
  assert.notEqual(textHash("a"), textHash("b"));
});

test("chunker: a single enormous token still terminates and respects the ceiling", () => {
  const { parents, children } = chunkDocument("big", "x".repeat(20_000));
  assert.ok(parents.every((p) => p.text.length <= MAX_PARENT));
  assert.ok(children.every((c) => c.text.length <= CHILD_SIZE));
  assert.ok(children.length > 10);
});

test("chunker: searchText puts the heading in front of the child", () => {
  assert.equal(searchText("A > B", "body"), "A > B\nbody");
  assert.equal(searchText("", "body"), "body");
});

test("bm25: tokenizer drops stopwords and folds simple plurals", () => {
  assert.deepEqual(tokenize("The discounts apply to the carts"), ["discount", "apply", "cart"]);
  assert.equal(stem("policies"), "policy");
  assert.equal(stem("class"), "class");
});

test("bm25: ranks the chunk that actually answers first", () => {
  const index = new Bm25Index([
    { id: "refund", text: "Refunds go back to the original payment method within five business days." },
    { id: "coupon", text: "The SPRING code takes 10 percent off orders above 50 dollars." },
    { id: "cart", text: "A cart must hold at least one item before payment is allowed." },
  ]);
  assert.equal(index.search("when are refunds paid back", 3)[0].id, "refund");
  assert.equal(index.search("spring discount code", 3)[0].id, "coupon");
  assert.deepEqual(index.search("kubernetes", 3), []);
  assert.deepEqual(new Bm25Index([]).search("anything", 3), []);
});

test("fuse: agreement between rankings beats a single first place", () => {
  const fused = fuse([
    ["a", "b", "c"],
    ["b", "c", "d"],
  ]);
  assert.equal(fused[0].id, "b");
  assert.deepEqual(new Set(fused.map((f) => f.id)), new Set(["a", "b", "c", "d"]));
});

test("vectors: normalize, dot, and the SQLite blob round trip", () => {
  const v = normalize([3, 4]);
  assert.ok(Math.abs(dot(v, v) - 1) < 1e-6);
  assert.equal(normalize([0, 0])[0], 0);
  const back = fromBlob(toBlob(v));
  assert.deepEqual([...back], [...v]);
  // Bytes at an odd offset, as a database driver might hand them over.
  const shifted = new Uint8Array(toBlob(v).byteLength + 1);
  shifted.set(toBlob(v), 1);
  assert.deepEqual([...fromBlob(shifted.subarray(1))], [...v]);
  assert.equal(dot(new Float32Array(2), new Float32Array(3)), 0);
});
