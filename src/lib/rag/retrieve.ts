import { getRagParents, listDocumentNames, loadRagChildren, ragVersion } from "../store.ts";
import { Bm25Index, fuse, type Scored } from "./bm25.ts";
import { searchText } from "./chunker.ts";
import { dot, fromBlob, normalize } from "./vectors.ts";

export interface Passage {
  id: string;
  documentId: string;
  documentName: string;
  heading: string;
  text: string;
  score: number;
  via: "keyword" | "semantic" | "both";
}

export interface SearchOutcome {
  passages: Passage[];
  mode: "hybrid" | "keyword";
  /** Set when the semantic half was wanted but failed, so the answer says so. */
  degraded: string | null;
}

export interface SearchOptions {
  k?: number;
  /** Embedding model the project's vectors should come from; null means keyword only. */
  model?: string | null;
  embedQuery?: (query: string) => Promise<number[]>;
}

/** Cosine below this is noise for unit vectors from a modern embedding model. */
const DENSE_MIN = 0.25;
const CANDIDATES = 40;

interface Built {
  version: number;
  model: string | null;
  childParent: Map<string, string>;
  bm25: Bm25Index;
  dense: { id: string; vector: Float32Array }[];
}

const CACHE_SIZE = 4;
const cache = new Map<string, Built>();

function build(projectId: string, model: string | null): Built {
  const version = ragVersion(projectId);
  const key = `${projectId}\u0000${model ?? ""}`;
  const hit = cache.get(key);
  if (hit && hit.version === version) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const rows = loadRagChildren(projectId);
  const built: Built = {
    version,
    model,
    childParent: new Map(rows.map((r) => [r.id, r.parent_id])),
    bm25: new Bm25Index(rows.map((r) => ({ id: r.id, text: searchText(r.heading, r.text) }))),
    dense: rows
      .filter((r) => model && r.embed_model === model && r.embedding)
      .map((r) => ({ id: r.id, vector: fromBlob(r.embedding as Uint8Array) })),
  };
  cache.set(key, built);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return built;
}

function topDense(built: Built, query: Float32Array): Scored[] {
  const scored: Scored[] = [];
  for (const { id, vector } of built.dense) {
    const score = dot(query, vector);
    if (score >= DENSE_MIN) scored.push({ id, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, CANDIDATES);
}

/**
 * Hybrid search: BM25 and (when vectors exist) cosine similarity, fused by rank.
 * Children are what match; the parent each one came from is what comes back, so
 * the reader gets a section rather than a fragment.
 */
export async function search(
  projectId: string,
  query: string,
  options: SearchOptions = {},
): Promise<SearchOutcome> {
  const k = options.k ?? 6;
  const model = options.model ?? null;
  const built = build(projectId, model);

  const lexical = built.bm25.search(query, CANDIDATES);
  let dense: Scored[] = [];
  let degraded: string | null = null;
  if (model && options.embedQuery && built.dense.length > 0) {
    try {
      dense = topDense(built, normalize(await options.embedQuery(query)));
    } catch (cause) {
      degraded = cause instanceof Error ? cause.message : String(cause);
    }
  }

  const lexicalIds = new Set(lexical.map((s) => s.id));
  const denseIds = new Set(dense.map((s) => s.id));
  const fused = fuse([lexical.map((s) => s.id), dense.map((s) => s.id)]);

  // A parent is as good as its best child.
  const parents = new Map<string, { score: number; lexical: boolean; dense: boolean }>();
  for (const { id, score } of fused) {
    const parentId = built.childParent.get(id);
    if (!parentId) continue;
    const entry = parents.get(parentId) ?? { score: 0, lexical: false, dense: false };
    entry.score = Math.max(entry.score, score);
    entry.lexical ||= lexicalIds.has(id);
    entry.dense ||= denseIds.has(id);
    parents.set(parentId, entry);
  }

  const ranked = [...parents]
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
    .slice(0, k);
  const rows = new Map(
    getRagParents(
      projectId,
      ranked.map(([id]) => id),
    ).map((p) => [p.id, p]),
  );
  const names = new Map(listDocumentNames(projectId).map((d) => [d.id, d.name]));

  const passages: Passage[] = [];
  for (const [id, entry] of ranked) {
    const row = rows.get(id);
    if (!row) continue;
    passages.push({
      id,
      documentId: row.document_id,
      documentName: names.get(row.document_id) ?? "Unknown document",
      heading: row.heading,
      text: row.text,
      score: entry.score,
      via: entry.lexical && entry.dense ? "both" : entry.dense ? "semantic" : "keyword",
    });
  }

  const usedDense = Boolean(model && options.embedQuery && built.dense.length > 0 && !degraded);
  return { passages, mode: usedDense ? "hybrid" : "keyword", degraded };
}
