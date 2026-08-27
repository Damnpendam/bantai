import { Llm } from "@/lib/llm";
import { reviewSchema } from "@/lib/agents/schemas";
import { findCandidatePairs } from "@/lib/agents/similarity";
import type { Discipline, Requirement, ReviewReport, TestCase } from "@/lib/types";

const REVIEW_SYSTEM = `You are the test lead reviewing a suite assembled by eight specialist agents working in
parallel. You did not write any of it. Your job is to make the suite trustworthy.

Do three things:

1. Duplicates. You are given a shortlist of case pairs whose titles are textually similar. Judge only those
   pairs — do not go hunting through the whole suite. Two cases are duplicates when a single test run would
   satisfy both: same behaviour, same condition, same assertion. Different data at the same boundary is a
   duplicate; different boundaries are not. Similar wording about genuinely different conditions is not.
   For each pair that is a real duplicate, keep the case with the more precise expected result and put the
   other's id in duplicateIds. Most shortlisted pairs will not be duplicates; saying so is the right answer.

2. Coverage. List every requirement id with no case exercising it. A case that merely mentions a requirement
   in passing does not cover it.

3. Gaps. For each discipline, name the specific cases that should exist and do not. Phrase every gap as an
   instruction the writing agent can act on directly — "add a case for X under condition Y" — never as a
   general complaint. Judge each discipline against its own charter: a shallow sanity suite is correct, a
   shallow adversarial suite is not. Leave a discipline out entirely if its suite is sound.

Then write up to eight quality notes on the suite as a whole: systematic weaknesses, vague expected results,
areas over-tested relative to their risk.`;

/** Titles only: the full expected text of every case crowds out the requirements. */
function digest(cases: TestCase[]): string {
  return cases
    .map(
      (c) =>
        `${c.id} [${c.discipline}/${c.priority}] ${c.title} :: covers ${
          c.requirementIds.join(",") || "none"
        }`,
    )
    .join("\n");
}

/** The pairs worth adjudicating, with the detail needed to judge them. */
function duplicateShortlist(cases: TestCase[]): string {
  const pairs = findCandidatePairs(cases, (c) => c.title);
  if (pairs.length === 0) {
    return "No pairs were textually similar enough to be candidate duplicates. Return an empty duplicateIds list.";
  }
  return pairs
    .map(
      ({ a, b, score }) =>
        `~${score.toFixed(2)} similar:\n  ${a.id} [${a.discipline}] ${a.title}\n    expects: ${a.expected}\n  ${b.id} [${b.discipline}] ${b.title}\n    expects: ${b.expected}`,
    )
    .join("\n\n");
}

export async function review(
  llm: Llm,
  cases: TestCase[],
  requirements: Requirement[],
  onToken?: (delta: string) => void,
): Promise<ReviewReport> {
  const raw = await llm.json<{
    duplicateIds: string[];
    uncoveredRequirementIds: string[];
    gapsByDiscipline: { discipline: Discipline; gaps: string[] }[];
    qualityNotes: string[];
  }>({
    system: REVIEW_SYSTEM,
    prompt: [
      `Requirement index (${requirements.length}):`,
      requirements.map((r) => `${r.id} [${r.category}] ${r.text}`).join("\n"),
      "---",
      `Candidate duplicate pairs to adjudicate:`,
      duplicateShortlist(cases),
      "---",
      `Full suite for coverage and gap analysis (${cases.length} cases):`,
      digest(cases),
    ].join("\n\n"),
    schema: reviewSchema as unknown as Record<string, unknown>,
    onToken,
  });

  const validIds = new Set(cases.map((c) => c.id));
  const duplicatesRemoved = (raw.duplicateIds ?? []).filter((id) =>
    validIds.has(id),
  );

  const covered = new Set<string>();
  const dropped = new Set(duplicatesRemoved);
  for (const c of cases) {
    if (dropped.has(c.id)) continue;
    for (const id of c.requirementIds) covered.add(id);
  }
  const uncovered = requirements
    .filter((r) => !covered.has(r.id))
    .map((r) => r.id);

  return {
    duplicatesRemoved,
    coveragePct:
      requirements.length === 0
        ? 100
        : Math.round(
            ((requirements.length - uncovered.length) / requirements.length) * 100,
          ),
    // Trust our own arithmetic over the model's recall for the uncovered list.
    uncoveredRequirementIds: uncovered,
    gapsByDiscipline: (raw.gapsByDiscipline ?? []).filter(
      (g) => g.gaps && g.gaps.length > 0,
    ),
    qualityNotes: raw.qualityNotes ?? [],
  };
}
