import { NextResponse } from "next/server";
import { deleteDocument, latestRun } from "@/lib/store";
import { isActiveRun } from "@/lib/types";
import { api, HttpError, requireDocument, requireUser } from "@/lib/http";

export const runtime = "nodejs";

export const DELETE = api(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requireUser();
    const { id } = await params;
    const { document } = requireDocument(ctx, id);

    const run = latestRun(document.project_id);
    if (run && isActiveRun(run.status)) {
      throw new HttpError(409, "A run is in progress. Cancel it before changing documents.");
    }

    deleteDocument(id);
    return NextResponse.json({ ok: true });
  },
);
