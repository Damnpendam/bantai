import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bantai-ingest-"));
process.env.BANTAI_DATA_DIR = tmp;
const store = await import("./store.ts");
const { ingestDocument } = await import("./ingest.ts");

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Returns the same extraction every call, and records the call count. */
function fixedExtraction(result: unknown) {
  const calls: { system: string }[] = [];
  const llm = {
    async json(args: { system: string }) {
      calls.push({ system: args.system });
      return result;
    },
  };
  return {
    llm: llm as unknown as NonNullable<Parameters<typeof ingestDocument>[1]>["llm"],
    calls,
  };
}

/** Returns queued responses in order — one per json() call. */
function queuedLlm(responses: unknown[]) {
  const calls: { system: string }[] = [];
  const llm = {
    async json(args: { system: string }) {
      calls.push({ system: args.system });
      const r = responses[calls.length - 1];
      if (r === undefined) {
        throw new Error(`queuedLlm: no response for call ${calls.length}`);
      }
      return r;
    },
  };
  return {
    llm: llm as unknown as NonNullable<Parameters<typeof ingestDocument>[1]>["llm"],
    calls,
  };
}

const EXTRACTION = {
  entities: [
    {
      ref: "E1",
      kind: "capability",
      name: "Checkout",
      summary: "Pay for the cart",
      quotes: ["The checkout flow lets a signed-in user pay."],
    },
    {
      ref: "E2",
      kind: "rule",
      name: "Promo code",
      summary: "A single promo code applies per order",
      quotes: ["Only one promo code may be applied to an order."],
    },
    {
      ref: "E3",
      kind: "data_object",
      name: "Order",
      summary: "A submitted cart",
      quotes: ["An order is created when checkout completes."],
    },
  ],
  edges: [
    {
      from: "E2",
      to: "E1",
      kind: "governs",
      quote: "Only one promo code may be applied.",
      confidence: 1,
    },
    {
      from: "E1",
      to: "E3",
      kind: "mutates",
      quote: "An order is created when checkout completes.",
      confidence: 0.9,
    },
    {
      // Too weak for canon — belongs in the pending worklist.
      from: "E3",
      to: "E2",
      kind: "requires",
      quote: "",
      confidence: 0.3,
    },
  ],
};

function seedDocument(): { projectId: string; documentId: string } {
  const projectId = randomUUID();
  store.createProject(projectId, "Shop");
  const documentId = randomUUID();
  store.addDocument({
    id: documentId,
    project_id: projectId,
    name: "prd.md",
    bytes: 100,
    text: "irrelevant — the model is scripted",
  });
  return { projectId, documentId };
}

test("first ingest populates entities, edges, provenance and the pending queue", async () => {
  const { projectId, documentId } = seedDocument();
  const { llm, calls } = fixedExtraction(EXTRACTION);

  const summary = await ingestDocument(documentId, { llm });

  assert.equal(summary.entitiesCreated, 3);
  assert.equal(summary.entitiesMatched, 0);
  assert.equal(summary.edgesAdded, 2, "two confident edges");
  assert.equal(summary.edgesPending, 1, "the 0.3-confidence edge was held back");
  assert.equal(calls.length, 1, "empty model needs no resolution call");

  assert.equal(store.listEntities(projectId).length, 3);
  assert.equal(store.listEdges(projectId).length, 2);

  const pending = store.listPendingFacts(projectId);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].kind, "low_confidence_edge");

  // Provenance: every entity and every stored edge carries at least one span.
  for (const e of store.listEntities(projectId)) {
    assert.ok(store.spansFor("entity", e.id).length >= 1, `entity ${e.name} has a span`);
  }
  for (const e of store.listEdges(projectId)) {
    assert.ok(store.spansFor("edge", e.id).length >= 1, "edge has a span");
  }

  const ingest = store.getDocumentIngest(documentId);
  assert.ok(ingest);
  assert.equal(ingest.entityCount, 3);
});

test("a second ingest without force is skipped", async () => {
  const { documentId } = seedDocument();
  const { llm } = fixedExtraction(EXTRACTION);
  await ingestDocument(documentId, { llm });

  const again = await ingestDocument(documentId, { llm });
  assert.equal(again.skipped, true);
  assert.equal(again.entitiesCreated, 0);
});

test("re-ingesting the same document is stable: nothing new is created", async () => {
  const { projectId, documentId } = seedDocument();
  const { llm } = fixedExtraction(EXTRACTION);

  await ingestDocument(documentId, { llm });
  const entityIds = store.listEntities(projectId).map((e) => e.id).sort();
  const edgeCount = store.listEdges(projectId).length;

  const redo = await ingestDocument(documentId, { llm, force: true });

  assert.equal(redo.entitiesCreated, 0, "no new entities");
  assert.equal(redo.entitiesMatched, 3, "all three matched their existing selves");
  assert.equal(redo.edgesAdded, 0, "no new edges");
  assert.equal(redo.edgesDuplicate, 2, "both confident edges recognised as already present");

  assert.deepEqual(
    store.listEntities(projectId).map((e) => e.id).sort(),
    entityIds,
    "entity ids are unchanged",
  );
  assert.equal(store.listEdges(projectId).length, edgeCount, "edge count is unchanged");
  assert.equal(
    store.listPendingFacts(projectId).length,
    1,
    "the pending queue did not grow",
  );
});

test("a changed document retires what it no longer says and adds what it now says", async () => {
  const { projectId, documentId } = seedDocument();

  // v2 keeps Promo -> Checkout, drops Checkout -> Order, and introduces a
  // Gift card rule that also governs Checkout.
  const V2 = {
    entities: [
      ...EXTRACTION.entities,
      {
        ref: "E4",
        kind: "rule",
        name: "Gift card",
        summary: "A gift card can be redeemed at checkout",
        quotes: ["A gift card may be redeemed during checkout."],
      },
    ],
    edges: [
      {
        from: "E2",
        to: "E1",
        kind: "governs",
        quote: "Only one promo code may be applied.",
        confidence: 1,
      },
      {
        from: "E4",
        to: "E1",
        kind: "governs",
        quote: "A gift card may be redeemed during checkout.",
        confidence: 1,
      },
    ],
  };

  const first = queuedLlm([EXTRACTION]);
  await ingestDocument(documentId, { llm: first.llm });
  assert.equal(store.listEdges(projectId).length, 2);

  const second = queuedLlm([V2]);
  const redo = await ingestDocument(documentId, { llm: second.llm, force: true });

  assert.equal(redo.entitiesCreated, 1, "Gift card is new");
  assert.equal(redo.edgesAdded, 1, "Gift card -> Checkout");
  assert.equal(redo.supersededEdges.length, 1, "Checkout -> Order is no longer asserted");
  assert.equal(redo.supersededEdges[0].kind, "mutates");

  const live = store.listEdges(projectId);
  assert.equal(live.length, 2, "Promo -> Checkout and Gift card -> Checkout");
  assert.equal(
    live.some((e) => e.kind === "mutates"),
    false,
    "the retired edge is gone from the current view",
  );
  assert.equal(
    store.listAllEdges(projectId).filter((e) => e.validTo !== null).length,
    1,
    "but it survives in history with a closed window",
  );

  // Its endpoints show up as changed, so impact traversal will start from them.
  const order = store.listEntities(projectId).find((e) => e.name === "Order")!;
  assert.ok(redo.changedEntityIds.includes(order.id));
});
