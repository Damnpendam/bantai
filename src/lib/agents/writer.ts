import { Llm } from "@/lib/llm";
import { AGENT_BY_ID } from "@/lib/agents/roster";
import { casesSchema } from "@/lib/agents/schemas";
import type { Discipline, Requirement, SuiteBrief, TestCase, TestPlan } from "@/lib/types";

type RawCase = Omit<TestCase, "id" | "discipline">;

const PREFIX: Record<Discipline, string> = {
  sanity: "SAN",
  smoke: "SMK",
  unit: "UNT",
  functional: "FUN",
  edge: "EDG",
  monkey: "MNK",
  creative: "CRE",
  adversarial: "ADV",
};

export function caseId(discipline: Discipline, n: number): string {
  return `TC-${PREFIX[discipline]}-${String(n).padStart(4, "0")}`;
}

function systemFor(discipline: Discipline): string {
  return `${AGENT_BY_ID[discipline].charter}

Universal rules for every case you write:
- The title states the specific condition under test. "Login works" is a failure; "Login is rejected when the
  password is correct but the account is locked" is a pass.
- Steps are imperative and ordered, one action each, with the concrete data to use written into the step.
- "expected" is observable and unambiguous. Never write "works correctly", "behaves as expected" or "no issues".
- Cite the requirement ids your case exercises. If you are testing something no requirement covers — which is
  expected for the wave 2 disciplines — leave requirementIds empty rather than citing a loosely related id.
- Never write a case you could not hand to a tester who has not read the requirements.
- Write only cases that belong to your discipline. Restating another agent's case is the worst outcome here.`;
}

function requirementBlock(requirements: Requirement[], ids: string[]): string {
  const wanted = new Set(ids);
  const assigned = requirements.filter((r) => wanted.has(r.id));
  const pool = assigned.length > 0 ? assigned : requirements;
  return pool.map((r) => `${r.id} [${r.category}] ${r.text}`).join("\n");
}

/**
 * Wave 2 agents get the titles of everything already written, keyed by discipline.
 * Titles only — the full text of several hundred cases would crowd out the requirements.
 */
export function coverageDigest(existing: TestCase[]): string {
  if (existing.length === 0) return "";
  const byDiscipline = new Map<Discipline, string[]>();
  for (const c of existing) {
    const list = byDiscipline.get(c.discipline) ?? [];
    list.push(c.title);
    byDiscipline.set(c.discipline, list);
  }
  return [...byDiscipline.entries()]
    .map(
      ([discipline, titles]) =>
        `<already-covered discipline="${discipline}" count="${titles.length}">\n${titles
          .map((t) => `- ${t}`)
          .join("\n")}\n</already-covered>`,
    )
    .join("\n\n");
}

export interface WriteArgs {
  llm: Llm;
  discipline: Discipline;
  plan: TestPlan;
  requirements: Requirement[];
  existing: TestCase[];
  gaps?: string[];
  startIndex: number;
  onToken?: (delta: string) => void;
  onSalvage?: () => void;
}

export async function writeSuite(args: WriteArgs): Promise<TestCase[]> {
  const { llm, discipline, plan, requirements, existing, gaps, startIndex } = args;
  const spec = AGENT_BY_ID[discipline];
  const brief: SuiteBrief | undefined = plan.briefs.find(
    (b) => b.discipline === discipline,
  );

  const target = brief?.targetCount ?? spec.defaultCount;
  const reqs = requirementBlock(requirements, brief?.requirementIds ?? []);
  const digest = spec.wave === 2 ? coverageDigest(existing) : "";

  const sections = [
    `Product under test:\n${plan.productSummary}`,
    `Risk areas the architect flagged:\n${plan.riskAreas
      .map((r) => `- [${r.severity}] ${r.area}: ${r.rationale}`)
      .join("\n")}`,
    brief
      ? `Your brief from the test architect:\nFocus: ${brief.focus}\nOut of scope for you: ${brief.outOfScope}`
      : "",
    `Requirements assigned to you:\n${reqs}`,
    digest
      ? `Cases already written by other agents. Do not duplicate any of these — go where they did not:\n\n${digest}`
      : "",
    gaps && gaps.length > 0
      ? `The reviewer found these gaps in your suite. Write cases that close them, and only those:\n${gaps
          .map((g) => `- ${g}`)
          .join("\n")}`
      : `Write approximately ${target} cases. Quality over quantity: ${Math.round(
          target * 0.7,
        )} sharp cases beat ${target} padded ones.`,
  ].filter(Boolean);

  const result = await llm.json<{ cases: RawCase[] }>({
    system: systemFor(discipline),
    prompt: sections.join("\n\n---\n\n"),
    schema: casesSchema as unknown as Record<string, unknown>,
    onToken: args.onToken,
    onSalvage: args.onSalvage,
  });

  return (result.cases ?? []).map((c, i) => ({
    ...c,
    id: caseId(discipline, startIndex + i + 1),
    discipline,
    steps: Array.isArray(c.steps) ? c.steps : [],
    tags: Array.isArray(c.tags) ? c.tags : [],
    requirementIds: Array.isArray(c.requirementIds) ? c.requirementIds : [],
  }));
}
