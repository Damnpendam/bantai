import { randomUUID } from "node:crypto";
// Relative, extension-qualified imports so ingest.test.ts runs under the node
// test runner. The production LLM wiring (llm-config -> settings -> providers)
// is loaded lazily below, only when no Llm was injected, so a test never pulls
// in the "@/"-aliased chain the runner cannot resolve.
import type { Llm } from "./llm.ts";
import { extractModel, resolveEntities } from "./agents/extractor.ts";
import {
  addAlias,
  addEdge,
  addPendingFact,
  addSourceSpan,
  clearDocumentIngest,
  clearPendingFactsForDocument,
  findLiveEdge,
  getDocument,
  getDocumentIngest,
  listDocuments,
  listEntities,
  markDocumentIngested,
  upsertEntity,
  type DocumentRow,
} from "./store.ts";
import type {
  Entity,
  ExtractedEdge,
  ExtractedEntity,
  ResolutionDecision,
} from "./types.ts";

/** An edge the model was not sure about is not worth trusting in canon. */
const MIN_EDGE_CONFIDENCE = 0.5;

export interface IngestSummary {
  documentId: string;
  documentName: string;
  skipped: boolean;
  entitiesCreated: number;
  entitiesMatched: number;
  entitiesAmbiguous: number;
  edgesAdded: number;
  edgesDuplicate: number;
  edgesPending: number;
}

