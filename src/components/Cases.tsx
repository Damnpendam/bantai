"use client";

import { useMemo, useState } from "react";
import { AGENTS } from "@/lib/agents/roster";
import { Badge, Button, Card, CardHead } from "@/components/ui";
import { clsx } from "@/lib/clsx";
import type { Discipline, Priority, TestCase } from "@/lib/types";

const PRIORITY_TONE: Record<Priority, "bad" | "warn" | "neutral"> = {
  P0: "bad",
  P1: "warn",
  P2: "neutral",
  P3: "neutral",
};

function CaseDetail({
  testCase,
  runId,
  onVerdict,
}: {
  testCase: TestCase;
  runId: string;
  onVerdict: (id: string, verdict: "approved" | "rejected" | null) => void;
}) {
  async function set(verdict: "approved" | "rejected" | null) {
    onVerdict(testCase.id, verdict);
    await fetch(`/api/runs/${runId}/verdict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: testCase.id, verdict }),
    });
  }

  return (
    <div className="border-t border-line bg-canvas px-4 py-3">
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs text-ink-faint">Preconditions</dt>
          <dd className="mt-0.5 text-ink-soft">{testCase.preconditions}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">Steps</dt>
          <dd className="mt-0.5">
            <ol className="list-decimal space-y-1 pl-5 text-ink-soft">
              {testCase.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">Expected</dt>
          <dd className="mt-0.5 text-ink-soft">{testCase.expected}</dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {testCase.requirementIds.map((id) => (
          <Badge key={id} tone="accent">
            {id}
          </Badge>
        ))}
        {testCase.tags.map((tag) => (
          <Badge key={tag}>{tag}</Badge>
        ))}
        <Badge>{testCase.automatable ? "automatable" : "manual"}</Badge>
      </div>

      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant={testCase.verdict === "approved" ? "primary" : "outline"}
          onClick={() => void set(testCase.verdict === "approved" ? null : "approved")}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant={testCase.verdict === "rejected" ? "primary" : "outline"}
          onClick={() => void set(testCase.verdict === "rejected" ? null : "rejected")}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

export function Cases({
  cases,
  runId,
  onVerdict,
}: {
  cases: TestCase[];
  runId: string | null;
  onVerdict: (id: string, verdict: "approved" | "rejected" | null) => void;
}) {
  const [discipline, setDiscipline] = useState<Discipline | "all">("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of cases) map.set(c.discipline, (map.get(c.discipline) ?? 0) + 1);
    return map;
  }, [cases]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cases.filter((c) => {
      if (discipline !== "all" && c.discipline !== discipline) return false;
      if (!needle) return true;
      return (
        c.title.toLowerCase().includes(needle) ||
        c.expected.toLowerCase().includes(needle) ||
        c.id.toLowerCase().includes(needle) ||
        c.requirementIds.some((r) => r.toLowerCase().includes(needle)) ||
        c.tags.some((t) => t.toLowerCase().includes(needle))
      );
    });
  }, [cases, discipline, query]);

  return (
    <Card>
      <CardHead
        title="Test cases"
        hint={
          cases.length === 0
            ? "nothing written yet"
            : `${visible.length} of ${cases.length} shown`
        }
      />

      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
        <button
          onClick={() => setDiscipline("all")}
          className={clsx(
            "rounded-full px-2.5 py-1 text-xs transition",
            discipline === "all"
              ? "bg-accent text-white dark:text-[#16150f]"
              : "text-ink-soft hover:bg-canvas",
          )}
        >
          All {cases.length > 0 ? cases.length : ""}
        </button>
        {AGENTS.map((a) => {
          const n = counts.get(a.id) ?? 0;
          return (
            <button
              key={a.id}
              onClick={() => setDiscipline(a.id)}
              disabled={n === 0}
              className={clsx(
                "rounded-full px-2.5 py-1 text-xs transition disabled:opacity-35",
                discipline === a.id
                  ? "bg-accent text-white dark:text-[#16150f]"
                  : "text-ink-soft hover:bg-canvas",
              )}
            >
              {a.label} {n > 0 ? n : ""}
            </button>
          );
        })}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles, ids, requirements"
          className="ml-auto w-56 rounded-lg border border-line bg-canvas px-2.5 py-1 text-xs outline-none focus:ring-2 focus:ring-accent/40"
        />
      </div>

      {visible.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-ink-faint">
          {cases.length === 0
            ? "Cases appear here as each agent finishes its suite."
            : "Nothing matches that filter."}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {visible.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => setOpen(open === c.id ? null : c.id)}
                className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-canvas"
              >
                <span className="mt-0.5 shrink-0 font-mono text-[11px] text-ink-faint">
                  {c.id}
                </span>
                <span
                  className={clsx(
                    "flex-1 text-sm",
                    c.verdict === "rejected"
                      ? "text-ink-faint line-through"
                      : "text-ink",
                  )}
                >
                  {c.title}
                </span>
                {c.verdict === "approved" ? <Badge tone="good">approved</Badge> : null}
                <Badge tone={PRIORITY_TONE[c.priority]}>{c.priority}</Badge>
              </button>
              {open === c.id && runId ? (
                <CaseDetail testCase={c} runId={runId} onVerdict={onVerdict} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
