import { NextResponse } from "next/server";
import {
  getProject,
  listDocuments,
  listEntities,
  listEdges,
  listPendingFacts,
} from "@/lib/store";
import { getApiKey, getConfig } from "@/lib/settings";
import { getProvider } from "@/lib/providers";
import { ingestDocument, ingestProject } from "@/lib/ingest";

export const runtime = "nodejs";
// Extraction + resolution is a couple of model calls per document.
export const maxDuration = 300;

/** The product model as it currently stands for this project. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getProject(id)) {
    return NextResponse.json({ error: "No such project." }, { status: 404 });
  }
  return NextResponse.json({
    entities: listEntities(id),
    edges: listEdges(id),
    pending: listPendingFacts(id),
  });
}

export async function POST(
  request: Request,
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
        error: `Add an API key for ${getProvider(config.provider).label} in settings before ingesting.`,
      },
      { status: 400 },
    );
  }
  if (listDocuments(id).length === 0) {
    return NextResponse.json(
      { error: "Upload at least one document first." },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const force = Boolean(body?.force);
  const documentId: unknown = body?.documentId;

  try {
    const summaries =
      typeof documentId === "string"
        ? [await ingestDocument(documentId, { force })]
        : await ingestProject(id, { force });

    return NextResponse.json({
      summaries,
      model: {
        entities: listEntities(id).length,
        edges: listEdges(id).length,
        pending: listPendingFacts(id).length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ingestion failed." },
      { status: 500 },
    );
  }
}
