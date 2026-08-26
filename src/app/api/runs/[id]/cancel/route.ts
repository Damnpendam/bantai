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
  if (run.status === "done" || run.status === "failed") {
    return NextResponse.json({ stopped: false, reason: `already ${run.status}` });
  }

  // Aborts a stage if one is executing. A paused run has none, so cancelling has
  // to close the run out here too — otherwise it waits at the gate forever.
  cancelRun(id);
  updateRun(id, { status: "failed", error: "Cancelled.", nextStage: null });
  emit(id, { type: "status", payload: "failed" });
  emit(id, { type: "log", payload: "Run cancelled." });

  return NextResponse.json({ stopped: true });
}
