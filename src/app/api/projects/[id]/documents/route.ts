import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { addDocument, latestRun, listDocumentIngests, listDocuments } from "@/lib/store";
import { parseDocument } from "@/lib/parse";
import { isDocumentIngesting } from "@/lib/ingest";
import { isActiveRun } from "@/lib/types";
import { api, HttpError, requireProject, requireUser } from "@/lib/http";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENTS = 100;

type Params = { params: Promise<{ id: string }> };

export const GET = api(async (_request: Request, { params }: Params) => {
  const ctx = await requireUser();
  const { id } = await params;
  requireProject(ctx, id);
  const ingests = listDocumentIngests(id);
  const documents = listDocuments(id).map((d) => {
    const ingest = ingests.get(d.id);
    return {
      id: d.id,
      name: d.name,
      bytes: d.bytes,
      created_at: d.created_at,
      chars: d.text.length,
      // "ingesting" wins even over a completed row: a rebuild clears the row
      // for the moment it re-reads the document, which is exactly when the
      // delete button must stay blocked.
      status: isDocumentIngesting(d.id) ? "ingesting" : (ingest?.status ?? "pending"),
      error: ingest?.error ?? null,
      entityCount: ingest?.entityCount ?? null,
      edgeCount: ingest?.edgeCount ?? null,
    };
  });
  return NextResponse.json({ documents });
});

export const POST = api(async (request: Request, { params }: Params) => {
  const ctx = await requireUser();
  const { id } = await params;
  requireProject(ctx, id);

  const run = latestRun(id);
  if (run && isActiveRun(run.status)) {
    throw new HttpError(409, "A run is in progress. Cancel it before adding documents.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "Upload the files as multipart form data.");
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) throw new HttpError(400, "No files were uploaded.");
  if (listDocuments(id).length + files.length > MAX_DOCUMENTS) {
    throw new HttpError(400, `A project can hold at most ${MAX_DOCUMENTS} documents.`);
  }

  const added: { name: string; chars: number }[] = [];
  const failed: { name: string; reason: string }[] = [];

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      failed.push({ name: file.name, reason: "Larger than 25 MB." });
      continue;
    }
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = await parseDocument(file.name, buffer);
      addDocument({
        id: randomUUID(),
        project_id: id,
        name: parsed.name,
        bytes: parsed.bytes,
        text: parsed.text,
      });
      added.push({ name: parsed.name, chars: parsed.text.length });
    } catch (error) {
      failed.push({
        name: file.name,
        reason: error instanceof Error ? error.message : "Could not be read.",
      });
    }
  }

  return NextResponse.json({ added, failed });
});
