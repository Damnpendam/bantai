import { NextResponse } from "next/server";
import { exportRun, type ExportFormat } from "@/lib/export";
import { api, HttpError, requireRun, requireUser } from "@/lib/http";

export const runtime = "nodejs";

const FORMATS: ExportFormat[] = ["json", "csv", "markdown", "xray", "testrail"];

export const GET = api(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requireUser();
    const { id } = await params;
    const { run, project } = requireRun(ctx, id);

    const requested = new URL(request.url).searchParams.get("format") ?? "csv";
    if (!FORMATS.includes(requested as ExportFormat)) {
      throw new HttpError(400, `Unknown format. Use one of: ${FORMATS.join(", ")}.`);
    }

    const { body, contentType, filename } = exportRun(
      {
        projectName: project.name,
        requirements: run.requirements,
        plan: run.plan,
        cases: run.cases.filter((c) => c.verdict !== "rejected"),
        review: run.review,
      },
      requested as ExportFormat,
    );

    // Project names are user input and end up in a header: keep only
    // characters that can't break out of the quoted filename.
    const safeName = filename.replace(/[^\w.\- ]+/g, "_").slice(0, 150) || "export";
    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${safeName}"`,
      },
    });
  },
);
