import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { addDocument, getProject, latestRun, listDocuments } from "@/lib/store";
import { parseDocument } from "@/lib/parse";
import { isActiveRun } from "@/lib/types";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const documents = listDocuments(id).map(({ text, ...rest }) => ({
    ...rest,
    chars: text.length,
  }));
  return NextResponse.json({ documents });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getProject(id)) {
    return NextResponse.json({ error: "No such project." }, { status: 404 });
  }
  const run = latestRun(id);
  if (run && isActiveRun(run.status)) {
    return NextResponse.json(
      { error: "A run is in progress. Cancel it before adding documents." },
      { status: 409 },
    );
  }

  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files were uploaded." }, { status: 400 });
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
}
