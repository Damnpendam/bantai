import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bantai-rag-"));
process.env.BANTAI_DATA_DIR = tmp;
const store = await import("../store.ts");
const { syncChunks, embedPending } = await import("./indexer.ts");
const { search } = await import("./retrieve.ts");

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let counter = 0;
function doc(projectId: string, name: string, text: string): string {
  const id = `doc-${(counter += 1)}`;
  store.addDocument({ id, project_id: projectId, name, bytes: text.length, text });
  return id;
}

const REFUNDS = "# Refunds\n\nRefunds go back to the original payment method within five business days.";
const COUPONS = "# Coupons\n\nThe SPRING code takes ten percent off orders above fifty dollars. Only one code per order.";
const CART = "# Cart\n\nA cart must hold at least one item before payment is allowed.";

// Words that mean the same thing share an axis, so a query with no word in common
// with a passage can still land next to it — the thing keyword search cannot do.
const AXES = [
  ["refund", "refunds", "reimbursement", "reimburse", "repayment"],
  ["coupon", "code", "discount", "promo"],
  ["cart", "basket", "item"],
];
function concept(text: string): number[] {
  const v = new Array(AXES.length).fill(0);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const axis = AXES.findIndex((a) => a.includes(word));
    if (axis >= 0) v[axis] += 1;
  }
  return v;
}
const embedder = async (texts: string[]) => texts.map(concept);

test("syncChunks indexes documents once and is idempotent", () => {
  const p = "p-sync";
  doc(p, "refunds.md", REFUNDS);
  doc(p, "coupons.md", COUPONS);
  const first = syncChunks(p);
  assert.equal(first.indexed, 2);
  assert.equal(syncChunks(p).indexed, 0);
  const stats = store.ragStats(p, null);
  assert.equal(stats.documents, 2);
  assert.equal(stats.indexedDocuments, 2);
  assert.ok(stats.passages >= 2);
});

test("keyword search returns the whole parent section with its document name", async () => {
  const p = "p-keyword";
  doc(p, "refunds.md", REFUNDS);
  doc(p, "coupons.md", COUPONS);
  doc(p, "cart.md", CART);
  syncChunks(p);

  const { passages, mode } = await search(p, "how are refunds paid back");
  assert.equal(mode, "keyword");
  assert.equal(passages[0].documentName, "refunds.md");
  assert.equal(passages[0].heading, "Refunds");
  assert.match(passages[0].text, /five business days/);
  assert.equal(passages[0].via, "keyword");
  assert.deepEqual((await search(p, "kubernetes helm chart")).passages, []);
});

test("tenancy: a project never retrieves another project's passages", async () => {
  doc("tenant-a", "secret.md", "# Plan\n\nThe launch codename is BLUEHERON and the budget is large.");
  doc("tenant-b", "other.md", "# Notes\n\nNothing about launches lives here, only gardening.");
  syncChunks("tenant-a");
  syncChunks("tenant-b");

  assert.equal((await search("tenant-a", "BLUEHERON codename")).passages.length, 1);
  assert.deepEqual((await search("tenant-b", "BLUEHERON codename")).passages, []);
  assert.equal(store.ragStats("tenant-b", null).passages, 1);
});

test("deleting a document removes it from search immediately", async () => {
  const p = "p-delete";
  const id = doc(p, "refunds.md", REFUNDS);
  doc(p, "cart.md", CART);
  syncChunks(p);
  assert.equal((await search(p, "refunds")).passages[0].documentName, "refunds.md");

  store.deleteDocument(id);
  assert.deepEqual((await search(p, "refunds")).passages, []);
  assert.equal(store.ragStats(p, null).passages, 1);
});

