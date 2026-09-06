import { NextResponse } from "next/server";
import { getRun } from "@/lib/store";
import { reconcile } from "@/lib/orchestrator";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: "No such run." }, { status: 404 });
  return NextResponse.json({ run: reconcile(run) });
}
