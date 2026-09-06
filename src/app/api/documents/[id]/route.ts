import { NextResponse } from "next/server";
import { deleteDocument, getDocument, latestRun } from "@/lib/store";
import { isActiveRun } from "@/lib/types";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const doc = getDocument(id);
  if (!doc) return NextResponse.json({ error: "No such document." }, { status: 404 });

  const run = latestRun(doc.project_id);
  if (run && isActiveRun(run.status)) {
    return NextResponse.json(
      { error: "A run is in progress. Cancel it before changing documents." },
      { status: 409 },
    );
  }

  deleteDocument(id);
  return NextResponse.json({ ok: true });
}
