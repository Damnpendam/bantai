import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bantai-impact-"));
process.env.BANTAI_DATA_DIR = tmp;
const store = await import("./store.ts");
const { neighbourhood, listConflicts, impactReport } = await import("./impact.ts");

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A tiny model: promo -> checkout -> order, plus a lonely settings screen. */
function seed(): { p: string; ids: Record<string, string> } {
  const p = randomUUID();
  store.createProject(p, "Shop");
  // Ids unique per call so tests do not reassign each other's entities.
  const tag = p.slice(0, 8);
  const ids = {
    promo: `ent_promo_${tag}`,
    checkout: `ent_checkout_${tag}`,
    order: `ent_order_${tag}`,
    settings: `ent_settings_${tag}`,
  };
  store.upsertEntity({ id: ids.promo, projectId: p, kind: "rule", name: "Promo code" });
  store.upsertEntity({ id: ids.checkout, projectId: p, kind: "capability", name: "Checkout" });
  store.upsertEntity({ id: ids.order, projectId: p, kind: "data_object", name: "Order" });
  store.upsertEntity({ id: ids.settings, projectId: p, kind: "screen", name: "Settings" });
  store.addEdge({ projectId: p, from: ids.promo, to: ids.checkout, kind: "governs" });
  store.addEdge({ projectId: p, from: ids.checkout, to: ids.order, kind: "mutates" });
  return { p, ids };
}

test("neighbourhood expands hop by hop and stops at the limit", () => {
  const { p, ids } = seed();

  const oneHop = neighbourhood(p, [ids.promo], 1);
  assert.deepEqual(
    [...oneHop.entities.keys()].sort(),
    [ids.checkout, ids.promo].sort(),
    "one hop from promo reaches checkout only",
  );

  const twoHops = neighbourhood(p, [ids.promo], 2);
  assert.deepEqual(
    [...twoHops.entities.keys()].sort(),
    [ids.checkout, ids.order, ids.promo].sort(),
    "two hops reaches order",
  );
  assert.equal(
    twoHops.entities.has(ids.settings),
    false,
    "the disconnected settings screen is never reached",
  );
});

test("impactReport splits seeds from what they reach", () => {
  const { p, ids } = seed();
  const report = impactReport(p, [ids.promo], { hops: 2 });

  assert.deepEqual(report.changed.map((e) => e.name), ["Promo code"]);
  assert.deepEqual(
    report.affected.map((e) => e.name).sort(),
    ["Checkout", "Order"],
  );
  assert.equal(report.edges.length, 2);
});

test("listConflicts hydrates contradicts edges with names and a quote", () => {
  const { p, ids } = seed();
  store.upsertEntity({ id: "ent_summer", projectId: p, kind: "rule", name: "SUMMER code" });
  const edgeId = store.addEdge({
    projectId: p,
    from: "ent_summer",
    to: ids.promo,
    kind: "contradicts",
  });
  store.addSourceSpan({
    projectId: p,
    documentId: "doc1",
    targetKind: "edge",
    targetId: edgeId,
    quote: "SUMMER overrides all other promo codes.",
  });

  const conflicts = listConflicts(p);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].a.name, "SUMMER code");
  assert.equal(conflicts[0].b.name, "Promo code");
  assert.equal(conflicts[0].quote, "SUMMER overrides all other promo codes.");
});

test("a superseded edge drops out of the neighbourhood", () => {
  const { p, ids } = seed();
  // Retire promo -> checkout.
  const [promoEdge] = store
    .listEdges(p)
    .filter((e) => e.from === ids.promo && e.to === ids.checkout);
  store.supersedeEdge(promoEdge.id);

  const twoHops = neighbourhood(p, [ids.promo], 2);
  assert.deepEqual(
    [...twoHops.entities.keys()],
    [ids.promo],
    "with its only edge retired, promo reaches nothing",
  );
});
