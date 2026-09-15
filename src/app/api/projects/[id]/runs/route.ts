import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createRun, latestRun, listDocuments, type RunRecord } from "@/lib/store";
import {
  noAccessMessage,
  quotaProblem,
  recordUsage,
  resolveModelAccess,
} from "@/lib/settings";
import { capacityProblem, reconcile, startRun } from "@/lib/orchestrator";
import { initialAgents } from "@/lib/agents/ids";
import { isActiveRun } from "@/lib/types";
import { api, HttpError, requireProject, requireUser } from "@/lib/http";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Mirrors the frontend's own running/resumable gate on the "start" button. */
function hasUnfinishedRun(run: RunRecord): boolean {
  return (
    isActiveRun(run.status) ||
    run.status === "paused" ||
    (run.status === "failed" && Boolean(run.nextStage))
  );
}

export const GET = api(async (_request: Request, { params }: Params) => {
  const ctx = await requireUser();
  const { id } = await params;
  requireProject(ctx, id);
  const run = latestRun(id);
  return NextResponse.json({ run: run ? reconcile(run) : null });
});

export const POST = api(async (_request: Request, { params }: Params) => {
  const ctx = await requireUser();
  const { id } = await params;
  const project = requireProject(ctx, id);
  // The project's own workspace pays — never whichever workspace the caller
  // happens to be in.
  const workspaceId = project.workspace_id!;

  const access = resolveModelAccess(workspaceId);
  if (!access) throw new HttpError(400, noAccessMessage(workspaceId));
  if (listDocuments(id).length === 0) {
    throw new HttpError(400, "Upload at least one requirement document first.");
  }
  const existing = latestRun(id);
  const current = existing ? reconcile(existing) : null;
  if (current && hasUnfinishedRun(current)) {
    throw new HttpError(
      409,
      "This project already has a run in progress or waiting on you. Finish or cancel it before starting another.",
    );
  }
  const overQuota = quotaProblem(workspaceId, access, "run");
  if (overQuota) throw new HttpError(429, overQuota);
  const busy = capacityProblem();
  if (busy) throw new HttpError(503, busy);

  // Every run starts in step mode; the gate after planning is unconditional, and
  // the mode only decides what happens once the plan is approved.
  const run = createRun(randomUUID(), id, initialAgents(), "step");
  recordUsage(workspaceId, ctx.user.id, "run", access);
  startRun(run);
  return NextResponse.json({ runId: run.id });
});
