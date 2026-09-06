import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEntities } from "./extractor.ts";
import type { Entity, ExtractedEntity } from "../types.ts";

type JsonArgs = { system: string; prompt: string };

/** A stand-in Llm that returns canned JSON and records how often it was asked. */
function scriptedLlm(responses: unknown[]) {
  const calls: JsonArgs[] = [];
  const llm = {
    async json(args: JsonArgs) {
      calls.push(args);
      const r = responses[calls.length - 1];
      if (r === undefined) {
        throw new Error(`scriptedLlm: no scripted response for call ${calls.length}`);
      }
      return r;
    },
  };
  return { llm: llm as unknown as Parameters<typeof resolveEntities>[0], calls };
}

function entity(partial: Partial<Entity> & Pick<Entity, "id" | "kind" | "name">): Entity {
  return {
    projectId: "p",
    summary: "",
    aliases: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

function extracted(
  partial: Partial<ExtractedEntity> & Pick<ExtractedEntity, "ref" | "kind" | "name">,
): ExtractedEntity {
  return { summary: "", quotes: [], ...partial };
}

test("resolve: everything is new when the model is empty, with no model call", async () => {
  const { llm, calls } = scriptedLlm([]);
  const out = await resolveEntities(llm, {
    extracted: [
      extracted({ ref: "E1", kind: "capability", name: "Checkout" }),
      extracted({ ref: "E2", kind: "rule", name: "Promo code stacking" }),
    ],
    known: [],
  });
  assert.deepEqual(
    out.map((d) => d.verdict),
    ["new", "new"],
  );
  assert.equal(calls.length, 0, "no adjudication call when there is nothing to match against");
});

test("resolve: an exact name+kind hit matches without asking the model", async () => {
  const { llm, calls } = scriptedLlm([]);
  const out = await resolveEntities(llm, {
    extracted: [extracted({ ref: "E1", kind: "capability", name: "Checkout" })],
    known: [entity({ id: "ent_checkout", kind: "capability", name: "checkout" })],
  });
  assert.equal(out[0].verdict, "match");
  assert.equal(out[0].entityId, "ent_checkout");
  assert.equal(calls.length, 0);
});

test("resolve: a genuinely unrelated name is new without a model call", async () => {
  const { llm, calls } = scriptedLlm([]);
  const out = await resolveEntities(llm, {
    extracted: [extracted({ ref: "E1", kind: "data_object", name: "Wishlist" })],
    known: [entity({ id: "ent_cart", kind: "capability", name: "Shopping cart" })],
  });
  assert.equal(out[0].verdict, "new");
  assert.equal(calls.length, 0);
});

test("resolve: a near-miss goes to the model, whose match verdict is honoured", async () => {
  const { llm, calls } = scriptedLlm([
    {
      decisions: [
        { ref: "E1", verdict: "match", entityId: "ent_promo", reason: "same concept" },
      ],
    },
  ]);
  const out = await resolveEntities(llm, {
    // "promotion code" ~ "promo code" scores in the blocking band but not high
    // enough to auto-merge, so it is exactly the case a model should adjudicate.
    extracted: [extracted({ ref: "E1", kind: "rule", name: "promotion code" })],
    known: [
      entity({ id: "ent_promo", kind: "rule", name: "promo code" }),
      entity({ id: "ent_cart", kind: "capability", name: "cart" }),
    ],
  });
  assert.equal(calls.length, 1, "the near-miss needed adjudication");
  assert.equal(out[0].verdict, "match");
  assert.equal(out[0].entityId, "ent_promo");
});

test("resolve: the model's ambiguous verdict is passed through, filtered to real candidates", async () => {
  const { llm } = scriptedLlm([
    {
      decisions: [
        {
          ref: "E1",
          verdict: "ambiguous",
          candidateIds: ["ent_promo", "ent_promotional", "ent_not_a_candidate"],
          reason: "could be either",
        },
      ],
    },
  ]);
  const out = await resolveEntities(llm, {
    extracted: [extracted({ ref: "E1", kind: "rule", name: "promotion code" })],
    known: [
      entity({ id: "ent_promo", kind: "rule", name: "promo code" }),
      entity({ id: "ent_promotional", kind: "rule", name: "promotional code" }),
    ],
  });
  assert.equal(out[0].verdict, "ambiguous");
  assert.deepEqual(
    [...(out[0].candidateIds ?? [])].sort(),
    ["ent_promo", "ent_promotional"],
  );
});

test("resolve: a model match to an id that was never a candidate is refused", async () => {
  const { llm } = scriptedLlm([
    {
      decisions: [
        { ref: "E1", verdict: "match", entityId: "ent_hallucinated", reason: "" },
      ],
    },
  ]);
  const out = await resolveEntities(llm, {
    extracted: [extracted({ ref: "E1", kind: "rule", name: "discount code" })],
    known: [entity({ id: "ent_promo", kind: "rule", name: "promo code" })],
  });
  assert.equal(out[0].verdict, "new", "an out-of-set id cannot be trusted as a match");
});

test("resolve: preserves input order and covers every ref exactly once", async () => {
  const { llm } = scriptedLlm([
    { decisions: [{ ref: "E2", verdict: "new", reason: "" }] },
  ]);
  const out = await resolveEntities(llm, {
    extracted: [
      extracted({ ref: "E1", kind: "capability", name: "Checkout" }), // exact match
      extracted({ ref: "E2", kind: "rule", name: "discount code" }), // to the model
      extracted({ ref: "E3", kind: "screen", name: "Totally novel screen" }), // new
    ],
    known: [entity({ id: "ent_checkout", kind: "capability", name: "Checkout" })],
  });
  assert.deepEqual(
    out.map((d) => d.ref),
    ["E1", "E2", "E3"],
  );
  assert.deepEqual(
    out.map((d) => d.verdict),
    ["match", "new", "new"],
  );
});