test("embedding: fills every passage, then does nothing more; a new model starts over", async () => {
  const p = "p-embed";
  doc(p, "refunds.md", REFUNDS);
  doc(p, "coupons.md", COUPONS);
  syncChunks(p);

  const done = await embedPending(p, "fake:v1", embedder);
  assert.equal(done.error, null);
  assert.equal(done.remaining, 0);
  assert.ok(done.embedded >= 2);
  assert.equal((await embedPending(p, "fake:v1", embedder)).embedded, 0);

  const switched = await embedPending(p, "fake:v2", embedder);
  assert.equal(switched.embedded, done.embedded);
  assert.equal(store.ragStats(p, "fake:v1").embedded, 0);
});

test("semantic search finds a passage that shares no words with the question", async () => {
  const p = "p-hybrid";
  doc(p, "refunds.md", REFUNDS);
  doc(p, "coupons.md", COUPONS);
  doc(p, "cart.md", CART);
  syncChunks(p);
  await embedPending(p, "fake:v1", embedder);

  const keywordOnly = await search(p, "reimbursement timeline");
  assert.deepEqual(keywordOnly.passages, [], "no overlapping words, no keyword hit");

  const hybrid = await search(p, "reimbursement timeline", {
    model: "fake:v1",
    embedQuery: async (q) => concept(q),
  });
  assert.equal(hybrid.mode, "hybrid");
  assert.equal(hybrid.passages[0].documentName, "refunds.md");
  assert.equal(hybrid.passages[0].via, "semantic");
});

test("a query that matches both ways is marked as such and ranks first", async () => {
  const p = "p-both";
  doc(p, "refunds.md", REFUNDS);
  doc(p, "coupons.md", COUPONS);
  syncChunks(p);
  await embedPending(p, "fake:v1", embedder);
  const out = await search(p, "refunds", { model: "fake:v1", embedQuery: async (q) => concept(q) });
  assert.equal(out.passages[0].documentName, "refunds.md");
  assert.equal(out.passages[0].via, "both");
});

test("if the query embedding fails, search falls back to keywords and says why", async () => {
  const p = "p-degrade";
  doc(p, "refunds.md", REFUNDS);
  syncChunks(p);
  await embedPending(p, "fake:v1", embedder);
  const out = await search(p, "refunds", {
    model: "fake:v1",
    embedQuery: async () => {
      throw new Error("rate limited");
    },
  });
  assert.equal(out.mode, "keyword");
  assert.equal(out.degraded, "rate limited");
  assert.equal(out.passages[0].documentName, "refunds.md");
});

test("vectors from a different model are ignored rather than compared", async () => {
  const p = "p-model";
  doc(p, "refunds.md", REFUNDS);
  syncChunks(p);
  await embedPending(p, "fake:old", embedder);
  const out = await search(p, "reimbursement", {
    model: "fake:new",
    embedQuery: async (q) => concept(q),
  });
  assert.equal(out.mode, "keyword");
  assert.deepEqual(out.passages, []);
});

test("a failure part way keeps what was saved and reports it; concurrent calls share one job", async () => {
  const p = "p-partial";
  const long = Array.from({ length: 1400 }, (_, i) => `Rule ${i} says item ${i} needs approval.`).join(" ");
  doc(p, "long.md", long);
  syncChunks(p);
  const total = store.ragStats(p, null).passages;
  assert.ok(total > 64, `needs more than one batch, got ${total}`);

  let calls = 0;
  const flaky = async (texts: string[]) => {
    calls += 1;
    if (calls === 2) throw new Error("provider hiccup");
    return texts.map(concept);
  };
  const [a, b] = await Promise.all([embedPending(p, "fake:v1", flaky), embedPending(p, "fake:v1", flaky)]);
  assert.strictEqual(a, b, "the second call joined the first");
  assert.equal(a.error, "provider hiccup");
  assert.equal(a.embedded, 64);
  assert.equal(a.remaining, total - 64);

  const resumed = await embedPending(p, "fake:v1", async (t) => t.map(concept));
  assert.equal(resumed.error, null);
  assert.equal(resumed.remaining, 0);
});
