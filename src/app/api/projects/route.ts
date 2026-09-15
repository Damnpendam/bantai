import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createProject, listDocuments, listProjects, latestRun } from "@/lib/store";
import { reconcile } from "@/lib/orchestrator";
import { api, HttpError, jsonBody, requireUser } from "@/lib/http";

export const runtime = "nodejs";

const MAX_PROJECTS = Number(process.env.MAX_PROJECTS_PER_WORKSPACE ?? 50) || 50;

/** Only the caller's own workspace, ever. */
export const GET = api(async (_request: Request) => {
  const ctx = await requireUser();
  const projects = listProjects(ctx.workspace.id).map((p) => {
    const run = latestRun(p.id);
    const current = run ? reconcile(run) : null;
    return {
      id: p.id,
      name: p.name,
      created_at: p.created_at,
      documentCount: listDocuments(p.id).length,
      lastRun: current
        ? { id: current.id, status: current.status, caseCount: current.cases.length }
        : null,
    };
  });
  return NextResponse.json({ projects });
});

export const POST = api(async (request: Request) => {
  const ctx = await requireUser();
  const { name } = await jsonBody<{ name?: unknown }>(request);
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) throw new HttpError(400, "A project name is required.");
  if (trimmed.length > 120) throw new HttpError(400, "Keep project names under 120 characters.");
  if (listProjects(ctx.workspace.id).length >= MAX_PROJECTS) {
    throw new HttpError(403, `This workspace has reached its limit of ${MAX_PROJECTS} projects.`);
  }
  const project = createProject(randomUUID(), trimmed, ctx.workspace.id, ctx.user.id);
  return NextResponse.json({
    project: { id: project.id, name: project.name, created_at: project.created_at },
  });
});
