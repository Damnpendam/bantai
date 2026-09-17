import { NextResponse } from "next/server";
import { deleteDocument, getDocumentIngest, latestRun } from "@/lib/store";
import { isDocumentIngesting } from "@/lib/ingest";
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
    // Mirrors the client-side gate in Documents.tsx — never trust it alone.
    if (isDocumentIngesting(id)) {
      throw new HttpError(
        409,
        "This document is being read by the AI pipeline right now. Wait for it to finish before removing it.",
      );
    }
    if (!getDocumentIngest(id)) {
      throw new HttpError(
        409,
        "Build the product model at least once before removing this document.",
      );
    }

    deleteDocument(id);
    return NextResponse.json({ ok: true });
  },
);
