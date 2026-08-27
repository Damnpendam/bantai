import { NextResponse } from "next/server";
import { advanceRun, isRunning } from "@/lib/orchestrator";
import { getRun } from "@/lib/store";
import type { RunMode } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: "No such run." }, { status: 404 });

  // A failed run keeps nextStage pointing at the stage that failed, so retrying
  // resumes there instead of throwing away every suite already written.
  const resumable = run.status === "paused" || run.status === "failed";
  if (!resumable) {
    return NextResponse.json(
      { error: `This run is ${run.status} and cannot be continued.` },
      { status: 409 },
    );
  }
  if (isRunning(id)) {
    return NextResponse.json({ error: "A stage is already running." }, { status: 409 });
  }
  if (!run.nextStage) {
    return NextResponse.json(
      { error: "Nothing left to run — start a new run instead." },
      { status: 409 },
    );
  }

  const { mode } = (await request.json().catch(() => ({}))) as { mode?: string };
  if (mode !== "step" && mode !== "all") {
    return NextResponse.json(
      { error: 'mode must be "step" or "all".' },
      { status: 400 },
    );
  }

  advanceRun(id, mode as RunMode);
  return NextResponse.json({
    ok: true,
    stage: run.nextStage,
    retried: run.status === "failed",
  });
}
