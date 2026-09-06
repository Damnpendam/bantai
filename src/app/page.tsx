"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Documents } from "@/components/Documents";
import { Roster } from "@/components/Roster";
import { Cases } from "@/components/Cases";
import { Settings, type SettingsState } from "@/components/Settings";
import { Gate, PlanPanel } from "@/components/Plan";
import { Badge, Button, Card, CardHead, Metric, Spinner } from "@/components/ui";
import { initialAgents } from "@/lib/agents/ids";
import type {
  AgentState,
  Requirement,
  ReviewReport,
  RunEvent,
  RunMode,
  RunStatus,
  Stage,
  TestCase,
  TestPlan,
} from "@/lib/types";

interface ProjectSummary {
  id: string;
  name: string;
  documentCount: number;
  lastRun: { id: string; status: RunStatus; caseCount: number } | null;
}

interface RunView {
  id: string;
  status: RunStatus;
  requirements: Requirement[];
  plan: TestPlan | null;
  cases: TestCase[];
  review: ReviewReport | null;
  agents: AgentState[];
  error: string | null;
  nextStage: Stage | null;
  mode: RunMode;
}

const ACTIVE: RunStatus[] = ["parsing", "planning", "wave1", "wave2", "reviewing"];

const STATUS_COPY: Record<RunStatus, string> = {
  idle: "idle",
  parsing: "reading documents",
  planning: "architect is planning",
  paused: "paused, waiting on you",
  wave1: "wave 1 writing",
  wave2: "wave 2 writing",
  reviewing: "reviewer checking coverage",
  done: "complete",
  failed: "failed",
};

const EXPORTS = [
  { format: "csv", label: "CSV" },
  { format: "markdown", label: "Markdown" },
  { format: "json", label: "JSON" },
  { format: "xray", label: "Jira / Xray" },
  { format: "testrail", label: "TestRail" },
];

