import { NextResponse } from "next/server";
import { ragStats } from "@/lib/store";
import { MAX_CHILDREN_PER_PROJECT, syncChunks } from "@/lib/rag/indexer";
import { resolveEmbedAccess } from "@/lib/rag/embed";
import { api, requireProject, requireUser } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** What can be searched, and whether semantic search is available and caught up. */
export const GET = api(async (_request: Request, { params }: Params) => {
  const ctx = await requireUser();
  const { id } = await params;
  const project = requireProject(ctx, id);

  // Chunking is local and free; doing it here means search works right after upload.
  const synced = syncChunks(id);
  const embed = resolveEmbedAccess(project.workspace_id!);
  return NextResponse.json({
    stats: ragStats(id, embed?.modelKey ?? null),
    skipped: synced.skipped,
    cap: MAX_CHILDREN_PER_PROJECT,
    semantic: embed ? { available: true, provider: embed.label, source: embed.source } : { available: false },
  });
});
