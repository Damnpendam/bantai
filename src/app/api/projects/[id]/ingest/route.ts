import { NextResponse } from "next/server";
import { listDocuments, listEntities, listEdges, listPendingFacts } from "@/lib/store";
import {
  noAccessMessage,
  quotaProblem,
  recordUsage,
  resolveModelAccess,
} from "@/lib/settings";
import { makeLlm } from "@/lib/llm-config";
import { ingestDocument, ingestProject } from "@/lib/ingest";
import { impactReport, listConflicts, listEdgesHydrated } from "@/lib/impact";
import {
  api,
  HttpError,
  jsonBody,
  requireDocument,
  requireProject,
  requireUser,
} from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
// Extraction + resolution is a couple of model calls per document.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/** The product model as it currently stands for this project. */
export const GET = api(async (_request: Request, { params }: Params) => {
  const ctx = await requireUser();
  const { id } = await params;
  requireProject(ctx, id);
  return NextResponse.json({
    entities: listEntities(id),
    edges: listEdgesHydrated(id),
    pending: listPendingFacts(id),
    conflicts: listConflicts(id),
  });
});

export const POST = api(async (request: Request, { params }: Params) => {
  const ctx = await requireUser();
  const { id } = await params;
  const project = requireProject(ctx, id);
  const workspaceId = project.workspace_id!;

  if (!rateLimit(`ingest:${ctx.user.id}`, 10, 10 * 60 * 1000).ok) {
    throw new HttpError(429, "Too many model builds in a short time. Wait a few minutes.");
  }
  const access = resolveModelAccess(workspaceId);
  if (!access) throw new HttpError(400, noAccessMessage(workspaceId));
  if (listDocuments(id).length === 0) {
    throw new HttpError(400, "Upload at least one document first.");
  }

  const body = await jsonBody<{ force?: unknown; documentId?: unknown }>(request).catch(
    () => ({}) as { force?: unknown; documentId?: unknown },
  );
  const force = body.force === true;
  const documentId = typeof body.documentId === "string" ? body.documentId : null;
  // A document id from the body must belong to this project, like any other id.
  if (documentId && requireDocument(ctx, documentId).document.project_id !== id) {
    throw new HttpError(404, "Not found.");
  }

  const overQuota = quotaProblem(workspaceId, access, "ingest");
  if (overQuota) throw new HttpError(429, overQuota);

  const llm = makeLlm(access, 32000, undefined, "low");
  const summaries = documentId
    ? [await ingestDocument(documentId, { force, llm })]
    : await ingestProject(id, { force, llm });
  if (summaries.some((s) => !s.skipped)) {
    recordUsage(workspaceId, ctx.user.id, "ingest", access);
  }

  const seeds = [...new Set(summaries.flatMap((s) => s.changedEntityIds))];
  return NextResponse.json({
    summaries,
    impact: seeds.length > 0 ? impactReport(id, seeds) : null,
    model: {
      entities: listEntities(id).length,
      edges: listEdges(id).length,
      pending: listPendingFacts(id).length,
      conflicts: listConflicts(id).length,
    },
  });
});
