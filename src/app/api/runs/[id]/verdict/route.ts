import { NextResponse } from "next/server";
import { getRun, updateRun } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: "No such run." }, { status: 404 });

  const { caseId, verdict } = (await request.json()) as {
    caseId?: string;
    verdict?: "approved" | "rejected" | null;
  };
  if (!caseId) {
    return NextResponse.json({ error: "caseId is required." }, { status: 400 });
  }

  const cases = run.cases.map((c) =>
    c.id === caseId ? { ...c, verdict: verdict ?? undefined } : c,
  );
  updateRun(id, { cases });
  return NextResponse.json({ ok: true });
}
