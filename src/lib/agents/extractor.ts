// Relative, extension-qualified imports so this module (and its tests) run
// under the node test runner, which does not resolve the "@/" alias. Only
// import-free modules and type-only imports are pulled in here for the same
// reason.
import type { Llm } from "../llm.ts";
import { extractionSchema, resolutionSchema } from "./schemas.ts";
import { crossCandidates, similarity } from "./similarity.ts";
import type {
  Entity,
  ExtractedEntity,
  ExtractionResult,
  ResolutionDecision,
} from "../types.ts";

const EXTRACT_SYSTEM = `You are building a structured model of a software product from its documentation.

Given one document, extract the product's building blocks and how they relate. This is not a summary and
not a requirement list — it is the parts inventory.

Entities. Pull out every distinct thing the product HAS or the document defines, and classify each:
- capability — something a user can do (place an order, invite a teammate)
- screen — a page, view, dialog or surface
- actor — a role or type of user or external system
- data_object — a thing the system stores (order, invoice, discount code)
- state — a status a data_object or session can be in (pending, archived, locked)
- rule — a policy the system enforces (a code overrides all others; refunds within 30 days)
- event — something that happens and triggers behaviour (payment captured, session expires)
- constraint — a non-functional limit (p95 under 200ms; WCAG AA)

Rules for entities:
- Use the product's own name. If the document says "promo code", the name is "promo code", not "Discount".
- One entity per real thing. Do not split a thing into one entity per mention.
- summary is one plain sentence.
- quotes are one to three VERBATIM spans from the document — copied exactly, not paraphrased.

Edges. Connect the entities with typed relationships, using each entity's ref:
- governs — a rule/constraint controls a capability, data_object or state
- mutates — a capability or event changes a data_object or state
- precedes — one event/state must come before another
- requires — one thing depends on another existing or being true
- belongs_to — a screen/field/state is part of a capability or data_object
- contradicts — two statements cannot both hold
Only add an edge the document actually supports. Put a verbatim quote on each, and a confidence: ~1.0 if
stated outright, ~0.6 if a fair inference, ~0.3 if a guess.

Completeness matters more than brevity. A missed entity is a blind spot in every downstream check.`;

const RESOLVE_SYSTEM = `You are merging a freshly parsed document into a product model that already exists.

For each newly extracted entity you are given a small set of candidate entities from the existing model that
have textually similar names. Decide, per extracted entity:
- match — it is the same real thing as exactly one candidate. Give that candidate's id.
- new — none of the candidates is the same thing (similar words, different concept, or no candidates at all).
- ambiguous — the evidence given cannot settle it. List the candidate ids that remain in play.

Judge on meaning, not spelling. "promo code" and "discount code" are very likely the same thing; "cart" and
"cart limit" are not — one is a capability, the other a rule about it. Prefer "new" over a weak "match":
a wrong merge corrupts every count downstream, and an unnecessary "ambiguous" just makes a person adjudicate
something obvious. Reserve "ambiguous" for genuine ties.`;

/** Wrap each document so the model can cite it by name. */
function frame(document: { name: string; text: string }): string {
  return `<document name="${document.name}">\n${document.text}\n</document>`;
}

export async function extractModel(
  llm: Llm,
  document: { name: string; text: string },
  onToken?: (delta: string) => void,
): Promise<ExtractionResult> {
  const result = await llm.json<ExtractionResult>({
    system: EXTRACT_SYSTEM,
    prompt: `Extract the product model from this document.\n\n${frame(document)}`,
    schema: extractionSchema as unknown as Record<string, unknown>,
    onToken,
  });
  return {
    entities: result.entities ?? [],
    edges: result.edges ?? [],
  };
}

/** A trigram score at or above this, with the same kind, is merged without asking a model. */
const AUTO_MATCH = 0.9;
/** Below this, nothing is close enough to be worth a model's time. */
const BLOCK_THRESHOLD = 0.4;

export interface ResolveInput {
  extracted: ExtractedEntity[];
  known: Entity[];
}

/**
 * Decide, for each extracted entity, whether it is one already in the model,
 * genuinely new, or too close to call. Cheap trigram blocking picks the
 * candidates; a single model call adjudicates only the ones that are neither an
 * obvious match nor an obvious miss.
 */
