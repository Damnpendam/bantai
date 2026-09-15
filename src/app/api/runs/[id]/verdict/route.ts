import { NextResponse } from "next/server";
import { updateRun } from "@/lib/store";
import type { TestCase } from "@/lib/types";
import { api, HttpError, jsonBody, requireRun, requireUser } from "@/lib/http";

export const runtime = "nodejs";

export const POST = api(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requireUser();
    const { id } = await params;
    const { run } = requireRun(ctx, id);

    const { caseId, verdict } = await jsonBody<{ caseId?: unknown; verdict?: unknown }>(request);
    if (typeof caseId !== "string" || !caseId) {
      throw new HttpError(400, "caseId is required.");
    }
    if (verdict !== "approved" && verdict !== "rejected" && verdict !== null) {
      throw new HttpError(400, 'verdict must be "approved", "rejected" or null.');
    }
    if (!run.cases.some((c) => c.id === caseId)) throw new HttpError(404, "Not found.");

    const next: TestCase["verdict"] =
      verdict === "approved" ? "approved" : verdict === "rejected" ? "rejected" : undefined;
    const cases = run.cases.map((c) => (c.id === caseId ? { ...c, verdict: next } : c));
    updateRun(id, { cases });
    return NextResponse.json({ ok: true });
  },
);
