"use client";

import { AGENTS } from "@/lib/agents/roster";
import { Badge, Card, CardHead, Spinner } from "@/components/ui";
import type { AgentId, AgentState } from "@/lib/types";

const LABELS: Record<AgentId, { label: string; blurb: string; wave: number }> = {
  planner: { label: "Test architect", blurb: "scope, risk, suite briefs", wave: 0 },
  ...Object.fromEntries(
    AGENTS.map((a) => [a.id, { label: a.label, blurb: a.blurb, wave: a.wave }]),
  ),
  reviewer: { label: "Reviewer", blurb: "dedupe, gaps, traceability", wave: 3 },
} as Record<AgentId, { label: string; blurb: string; wave: number }>;

const ORDER: AgentId[] = ["planner", ...AGENTS.map((a) => a.id), "reviewer"];

function StatusChip({ agent }: { agent: AgentState }) {
  if (agent.status === "running" || agent.status === "repairing") {
    return (
      <Badge tone="accent">
        <Spinner className="mr-1.5" />
        {agent.status === "repairing" ? "closing gaps" : "writing"}
        {agent.caseCount > 0 ? ` · ${agent.caseCount}` : ""}
      </Badge>
    );
  }
  if (agent.status === "done") {
    return (
      <Badge tone="good">{agent.caseCount > 0 ? `${agent.caseCount} cases` : "done"}</Badge>
    );
  }
  if (agent.status === "failed") return <Badge tone="bad">failed</Badge>;
  return <Badge>queued</Badge>;
}

const WAVE_LABEL: Record<number, string> = {
  0: "Plan",
  1: "Wave 1 · baseline coverage",
  2: "Wave 2 · depth and adversarial",
  3: "Review",
};

export function Roster({ agents }: { agents: AgentState[] }) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  let lastWave = -1;

  return (
    <Card>
      <CardHead title="Agent roster" hint="ten agents, two waves, one repair loop" />
      <ul className="px-4 py-1">
        {ORDER.map((id) => {
          const meta = LABELS[id];
          const agent = byId.get(id) ?? { id, status: "queued" as const, caseCount: 0 };
          const header = meta.wave !== lastWave ? WAVE_LABEL[meta.wave] : null;
          lastWave = meta.wave;
          return (
            <li key={id}>
              {header ? (
                <p className="pt-3 pb-1 text-[11px] uppercase tracking-wide text-ink-faint">
                  {header}
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{meta.label}</p>
                  <p className="truncate text-xs text-ink-faint">
                    {agent.error ?? meta.blurb}
                  </p>
                </div>
                <StatusChip agent={agent as AgentState} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="sr-only" aria-live="polite">
        {agents.filter((a) => a.status === "running").length} agents writing.
      </div>
    </Card>
  );
}
