import { NextResponse } from "next/server";
import { reconcile } from "@/lib/orchestrator";
import { api, requireRun, requireUser } from "@/lib/http";

export const runtime = "nodejs";

export const GET = api(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requireUser();
    const { id } = await params;
    const { run } = requireRun(ctx, id);
    return NextResponse.json({ run: reconcile(run) });
  },
);
