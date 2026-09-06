import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createRun, getProject, latestRun, listDocuments, type RunRecord } from "@/lib/store";
import { getApiKey, getConfig } from "@/lib/settings";
import { getProvider } from "@/lib/providers";
import { startRun, reconcile } from "@/lib/orchestrator";
import { initialAgents } from "@/lib/agents/ids";
import { isActiveRun } from "@/lib/types";

export const runtime = "nodejs";

/** Mirrors the frontend's own running/resumable gate on the "start" button. */
function hasUnfinishedRun(run: RunRecord): boolean {
  return (
    isActiveRun(run.status) ||
    run.status === "paused" ||
    (run.status === "failed" && Boolean(run.nextStage))
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = latestRun(id);
  return NextResponse.json({ run: run ? reconcile(run) : null });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getProject(id)) {
    return NextResponse.json({ error: "No such project." }, { status: 404 });
  }
  const config = getConfig();
  if (!getApiKey(config.provider)) {
    return NextResponse.json(
      {
        error: `Add an API key for ${getProvider(config.provider).label} in settings before running.`,
      },
      { status: 400 },
    );
  }
  if (listDocuments(id).length === 0) {
    return NextResponse.json(
      { error: "Upload at least one requirement document first." },
      { status: 400 },
    );
  }
  const existing = latestRun(id);
  const current = existing ? reconcile(existing) : null;
  if (current && hasUnfinishedRun(current)) {
    return NextResponse.json(
      {
        error:
          "This project already has a run in progress or waiting on you. Finish or cancel it before starting another.",
      },
      { status: 409 },
    );
  }

  // Every run starts in step mode; the gate after planning is unconditional, and
  // the mode only decides what happens once the plan is approved.
  const run = createRun(randomUUID(), id, initialAgents(), "step");
  startRun(run);
  return NextResponse.json({ runId: run.id });
}
