import { NextResponse } from "next/server";
import { getProject, getRun } from "@/lib/store";
import { exportRun, type ExportFormat } from "@/lib/export";

export const runtime = "nodejs";

const FORMATS: ExportFormat[] = ["json", "csv", "markdown", "xray", "testrail"];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: "No such run." }, { status: 404 });

  const requested = new URL(request.url).searchParams.get("format") ?? "csv";
  if (!FORMATS.includes(requested as ExportFormat)) {
    return NextResponse.json(
      { error: `Unknown format. Use one of: ${FORMATS.join(", ")}.` },
      { status: 400 },
    );
  }

  const project = getProject(run.projectId);
  const { body, contentType, filename } = exportRun(
    {
      projectName: project?.name ?? "run",
      requirements: run.requirements,
      plan: run.plan,
      cases: run.cases.filter((c) => c.verdict !== "rejected"),
      review: run.review,
    },
    requested as ExportFormat,
  );

  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