export default function Home() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [docCount, setDocCount] = useState(0);
  const [starting, setStarting] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const sourceRef = useRef<EventSource | null>(null);

  const active = projects.find((p) => p.id === activeId) ?? null;
  const running = run ? ACTIVE.includes(run.status) : false;
  const activeProvider =
    settings?.providers.find((p) => p.id === settings.provider) ?? null;
  const paused = run?.status === "paused";
  // A failed run that still knows which stage broke can be retried from there.
  const resumable = paused || (run?.status === "failed" && Boolean(run.nextStage));

  const loadProjects = useCallback(async () => {
    const data = await fetch("/api/projects").then((r) => r.json());
    setProjects(data.projects);
    return data.projects as ProjectSummary[];
  }, []);

  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings);
    void loadProjects().then((list) => {
      if (list.length > 0) setActiveId((current) => current ?? list[0].id);
    });
  }, [loadProjects]);

  const attach = useCallback((runId: string) => {
    sourceRef.current?.close();
    const source = new EventSource(`/api/runs/${runId}/stream`);
    sourceRef.current = source;
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as RunEvent;
      setRun((current) => {
        if (!current) return current;
        switch (event.type) {
          case "status":
            return { ...current, status: event.payload as RunStatus };
          case "requirements":
            return { ...current, requirements: event.payload as Requirement[] };
          case "plan":
            return { ...current, plan: event.payload as TestPlan };
          case "cases":
            return { ...current, cases: [...current.cases, ...(event.payload as TestCase[])] };
          case "review":
            return { ...current, review: event.payload as ReviewReport };
          case "agent": {
            const agent = event.payload as AgentState;
            return {
              ...current,
              agents: current.agents.map((a) => (a.id === agent.id ? agent : a)),
            };
          }
          case "error":
            return { ...current, error: String(event.payload), status: "failed" };
          default:
            return current;
        }
      });
      if (event.type === "log") {
        setLog((lines) => [...lines.slice(-60), String(event.payload)]);
      }
      if (event.type === "done" || event.type === "error") {
        source.close();
        void loadProjects();
      }
    };
    source.onerror = () => {
      source.close();
      // The stream can die for reasons other than the run finishing — a
      // server restart, a network blip. Resync from the source of truth
      // instead of leaving whatever was last on screen frozen there forever.
      void fetch(`/api/runs/${runId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { run?: RunView } | null) => {
          if (body?.run) setRun(body.run);
        })
        .catch(() => {});
    };
  }, [loadProjects]);

  // Reattach to whatever the selected project was last doing.
  useEffect(() => {
    if (!activeId) {
      setRun(null);
      return;
    }
    setLog([]);
    sourceRef.current?.close();
    void fetch(`/api/projects/${activeId}/runs`)
      .then((r) => r.json())
      .then(({ run: existing }) => {
        if (!existing) {
          setRun(null);
          return;
        }
        setRun(existing as RunView);
        if (ACTIVE.includes(existing.status)) attach(existing.id);
      });
    return () => sourceRef.current?.close();
  }, [activeId, attach]);

  async function createProject() {
    const name = newName.trim();
    if (!name) return;
    const { project } = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => r.json());
    setNewName("");
    await loadProjects();
    setActiveId(project.id);
  }

  async function start() {
    if (!activeId) return;
    setStarting(true);
    setNotice(null);
    setLog([]);
    const response = await fetch(`/api/projects/${activeId}/runs`, { method: "POST" });
    const body = await response.json();
    setStarting(false);
    if (!response.ok) {
      setNotice(body.error ?? "Could not start the run.");
      return;
    }
    setRun({
      id: body.runId,
      status: "parsing",
      requirements: [],
      plan: null,
      cases: [],
      review: null,
      agents: initialAgents(),
      error: null,
      nextStage: "requirements",
      mode: "step",
    });
    attach(body.runId);
  }

  async function advance(mode: RunMode) {
    if (!run) return;
    setAdvancing(true);
    setNotice(null);
    const response = await fetch(`/api/runs/${run.id}/advance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    setAdvancing(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setNotice(body.error ?? "Could not continue the run.");
      return;
    }
    attach(run.id);
  }

  async function cancel() {
    if (!run) return;
    await fetch(`/api/runs/${run.id}/cancel`, { method: "POST" });
  }

  function applyVerdict(id: string, verdict: "approved" | "rejected" | null) {
    setRun((current) =>
      current
        ? {
            ...current,
            cases: current.cases.map((c) =>
              c.id === id ? { ...c, verdict: verdict ?? undefined } : c,
            ),
          }
        : current,
    );
  }

  const kept = run?.cases.filter((c) => c.verdict !== "rejected") ?? [];

  return (
    <div className="mx-auto max-w-7xl px-5 py-6">
      <header className="flex flex-wrap items-center gap-3 border-b border-line pb-4">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-medium tracking-tight">Bantai</h1>
          <span className="text-sm text-ink-faint">test case agents</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {projects.length > 0 ? (
            <select
              value={activeId ?? ""}
              onChange={(e) => setActiveId(e.target.value)}
              className="rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-sm outline-none"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createProject();
            }}
            placeholder="New project…"
            className="w-40 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent/40"
          />
          <Button size="sm" onClick={() => void createProject()} disabled={!newName.trim()}>
            Create
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)}>
            {activeProvider?.hasKey ? "Settings" : "Add API key"}
          </Button>
        </div>
      </header>

      {settings && !activeProvider?.hasKey ? (
        <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          No {activeProvider?.label ?? "provider"} API key yet. Add one in settings before
          starting a run.
        </p>
      ) : null}

      {!active ? (
        <div className="mt-16 text-center">
          <h2 className="text-base font-medium">Start with a project</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
            A project holds the requirement documents for one product or release. Upload
            them, then ten agents plan the testing and write the suite.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <div className="space-y-5">
            <Documents projectId={active.id} onChange={setDocCount} />

            <Card>
              <CardHead
                title={active.name}
                hint={`${run ? STATUS_COPY[run.status] : "no run yet"}${
                  settings ? ` · ${settings.model}` : ""
                }`}
                action={
                  running ? (
                    <Button size="sm" onClick={() => void cancel()}>
                      Cancel
                    </Button>
                  ) : resumable ? (
                    // The gate owns the controls; starting a second run here would
                    // orphan the one already waiting.
                    <Badge tone={run?.status === "failed" ? "bad" : "warn"}>
                      {run?.status === "failed" ? "needs a retry" : "waiting on you"}
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void start()}
                      disabled={starting || docCount === 0 || !activeProvider?.hasKey}
                    >
                      {starting ? <Spinner /> : null}
                      {run ? "Run again" : "Generate test cases"}
                    </Button>
                  )
                }
              />
              <div className="grid grid-cols-2 gap-2 p-4">
                <Metric label="Requirements" value={run?.requirements.length ?? 0} />
                <Metric label="Test cases" value={kept.length} />
                <Metric
                  label="Coverage"
                  value={run?.review ? `${run.review.coveragePct}%` : "—"}
                />
                <Metric
                  label="Duplicates cut"
                  value={run?.review?.duplicatesRemoved.length ?? 0}
                />
              </div>

              {notice || (run?.error && !resumable) ? (
                <p className="border-t border-line px-4 py-2.5 text-sm text-red-600">
                  {notice ?? run?.error}
                </p>
              ) : null}

              {run && kept.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-2.5">
                  {EXPORTS.map((e) => (
                    <a
                      key={e.format}
                      href={`/api/runs/${run.id}/export?format=${e.format}`}
                      className="rounded-lg border border-line-strong px-2.5 py-1 text-xs text-ink hover:bg-canvas"
                    >
                      {e.label}
                    </a>
                  ))}
                </div>
              ) : null}
            </Card>

            <Roster agents={run?.agents ?? initialAgents()} />

            {log.length > 0 ? (
              <Card>
                <CardHead title="Activity" />
                <ul className="max-h-56 space-y-1 overflow-y-auto px-4 py-3 text-xs text-ink-soft">
                  {log.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>

          <div className="space-y-5">
            {resumable && run?.nextStage ? (
              <Gate
                nextStage={run.nextStage}
                atPlanGate={run.status === "paused" && run.nextStage === "wave1"}
                failed={run.status === "failed"}
                error={run.error}
                caseCount={run.cases.length}
                busy={advancing}
                onAdvance={advance}
                onCancel={() => void cancel()}
              />
            ) : null}

            {run?.plan ? <PlanPanel plan={run.plan} /> : null}

            <Cases cases={run?.cases ?? []} runId={run?.id ?? null} onVerdict={applyVerdict} />

            {run?.review ? (
              <Card>
                <CardHead
                  title="Reviewer report"
                  hint={
                    run.review.uncoveredRequirementIds.length === 1
                      ? "1 requirement uncovered"
                      : `${run.review.uncoveredRequirementIds.length} requirements uncovered`
                  }
                />
                <div className="space-y-3 px-4 py-3 text-sm">
                  {run.review.uncoveredRequirementIds.length > 0 ? (
                    <div>
                      <p className="text-xs text-ink-faint">Uncovered requirements</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {run.review.uncoveredRequirementIds.map((id) => (
                          <Badge key={id} tone="warn">
                            {id}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-ink-soft">
                      Every requirement is covered by at least one case.
                    </p>
                  )}
                  {run.review.qualityNotes.length > 0 ? (
                    <div>
                      <p className="text-xs text-ink-faint">Quality notes</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-soft">
                        {run.review.qualityNotes.map((note, i) => (
                          <li key={i}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      )}

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={setSettings}
      />
    </div>
  );
}
