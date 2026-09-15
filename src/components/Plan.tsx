"use client";

import { useState } from "react";
import { AGENT_BY_ID } from "@/lib/agents/roster";
import { Badge, Button, Card, CardHead, Spinner } from "@/components/ui";
import { clsx } from "@/lib/clsx";
import type { RunMode, Stage, TestPlan } from "@/lib/types";

const STAGE_LABEL: Record<Stage, string> = {
  requirements: "requirement extraction",
  plan: "planning",
  wave1: "wave 1 — sanity, smoke, unit, functional",
  wave2: "wave 2 — edge, monkey, creative, adversarial",
  review: "review, dedupe and gap repair",
};

export function PlanPanel({
  plan,
  defaultCollapsed = false,
}: {
  plan: TestPlan;
  /** Collapse the whole plan by default — once cases exist, it's reference, not the task. */
  defaultCollapsed?: boolean;
}) {
  const [open, setOpen] = useState(!defaultCollapsed);
  const [briefsOpen, setBriefsOpen] = useState(true);
  const planned = plan.briefs.reduce((sum, b) => sum + (b.targetCount ?? 0), 0);

  return (
    <Card>
      <CardHead
        title="Test plan"
        hint={`${plan.riskAreas.length} risk areas · ${plan.briefs.length} suite briefs · ~${planned} cases planned`}
        action={
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
            {open ? "Collapse" : "Expand"}
          </Button>
        }
      />

      {!open ? null : (
        <>
          <div className="px-4 py-3">
            <p className="text-sm text-ink-soft">{plan.productSummary}</p>
            <ul className="mt-3 space-y-1.5">
              {plan.riskAreas.map((risk) => (
                <li key={risk.area} className="flex gap-2 text-sm">
                  <Badge tone={risk.severity === "P0" ? "bad" : "warn"}>{risk.severity}</Badge>
                  <span className="text-ink-soft">
                    <span className="text-ink">{risk.area}</span> — {risk.rationale}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t border-line">
            <button
              onClick={() => setBriefsOpen(!briefsOpen)}
              className="flex w-full items-center justify-between px-4 py-2 text-left text-xs text-ink-faint hover:bg-canvas"
            >
              Suite briefs
              <span>{briefsOpen ? "Hide" : "Show"}</span>
            </button>
            {briefsOpen
              ? plan.briefs.map((brief) => (
                  <div
                    key={brief.discipline}
                    className="border-t border-line px-4 py-3"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-sm font-medium text-ink">
                        {AGENT_BY_ID[brief.discipline]?.label ?? brief.discipline}
                      </h3>
                      <span className="shrink-0 text-xs text-ink-faint">
                        ~{brief.targetCount} cases · {brief.requirementIds.length} requirements
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-ink-soft">{brief.focus}</p>
                    {brief.outOfScope ? (
                      <p className="mt-1 text-xs text-ink-faint">
                        Leaves alone: {brief.outOfScope}
                      </p>
                    ) : null}
                  </div>
                ))
              : null}
          </div>

          {plan.exitCriteria.length > 0 ? (
            <div className="border-t border-line px-4 py-3">
              <p className="text-xs text-ink-faint">Exit criteria</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-soft">
                {plan.exitCriteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

export function Gate({
  nextStage,
  atPlanGate,
  failed,
  error,
  caseCount,
  busy,
  onAdvance,
  onCancel,
}: {
  nextStage: Stage;
  atPlanGate: boolean;
  failed: boolean;
  error: string | null;
  caseCount: number;
  busy: boolean;
  onAdvance: (mode: RunMode) => void;
  onCancel: () => void;
}) {
  const heading = failed
    ? `The ${STAGE_LABEL[nextStage]} stage failed`
    : atPlanGate
      ? "Plan ready for review"
      : "Paused between stages";

  return (
    <div
      className={clsx(
        "rounded-xl border px-4 py-3",
        failed
          ? "border-red-500/40 bg-red-500/10"
          : "border-amber-500/40 bg-amber-500/10",
      )}
    >
      <p className="text-sm font-medium text-ink">{heading}</p>
      <p className="mt-0.5 text-sm text-ink-soft">
        {failed
          ? `${error ?? "The stage did not complete."} ${
              caseCount > 0
                ? `The ${caseCount} cases already written are kept — retrying resumes from this stage.`
                : "Retrying resumes from this stage."
            }`
          : atPlanGate
            ? "No test cases have been written yet, and nothing has been spent on the writer agents. Read the briefs below, then choose how to continue."
            : `Next up: ${STAGE_LABEL[nextStage]}.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy} onClick={() => onAdvance("all")}>
          {busy ? <Spinner /> : null} {failed ? "Retry and run the rest" : "Run the rest"}
        </Button>
        <Button disabled={busy} onClick={() => onAdvance("step")}>
          {failed ? "Retry this stage only" : "Run next stage only"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          {failed ? "Abandon run" : "Cancel run"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-ink-faint">
        {failed ? "Resumes at" : "Next stage"}: {STAGE_LABEL[nextStage]}
      </p>
    </div>
  );
}
