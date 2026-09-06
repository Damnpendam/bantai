import { NextResponse } from "next/server";
import { cancelRun } from "@/lib/orchestrator";
import { getRun, updateRun } from "@/lib/store";
import { emit } from "@/lib/events";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) {
    return NextResponse.json({ error: "No such run." }, { status: 404 });
  }
  // A failed run with a nextStage is still "abandon-able" — that's exactly
  // what the Abandon button sends here. Only a run with nothing left to give
  // up (done, or already abandoned) is truly a no-op.
  const nothingToStop = run.status === "done" || (run.status === "failed" && !run.nextStage);
  if (nothingToStop) {
    return NextResponse.json({ stopped: false, reason: `already ${run.status}` });
  }

  // Aborts a stage if one is executing. A paused run has none, so cancelling has
  // to close the run out here too — otherwise it waits at the gate forever.
  cancelRun(id);
  updateRun(id, { status: "failed", error: "Cancelled.", nextStage: null });
  emit(id, { type: "status", payload: "failed" });
  emit(id, { type: "nextStage", payload: null });
  emit(id, { type: "log", payload: "Run cancelled." });

  return NextResponse.json({ stopped: true });
}
