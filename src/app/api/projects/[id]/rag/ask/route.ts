import { NextResponse } from "next/server";
import { ragStats } from "@/lib/store";
import {
  noAccessMessage,
  quotaProblem,
  recordUsage,
  resolveModelAccess,
} from "@/lib/settings";
import { makeLlm } from "@/lib/llm-config";
import type { Effort } from "@/lib/llm";
import { ask, type ChatTurn, type JsonFn } from "@/lib/rag/agent";
import { syncChunks } from "@/lib/rag/indexer";
import { search } from "@/lib/rag/retrieve";
import { makeEmbedder, resolveEmbedAccess } from "@/lib/rag/embed";
import { api, HttpError, jsonBody, requireProject, requireUser } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
// Plan, a search or two, a grade, and an answer: a handful of sequential model calls.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const MAX_QUESTION = 2000;
const MAX_HISTORY = 10;
const MAX_TURN = 4000;

function readHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: ChatTurn[] = [];
  for (const item of value) {
    const turn = item as { role?: unknown; content?: unknown };
    if ((turn.role !== "user" && turn.role !== "assistant") || typeof turn.content !== "string") continue;
    const content = turn.content.trim().slice(0, MAX_TURN);
    if (content) turns.push({ role: turn.role, content });
  }
  return turns.slice(-MAX_HISTORY);
}

/** Planning and grading are mechanical; the answer gets the workspace's effort, up to medium. */
function answerEffort(effort: Effort): Effort {
  return effort === "high" || effort === "xhigh" || effort === "max" ? "medium" : effort;
}

export const POST = api(async (request: Request, { params }: Params) => {
  const ctx = await requireUser();
  const { id } = await params;
  const project = requireProject(ctx, id);
  const workspaceId = project.workspace_id!;

  const body = await jsonBody<{ question?: unknown; history?: unknown }>(request);
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) throw new HttpError(400, "Ask a question.");
  if (question.length > MAX_QUESTION) {
    throw new HttpError(400, `Keep the question under ${MAX_QUESTION} characters.`);
  }

  if (!rateLimit(`ask:${ctx.user.id}`, 20, 5 * 60 * 1000).ok) {
    throw new HttpError(429, "Too many questions in a short time. Wait a minute.");
  }
  const access = resolveModelAccess(workspaceId);
  if (!access) throw new HttpError(400, noAccessMessage(workspaceId));
  const overQuota = quotaProblem(workspaceId, access, "ask");
  if (overQuota) throw new HttpError(429, overQuota);

  syncChunks(id);
  if (ragStats(id, null).passages === 0) {
    throw new HttpError(400, "Upload a document with readable text first.");
  }

  const embed = resolveEmbedAccess(workspaceId);
  const embedder = embed ? makeEmbedder(embed, request.signal) : null;

  const fastLlm = makeLlm(access, 3000, request.signal, "low");
  const writerLlm = makeLlm(access, 6000, request.signal, answerEffort(access.effort));
  const through =
    (llm: typeof fastLlm): JsonFn =>
    (call) =>
      llm.json({ system: call.system, prompt: call.prompt, schema: call.schema });

  const result = await ask({
    question,
    history: readHistory(body.history),
    signal: request.signal,
    fast: through(fastLlm),
    writer: through(writerLlm),
    search: (query, k) =>
      search(id, query, {
        k,
        model: embed?.modelKey ?? null,
        embedQuery: embedder ? async (text) => (await embedder([text], "query"))[0] : undefined,
      }),
  });

  recordUsage(workspaceId, ctx.user.id, "ask", access);
  return NextResponse.json(result);
});