export async function resolveEntities(
  llm: Llm,
  { extracted, known }: ResolveInput,
  onToken?: (delta: string) => void,
): Promise<ResolutionDecision[]> {
  if (extracted.length === 0) return [];
  if (known.length === 0) {
    return extracted.map((e) => ({
      ref: e.ref,
      verdict: "new" as const,
      reason: "The model has no entities yet.",
    }));
  }

  const byName = new Map(known.map((k) => [k.name.toLowerCase(), k]));
  const decisions = new Map<string, ResolutionDecision>();
  const needsModel: {
    entity: ExtractedEntity;
    candidates: Entity[];
  }[] = [];

  const matches = crossCandidates(
    extracted,
    known,
    (e) => e.name,
    (k) => [k.name, ...k.aliases].join(" "),
    { threshold: BLOCK_THRESHOLD, perLeft: 5 },
  );
  const candidatesByRef = new Map<string, Entity[]>();
  for (const m of matches) {
    const list = candidatesByRef.get(m.left.ref) ?? [];
    if (!list.some((c) => c.id === m.right.id)) list.push(m.right);
    candidatesByRef.set(m.left.ref, list);
  }

  for (const entity of extracted) {
    // An exact name hit of the same kind is not worth a model call.
    const exact = byName.get(entity.name.toLowerCase());
    if (exact && exact.kind === entity.kind) {
      decisions.set(entity.ref, {
        ref: entity.ref,
        verdict: "match",
        entityId: exact.id,
        reason: "Exact name and kind.",
      });
      continue;
    }

    const candidates = candidatesByRef.get(entity.ref) ?? [];
    if (candidates.length === 0) {
      decisions.set(entity.ref, {
        ref: entity.ref,
        verdict: "new",
        reason: "No existing entity has a similar name.",
      });
      continue;
    }

    const top = candidates
      .map((c) => ({ c, s: similarity(entity.name, c.name) }))
      .sort((a, b) => b.s - a.s)[0];
    if (top && top.s >= AUTO_MATCH && top.c.kind === entity.kind) {
      decisions.set(entity.ref, {
        ref: entity.ref,
        verdict: "match",
        entityId: top.c.id,
        reason: `Near-identical name (${top.s.toFixed(2)}) and same kind.`,
      });
      continue;
    }

    needsModel.push({ entity, candidates });
  }

  if (needsModel.length > 0) {
    const block = needsModel
      .map(({ entity, candidates }) => {
        const cand = candidates
          .map(
            (c) =>
              `    - id ${c.id} · ${c.kind} · "${c.name}"${
                c.aliases.length ? ` (aka ${c.aliases.join(", ")})` : ""
              } — ${c.summary || "no summary"}`,
          )
          .join("\n");
        return `  ${entity.ref}: ${entity.kind} · "${entity.name}" — ${entity.summary}\n  candidates:\n${cand}`;
      })
      .join("\n\n");

    const raw = await llm.json<{ decisions: ResolutionDecision[] }>({
      system: RESOLVE_SYSTEM,
      prompt: `Resolve each of these ${needsModel.length} extracted entities against its candidates.\n\n${block}`,
      schema: resolutionSchema as unknown as Record<string, unknown>,
      onToken,
    });

    const validIds = new Set(known.map((k) => k.id));
    for (const { entity, candidates } of needsModel) {
      const said = (raw.decisions ?? []).find((d) => d.ref === entity.ref);
      const candIds = new Set(candidates.map((c) => c.id));

      if (
        said?.verdict === "match" &&
        said.entityId &&
        validIds.has(said.entityId) &&
        candIds.has(said.entityId)
      ) {
        decisions.set(entity.ref, {
          ref: entity.ref,
          verdict: "match",
          entityId: said.entityId,
          reason: said.reason || "Model matched it to an existing entity.",
        });
      } else if (said?.verdict === "ambiguous") {
        const ids = (said.candidateIds ?? [])
          .filter((id) => candIds.has(id))
          .slice(0, 5);
        decisions.set(entity.ref, {
          ref: entity.ref,
          verdict: "ambiguous",
          candidateIds: ids.length ? ids : candidates.map((c) => c.id),
          reason: said.reason || "Model could not tell these apart.",
        });
      } else {
        // Missing, malformed, or an explicit "new" — all mean: do not merge.
        decisions.set(entity.ref, {
          ref: entity.ref,
          verdict: "new",
          reason: said?.reason || "Model saw no match among the candidates.",
        });
      }
    }
  }

  // Preserve input order.
  return extracted.map(
    (e) =>
      decisions.get(e.ref) ?? {
        ref: e.ref,
        verdict: "new" as const,
        reason: "Unresolved; treated as new.",
      },
  );
}
