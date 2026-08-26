import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createRun, getProject, latestRun, listDocuments } from "@/lib/store";
import { getApiKey, getConfig } from "@/lib/settings";
import { getProvider } from "@/lib/providers";
import { startRun } from "@/lib/orchestrator";
import { initialAgents } from "@/lib/agents/ids";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return NextResponse.json({ run: latestRun(id) });
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

  // Every run starts in step mode; the gate after planning is unconditional, and
  // the mode only decides what happens once the plan is approved.
  const run = createRun(randomUUID(), id, initialAgents(), "step");
  startRun(run);
  return NextResponse.json({ runId: run.id });
}
