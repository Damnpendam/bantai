import type { Requirement, ReviewReport, TestCase, TestPlan } from "@/lib/types";

export type ExportFormat = "json" | "csv" | "markdown" | "xray" | "testrail";

// A cell beginning with one of these is interpreted as a formula by Excel and
// Sheets. Our own adversarial agent writes cases about this; we should not ship it.
function neutralize(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function cell(value: unknown): string {
  const raw = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  const safe = neutralize(raw);
  return `"${safe.replace(/"/g, '""')}"`;
}

function csv(rows: unknown[][]): string {
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

function numberedSteps(steps: string[]): string {
  return steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

export interface ExportInput {
  projectName: string;
  requirements: Requirement[];
  plan: TestPlan | null;
  cases: TestCase[];
  review: ReviewReport | null;
}

export function exportRun(
  input: ExportInput,
  format: ExportFormat,
): { body: string; contentType: string; filename: string } {
  const slug = input.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "run";

  if (format === "json") {
    return {
      body: JSON.stringify(input, null, 2),
      contentType: "application/json",
      filename: `${slug}-test-cases.json`,
    };
  }

  if (format === "csv") {
    const rows: unknown[][] = [
      [
        "ID", "Discipline", "Title", "Priority", "Preconditions",
        "Steps", "Expected result", "Requirements", "Tags", "Automatable",
      ],
      ...input.cases.map((c) => [
        c.id, c.discipline, c.title, c.priority, c.preconditions,
        numberedSteps(c.steps), c.expected, c.requirementIds, c.tags,
        c.automatable ? "yes" : "no",
      ]),
    ];
    return {
      body: csv(rows),
      contentType: "text/csv; charset=utf-8",
      filename: `${slug}-test-cases.csv`,
    };
  }

  if (format === "xray") {
    // Xray takes one row per step, repeating the test key on each.
    const rows: unknown[][] = [
      ["TCID", "Summary", "Priority", "Labels", "Precondition", "Action", "Data", "Expected Result"],
    ];
    for (const c of input.cases) {
      c.steps.forEach((step, i) => {
        rows.push([
          c.id,
          i === 0 ? c.title : "",
          i === 0 ? c.priority : "",
          i === 0 ? [c.discipline, ...c.tags] : "",
          i === 0 ? c.preconditions : "",
          step,
          i === 0 ? c.requirementIds.join(" ") : "",
          i === c.steps.length - 1 ? c.expected : "",
        ]);
      });
    }
    return {
      body: csv(rows),
      contentType: "text/csv; charset=utf-8",
      filename: `${slug}-xray.csv`,
    };
  }

  if (format === "testrail") {
    const rows: unknown[][] = [
      ["Title", "Section", "Template", "Type", "Priority", "Preconditions", "Steps", "Expected Result", "References"],
      ...input.cases.map((c) => [
        c.title,
        c.discipline,
        "Test Case (Text)",
        c.automatable ? "Automated" : "Functional",
        c.priority,
        c.preconditions,
        numberedSteps(c.steps),
        c.expected,
        c.requirementIds,
      ]),
    ];
    return {
      body: csv(rows),
      contentType: "text/csv; charset=utf-8",
      filename: `${slug}-testrail.csv`,
    };
  }

  const lines: string[] = [`# Test cases — ${input.projectName}`, ""];

  if (input.plan) {
    lines.push("## Plan", "", input.plan.productSummary, "", "### Risk areas", "");
    for (const risk of input.plan.riskAreas) {
      lines.push(`- **${risk.area}** (${risk.severity}) — ${risk.rationale}`);
    }
    lines.push("", "### Exit criteria", "");
    for (const c of input.plan.exitCriteria) lines.push(`- ${c}`);
    lines.push("");
  }

  if (input.review) {
    lines.push(
      "## Coverage",
      "",
      `- Requirements: ${input.requirements.length}`,
      `- Test cases: ${input.cases.length}`,
      `- Requirement coverage: ${input.review.coveragePct}%`,
      `- Duplicates removed: ${input.review.duplicatesRemoved.length}`,
      "",
    );
    if (input.review.uncoveredRequirementIds.length > 0) {
      lines.push(
        `Uncovered: ${input.review.uncoveredRequirementIds.join(", ")}`,
        "",
      );
    }
  }

  const byDiscipline = new Map<string, TestCase[]>();
  for (const c of input.cases) {
    byDiscipline.set(c.discipline, [...(byDiscipline.get(c.discipline) ?? []), c]);
  }

  for (const [discipline, cases] of byDiscipline) {
    lines.push(`## ${discipline} (${cases.length})`, "");
    for (const c of cases) {
      lines.push(
        `### ${c.id} — ${c.title}`,
        "",
        `**Priority:** ${c.priority}  |  **Automatable:** ${c.automatable ? "yes" : "no"}  |  **Covers:** ${
          c.requirementIds.join(", ") || "—"
        }`,
        "",
        `**Preconditions:** ${c.preconditions}`,
        "",
        "**Steps:**",
        "",
        ...c.steps.map((s, i) => `${i + 1}. ${s}`),
        "",
        `**Expected:** ${c.expected}`,
        "",
      );
    }
  }

  return {
    body: lines.join("\n"),
    contentType: "text/markdown; charset=utf-8",
    filename: `${slug}-test-cases.md`,
  };
}
