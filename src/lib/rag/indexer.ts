import {
  countRagChildren,
  deleteOrphanChunks,
  listDocuments,
  listUnembeddedChildren,
  ragDocStates,
  ragStats,
  replaceDocumentChunks,
  saveEmbeddings,
} from "../store.ts";
import { chunkDocument, searchText, textHash } from "./chunker.ts";
import { normalize, toBlob } from "./vectors.ts";

/** Keeps a project's vectors small enough to hold in memory for a search. */
export const MAX_CHILDREN_PER_PROJECT = 10_000;

export type Embedder = (texts: string[], kind: "document" | "query") => Promise<number[][]>;

export interface SyncResult {
  indexed: number;
  skipped: { name: string; reason: string }[];
}

/**
 * Brings the chunk index in line with the project's documents. Local and free —
 * no model is called — so keyword search works the moment a document is uploaded.
 */
export function syncChunks(projectId: string): SyncResult {
  deleteOrphanChunks(projectId);
  const states = new Map(ragDocStates(projectId).map((s) => [s.document_id, s]));
  let total = countRagChildren(projectId);
  const result: SyncResult = { indexed: 0, skipped: [] };

  for (const doc of listDocuments(projectId)) {
    const hash = textHash(doc.text);
    const state = states.get(doc.id);
    if (state?.text_hash === hash) continue;

    const { parents, children } = chunkDocument(doc.id, doc.text);
    const existing = state?.child_count ?? 0;
    if (total - existing + children.length > MAX_CHILDREN_PER_PROJECT) {
      result.skipped.push({
        name: doc.name,
        reason: `Searching this project is capped at ${MAX_CHILDREN_PER_PROJECT.toLocaleString()} passages.`,
      });
      continue;
    }
    replaceDocumentChunks(projectId, doc.id, hash, parents, children);
    total += children.length - existing;
    result.indexed += 1;
  }
  return result;
}

export interface EmbedProgress {
  embedded: number;
  remaining: number;
  /** Why it stopped early, if it did. Work already saved is kept. */
  error: string | null;
}

const BATCH = 64;

const running = new Map<string, Promise<EmbedProgress>>();

/**
 * Embeds every passage that has no vector for `model` yet, a batch at a time,
 * saving as it goes so a failure or a deadline loses nothing. A second call for
 * the same project joins the one already running instead of paying twice.
 */
export function embedPending(
  projectId: string,
  model: string,
  embed: Embedder,
  options: { deadline?: number } = {},
): Promise<EmbedProgress> {
  const current = running.get(projectId);
  if (current) return current;
  const job = doEmbed(projectId, model, embed, options).finally(() => running.delete(projectId));
  running.set(projectId, job);
  return job;
}

async function doEmbed(
  projectId: string,
  model: string,
  embed: Embedder,
  options: { deadline?: number },
): Promise<EmbedProgress> {
  let embedded = 0;
  let error: string | null = null;
  try {
    for (;;) {
      const rows = listUnembeddedChildren(projectId, model, BATCH);
      if (rows.length === 0) break;
      const vectors = await embed(
        rows.map((r) => searchText(r.heading, r.text)),
        "document",
      );
      if (vectors.length !== rows.length || vectors.some((v) => v.length === 0)) {
        throw new Error("The embedding provider returned an incomplete response.");
      }
      saveEmbeddings(
        projectId,
        model,
        rows.map((row, i) => ({ id: row.id, vector: toBlob(normalize(vectors[i])) })),
      );
      embedded += rows.length;
      if (options.deadline && Date.now() > options.deadline) break;
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  const stats = ragStats(projectId, model);
  return { embedded, remaining: stats.passages - stats.embedded, error };
}
