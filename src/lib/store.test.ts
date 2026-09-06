import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the store at a throwaway database before it is imported.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bantai-store-"));
process.env.BANTAI_DATA_DIR = tmp;
const store = await import("./store.ts");

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function seedRules(projectId: string): void {
  store.upsertEntity({ id: "cart", projectId, kind: "capability", name: "Cart" });
  store.upsertEntity({ id: "spring", projectId, kind: "rule", name: "SPRING code" });
  store.upsertEntity({ id: "summer", projectId, kind: "rule", name: "SUMMER code" });
}

test("edges: an asOf timestamp returns the model as it stood then", () => {
  const p = "asof";
  seedRules(p);

  const t1 = 1_000;
  const t2 = 2_000;
  const springEdge = store.addEdge({
    projectId: p,
    from: "spring",
    to: "cart",
    kind: "governs",
    validFrom: t1,
  });
  // A later document says SUMMER replaces SPRING.
  store.supersedeEdge(springEdge, t2);
  const summerEdge = store.addEdge({
    projectId: p,
    from: "summer",
    to: "cart",
    kind: "governs",
    validFrom: t2,
    supersedes: springEdge,
  });

  const before = store.listEdges(p, { asOf: 1_500 });
  assert.deepEqual(
    before.map((e) => e.id),
    [springEdge],
    "at t=1500 only the SPRING edge was in force",
  );

  const after = store.listEdges(p, { asOf: 2_500 });
  assert.deepEqual(
    after.map((e) => e.id),
    [summerEdge],
    "at t=2500 the SPRING edge has been superseded and SUMMER is in force",
  );

  // The default asOf is now, so the current view matches the t=2500 view.
  assert.deepEqual(
    store.listEdges(p).map((e) => e.id),
    [summerEdge],
  );
});

test("edges: supersede closes the window and records the replacement link", () => {
  const p = "supersede";
  seedRules(p);
  const old = store.addEdge({ projectId: p, from: "spring", to: "cart", kind: "governs" });
  const replacement = store.addEdge({
    projectId: p,
    from: "summer",
    to: "cart",
    kind: "governs",
  });
  store.supersedeEdge(old, Date.now(), replacement);

  const all = store.listAllEdges(p);
  const oldRow = all.find((e) => e.id === old)!;
  const newRow = all.find((e) => e.id === replacement)!;
  assert.ok(oldRow.validTo !== null, "the superseded edge has a closed validity window");
  assert.ok(oldRow.supersededAt !== null);
  assert.equal(newRow.supersedes, old, "the replacement points back at what it replaced");
  assert.equal(newRow.validTo, null, "the replacement is still in force");

  // The superseded edge is gone from the current view but kept in history.
  assert.equal(store.listEdges(p).some((e) => e.id === old), false);
  assert.equal(all.length, 2);
});

test("requirements: promoted rows are project-scoped and honour asOf", () => {
  const p = "reqs";
  const r1 = store.addRequirement({
    projectId: p,
    ref: "REQ-001",
    text: "Cart holds at most 50 items",
    validFrom: 1_000,
  });
  store.addRequirement({
    projectId: "other-project",
    ref: "REQ-001",
    text: "unrelated",
    validFrom: 1_000,
  });

  const live = store.listRequirements(p);
  assert.equal(live.length, 1);
  assert.equal(live[0].id, r1);
  assert.equal(live[0].ref, "REQ-001");

  assert.equal(store.listRequirements(p, { asOf: 500 }).length, 0, "not yet valid at t=500");
});

test("requirements: a superseded set stays in history but leaves the current view", () => {
  // Mirrors what the backfill produces: an earlier run's requirement set is
  // valid only until the next run re-derived it.
  const p = "req-history";
  const old = store.addRequirement({
    projectId: p,
    ref: "REQ-001",
    text: "old: cart holds 50",
    validFrom: 1_000,
  });
  store.supersedeRequirement(old, 2_000);
  const current = store.addRequirement({
    projectId: p,
    ref: "REQ-001",
    text: "new: cart holds 100",
    validFrom: 2_000,
  });

  assert.deepEqual(
    store.listRequirements(p).map((r) => r.id),
    [current],
    "the current view is just the latest set",
  );
  assert.equal(
    store
      .listRequirements(p, { asOf: 1_500 })
      .some((r) => r.text === "old: cart holds 50"),
    true,
    "time-travel still sees the old set",
  );
});

test("entities: upsert is idempotent and aliases dedupe", () => {
  const p = "ents";
  store.upsertEntity({ id: "checkout", projectId: p, kind: "capability", name: "Checkout" });
  store.upsertEntity({
    id: "checkout",
    projectId: p,
    kind: "capability",
    name: "Checkout flow",
    summary: "pay for the cart",
  });
  store.addAlias("checkout", "basket checkout");
  store.addAlias("checkout", "basket checkout"); // duplicate, ignored

  const list = store.listEntities(p);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Checkout flow");
  assert.equal(list[0].summary, "pay for the cart");
  assert.deepEqual(list[0].aliases, ["basket checkout"]);
});

test("pending facts: open worklist, then resolved", () => {
  const p = "pending";
  const id = store.addPendingFact({
    projectId: p,
    kind: "ambiguous_alias",
    payload: { candidates: ["cart", "basket"] },
    reason: "two entities share a name",
  });
  assert.equal(store.listPendingFacts(p).length, 1);
  assert.deepEqual(store.listPendingFacts(p)[0].payload, {
    candidates: ["cart", "basket"],
  });

  store.resolvePendingFact(id, "resolved");
  assert.equal(store.listPendingFacts(p).length, 0, "resolved items leave the open list");
  assert.equal(store.listPendingFacts(p, "all").length, 1);
});
