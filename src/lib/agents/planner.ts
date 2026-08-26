import { Llm } from "@/lib/llm";
import { AGENTS } from "@/lib/agents/roster";
import { planSchema, requirementsSchema } from "@/lib/agents/schemas";
import type { Requirement, TestPlan } from "@/lib/types";

const EXTRACT_SYSTEM = `You are a requirements analyst preparing a corpus for a test design team.

You are given the full text of one or more requirement documents. Break them into atomic, testable
requirements.

Rules:
- One requirement per behaviour. If a sentence contains two obligations, split it into two.
- Restate each as a single declarative sentence that a tester could pass or fail. Preserve exact
  numbers, limits, error strings, field names and role names from the source — do not paraphrase them away.
- Keep non-functional requirements (performance, security, accessibility, compliance) as their own entries.
- Include implied requirements that the document clearly assumes but never states, and mark their category
  with the suffix " (implied)".
- Skip pure background, glossary entries, revision history and marketing copy.
- Number ids sequentially from REQ-001 with no gaps.

Aim for completeness. A missed requirement here is a permanently untested behaviour downstream.`;

const PLAN_SYSTEM = `You are a principal test architect. You have the full requirement index for a product and
a roster of specialist test-writing agents. Your job is to turn the requirements into a test plan and, most
importantly, to write each specialist a brief that is specific to THIS product.

The briefs are the deliverable that matters. A weak brief reads like the discipline's definition; a strong
brief names this product's actual features, its actual risky spots, and the actual boundaries in its rules.

For every brief:
- "focus" must reference concrete features, fields, rules and limits from the requirements by name.
- "requirementIds" assigns ownership. Every requirement id must appear in at least one brief. Requirements
  central to the product belong in several. Sanity and smoke should carry only a small critical subset.
- "targetCount" is your judgement of how many cases the product warrants for that discipline, informed by the
  suggested count you are given but not bound to it. Scale it to the size of the requirement set.
- "outOfScope" must name the other agent that owns the boundary you are excluding, so nothing falls in a gap.

Also identify the risk areas that deserve disproportionate attention, and write entry and exit criteria that
reference this product rather than generic gates.`;

export async function extractRequirements(
  llm: Llm,
  documents: { name: string; text: string }[],
  onToken?: (delta: string) => void,
): Promise<Requirement[]> {
  const corpus = documents
    .map((d) => `<document name="${d.name}">\n${d.text}\n</document>`)
    .join("\n\n");

  const result = await llm.json<{ requirements: Requirement[] }>({
    system: EXTRACT_SYSTEM,
    prompt: `Extract every testable requirement from the documents below.\n\n${corpus}`,
    schema: requirementsSchema as unknown as Record<string, unknown>,
    onToken,
  });
  return result.requirements ?? [];
}

export async function buildPlan(
  llm: Llm,
  requirements: Requirement[],
  onToken?: (delta: string) => void,
): Promise<TestPlan> {
  const index = requirements
    .map((r) => `${r.id} [${r.category}] ${r.text}`)
    .join("\n");

  const roster = AGENTS.map(
    (a) =>
      `- ${a.id} (${a.label}, wave ${a.wave}) — suggested target ${a.defaultCount} cases\n  charter: ${a.charter
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ")}`,
  ).join("\n\n");

  return llm.json<TestPlan>({
    system: PLAN_SYSTEM,
    prompt: `Requirement index (${requirements.length} requirements):\n\n${index}\n\nSpecialist roster — write exactly one brief for each of these eight disciplines:\n\n${roster}`,
    schema: planSchema as unknown as Record<string, unknown>,
    onToken,
  });
}
