import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createProject, listDocuments, listProjects, latestRun } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const projects = listProjects().map((p) => {
    const run = latestRun(p.id);
    return {
      ...p,
      documentCount: listDocuments(p.id).length,
      lastRun: run
        ? { id: run.id, status: run.status, caseCount: run.cases.length }
        : null,
    };
  });
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const { name } = (await request.json()) as { name?: string };
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    return NextResponse.json({ error: "A project name is required." }, { status: 400 });
  }
  return NextResponse.json({ project: createProject(randomUUID(), trimmed) });
}
