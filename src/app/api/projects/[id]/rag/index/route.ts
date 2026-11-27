import { NextResponse } from "next/server";
import { ragStats } from "@/lib/store";
import { embedPending, syncChunks } from "@/lib/rag/indexer";
import { makeEmbedder, resolveEmbedAccess } from "@/lib/rag/embed";
import { api, HttpError, requireProject, requireUser } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/** Builds the semantic half of the index. Safe to call again: it only does what is missing. */
export const POST = api(async (request: Request, { params }: Params) => {
  const ctx = await requireUser();
  const { id } = await params;
  const project = requireProject(ctx, id);

  // Resuming a long build is several calls in a row, so the limit is generous.
  if (!rateLimit(`rag-index:${ctx.user.id}`, 30, 10 * 60 * 1000).ok) {
    throw new HttpError(429, "Too many index builds in a short time. Wait a few minutes.");
  }
  const embed = resolveEmbedAccess(project.workspace_id!);
  if (!embed) {
    throw new HttpError(
      400,
      "Semantic search needs an OpenRouter or Gemini API key. Add one in Settings — keyword search already works without it.",
    );
  }

  syncChunks(id);
  const progress = await embedPending(id, embed.modelKey, makeEmbedder(embed, request.signal), {
    // Stop short of the platform's request limit; the caller simply asks again.
    deadline: Date.now() + 240_000,
  });
  return NextResponse.json({ progress, stats: ragStats(id, embed.modelKey) });
});
