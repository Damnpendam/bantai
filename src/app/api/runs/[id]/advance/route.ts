import { NextResponse } from "next/server";
import { advanceRun, capacityProblem, isRunning } from "@/lib/orchestrator";
import type { RunMode } from "@/lib/types";
import { api, HttpError, jsonBody, requireRun, requireUser } from "@/lib/http";

export const runtime = "nodejs";

export const POST = api(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requireUser();
    const { id } = await params;
    const { run } = requireRun(ctx, id);

    // A failed run keeps nextStage pointing at the stage that failed, so retrying
    // resumes there instead of throwing away every suite already written.
    const resumable = run.status === "paused" || run.status === "failed";
    if (!resumable) {
      throw new HttpError(409, `This run is ${run.status} and cannot be continued.`);
    }
    if (isRunning(id)) throw new HttpError(409, "A stage is already running.");
    if (!run.nextStage) {
      throw new HttpError(409, "Nothing left to run — start a new run instead.");
    }

    const { mode } = await jsonBody<{ mode?: unknown }>(request);
    if (mode !== "step" && mode !== "all") {
      throw new HttpError(400, 'mode must be "step" or "all".');
    }
    const busy = capacityProblem();
    if (busy) throw new HttpError(503, busy);

    advanceRun(id, mode as RunMode);
    return NextResponse.json({
      ok: true,
      stage: run.nextStage,
      retried: run.status === "failed",
    });
  },
);