function nameKey(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Resolve one extracted edge endpoint — which the model was asked to give as an
 * entity `ref` but may give as a name — to a canonical entity id.
 */
function endpointId(
  raw: string,
  refToId: Map<string, string>,
  extractedByName: Map<string, ExtractedEntity>,
  knownByName: Map<string, Entity>,
): string | null {
  if (refToId.has(raw)) return refToId.get(raw)!;
  const byExtracted = extractedByName.get(nameKey(raw));
  if (byExtracted && refToId.has(byExtracted.ref)) {
    return refToId.get(byExtracted.ref)!;
  }
  const known = knownByName.get(nameKey(raw));
  return known ? known.id : null;
}

async function ingestOne(
  document: DocumentRow,
  force: boolean,
  llmOverride?: Llm,
): Promise<IngestSummary> {
  const base: IngestSummary = {
    documentId: document.id,
    documentName: document.name,
    skipped: false,
    entitiesCreated: 0,
    entitiesMatched: 0,
    entitiesAmbiguous: 0,
    edgesAdded: 0,
    edgesDuplicate: 0,
    edgesPending: 0,
  };

  if (getDocumentIngest(document.id) && !force) {
    return { ...base, skipped: true };
  }
  if (force) {
    clearDocumentIngest(document.id);
    // The worklist is a view of the latest parse, not a log of every parse.
    clearPendingFactsForDocument(document.id);
  }

  const projectId = document.project_id;
  const llm =
    llmOverride ??
    (await import("./llm-config.ts")).makeLlm(32000, undefined, "low");

  const extraction = await extractModel(llm, {
    name: document.name,
    text: document.text,
  });
  const known = listEntities(projectId);
  const decisions = await resolveEntities(llm, {
    extracted: extraction.entities,
    known,
  });
  const decisionByRef = new Map<string, ResolutionDecision>(
    decisions.map((d) => [d.ref, d]),
  );

  const knownByName = new Map(known.map((k) => [nameKey(k.name), k]));
  for (const k of known) {
    for (const alias of k.aliases) knownByName.set(nameKey(alias), k);
  }
  const extractedByName = new Map(
    extraction.entities.map((e) => [nameKey(e.name), e]),
  );
  const knownById = new Map(known.map((k) => [k.id, k]));

  // Pass 1: entities.
  const refToId = new Map<string, string>();
  for (const entity of extraction.entities) {
    const decision = decisionByRef.get(entity.ref);

    if (decision?.verdict === "match" && decision.entityId) {
      refToId.set(entity.ref, decision.entityId);
      base.entitiesMatched += 1;
      const target = knownById.get(decision.entityId);
      if (
        target &&
        nameKey(target.name) !== nameKey(entity.name) &&
        !target.aliases.some((a) => nameKey(a) === nameKey(entity.name))
      ) {
        addAlias(decision.entityId, entity.name, document.id);
      }
      recordEntitySpans(projectId, document.id, decision.entityId, entity);
      continue;
    }

    if (decision?.verdict === "ambiguous") {
      base.entitiesAmbiguous += 1;
      addPendingFact({
        projectId,
        documentId: document.id,
        kind: "ambiguous_alias",
        reason: decision.reason,
        payload: {
          extracted: { kind: entity.kind, name: entity.name, summary: entity.summary },
          candidateIds: decision.candidateIds ?? [],
          quotes: entity.quotes,
        },
      });
      continue;
    }

    // "new" (or unresolved): create it.
    const id = `ent_${randomUUID()}`;
    upsertEntity({
      id,
      projectId,
      kind: entity.kind,
      name: entity.name,
      summary: entity.summary,
    });
    refToId.set(entity.ref, id);
    base.entitiesCreated += 1;
    recordEntitySpans(projectId, document.id, id, entity);
  }

  // Pass 2: edges.
  for (const edge of extraction.edges) {
    const from = endpointId(edge.from, refToId, extractedByName, knownByName);
    const to = endpointId(edge.to, refToId, extractedByName, knownByName);

    if (!from || !to || from === to) {
      base.edgesPending += 1;
      addPendingFact({
        projectId,
        documentId: document.id,
        kind: from && to ? "low_confidence_edge" : "unresolved_entity",
        reason:
          from && to
            ? "Self-referential edge."
            : "An endpoint could not be resolved to an entity.",
        payload: pendingEdgePayload(edge),
      });
      continue;
    }

    if (edge.confidence < MIN_EDGE_CONFIDENCE) {
      base.edgesPending += 1;
      addPendingFact({
        projectId,
        documentId: document.id,
        kind: "low_confidence_edge",
        reason: `Model confidence ${edge.confidence.toFixed(2)} is below ${MIN_EDGE_CONFIDENCE}.`,
        payload: { ...pendingEdgePayload(edge), from, to },
      });
      continue;
    }

    const existing = findLiveEdge(projectId, from, to, edge.kind);
    if (existing) {
      base.edgesDuplicate += 1;
      if (edge.quote) {
        addSourceSpan({
          projectId,
          documentId: document.id,
          targetKind: "edge",
          targetId: existing.id,
          quote: edge.quote,
        });
      }
      continue;
    }

    const id = addEdge({
      projectId,
      from,
      to,
      kind: edge.kind,
      assertedByDocument: document.id,
      confidence: edge.confidence,
    });
    base.edgesAdded += 1;
    if (edge.quote) {
      addSourceSpan({
        projectId,
        documentId: document.id,
        targetKind: "edge",
        targetId: id,
        quote: edge.quote,
      });
    }
  }

  markDocumentIngested({
    documentId: document.id,
    projectId,
    entityCount: base.entitiesCreated + base.entitiesMatched,
    edgeCount: base.edgesAdded,
    pendingCount: base.entitiesAmbiguous + base.edgesPending,
  });

  return base;
}

function recordEntitySpans(
  projectId: string,
  documentId: string,
  entityId: string,
  entity: ExtractedEntity,
): void {
  for (const quote of entity.quotes.slice(0, 3)) {
    if (!quote.trim()) continue;
    addSourceSpan({
      projectId,
      documentId,
      targetKind: "entity",
      targetId: entityId,
      quote,
    });
  }
}

function pendingEdgePayload(edge: ExtractedEdge) {
  return {
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    quote: edge.quote,
    confidence: edge.confidence,
  };
}

interface IngestOptions {
  force?: boolean;
  /** Inject a scripted Llm for tests; production builds one from settings. */
  llm?: Llm;
}

/** Ingest one document into its project's product model. */
export async function ingestDocument(
  documentId: string,
  { force = false, llm }: IngestOptions = {},
): Promise<IngestSummary> {
  const document = getDocument(documentId);
  if (!document) throw new Error("No such document.");
  return ingestOne(document, force, llm);
}

/**
 * Ingest every document in a project. Sequential on purpose: each document is
 * resolved against the entities the previous ones just created.
 */
export async function ingestProject(
  projectId: string,
  { force = false, llm }: IngestOptions = {},
): Promise<IngestSummary[]> {
  const out: IngestSummary[] = [];
  for (const document of listDocuments(projectId)) {
    out.push(await ingestOne(document, force, llm));
  }
  return out;
}
