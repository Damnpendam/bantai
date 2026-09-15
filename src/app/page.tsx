"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Documents } from "@/components/Documents";
import { Model } from "@/components/Model";
import { Roster } from "@/components/Roster";
import { Cases } from "@/components/Cases";
import { Settings, type SettingsState } from "@/components/Settings";
import { Gate, PlanPanel } from "@/components/Plan";
import { Badge, Button, Card, CardHead, Metric, Spinner, TabBar } from "@/components/ui";
import { initialAgents } from "@/lib/agents/ids";
import { isActiveRun } from "@/lib/types";
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

interface Me {
  user: { id: string; email: string; name: string; role: "superadmin" | "member" };
  workspace: { id: string; name: string };
}

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

function EmptyTab({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-ink-faint">
      {text}
    </div>
  );
}

const EXPORTS = [
  { format: "csv", label: "CSV" },
  { format: "markdown", label: "Markdown" },
  { format: "json", label: "JSON" },
  { format: "xray", label: "Jira / Xray" },
  { format: "testrail", label: "TestRail" },
];

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
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
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"model" | "plan" | "cases" | "review">("model");
  const sourceRef = useRef<EventSource | null>(null);
  // Guards the auto-jump-to-Plan below so it fires once per gate, not on every
  // event the still-open stream delivers while paused there.
  const jumpedForRef = useRef<string | null>(null);

  const active = projects.find((p) => p.id === activeId) ?? null;
  const running = run ? isActiveRun(run.status) : false;
  const activeProvider =
    settings?.providers.find((p) => p.id === settings.provider) ?? null;
  // Your own key, or the operator's shared one — either lets a run start.
  const onPlatformKey = Boolean(settings?.platform && !activeProvider?.hasKey);
  const canRun = Boolean(activeProvider?.hasKey || settings?.platform);
  const paused = run?.status === "paused";
  // A failed run that still knows which stage broke can be retried from there.
  const resumable = paused || (run?.status === "failed" && Boolean(run.nextStage));

  const loadProjects = useCallback(async () => {
    const response = await fetch("/api/projects");
    if (!response.ok) return [] as ProjectSummary[];
    const data = await response.json();
    setProjects(data.projects);
    return data.projects as ProjectSummary[];
  }, []);

  // Nothing loads until the session is confirmed; a stale or missing one goes
  // to the login page instead of rendering an app that can't fetch anything.
  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/auth/me").catch(() => null);
      if (!response?.ok) {
        window.location.replace("/login");
        return;
      }
      setMe((await response.json()) as Me);
      void fetch("/api/settings")
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => s && setSettings(s));
      const list = await loadProjects();
      if (list.length > 0) setActiveId((current) => current ?? list[0].id);
    })();
  }, [loadProjects]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.replace("/login");
  }

  const attach = useCallback((runId: string) => {
    sourceRef.current?.close();
    const source = new EventSource(`/api/runs/${runId}/stream`);
    sourceRef.current = source;
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as RunEvent;
      setRun((current) => {
        if (!current) return current;
        switch (event.type) {
          case "status": {
            const status = event.payload as RunStatus;
            // A retried stage starting (or finishing) proves whatever error
            // was on screen no longer applies. Leave it alone on a genuine
            // failure — the "error" event already set the new message, and
            // this "status": "failed" is just its usual, redundant follow-up.
            return { ...current, status, error: status === "failed" ? current.error : null };
          }
          case "requirements":
            return { ...current, requirements: event.payload as Requirement[] };
          case "plan":
            return { ...current, plan: event.payload as TestPlan };
          case "cases":
            return { ...current, cases: [...current.cases, ...(event.payload as TestCase[])] };
          case "casesRemoved": {
            const removed = new Set(event.payload as string[]);
            return { ...current, cases: current.cases.filter((c) => !removed.has(c.id)) };
          }
          case "review":
            return { ...current, review: event.payload as ReviewReport };
          case "nextStage":
            return { ...current, nextStage: event.payload as Stage | null };
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
    setTab("model");
    jumpedForRef.current = null;
    sourceRef.current?.close();
    void fetch(`/api/projects/${activeId}/runs`)
      .then((r) => r.json())
      .then(({ run: existing }) => {
        if (!existing) {
          setRun(null);
          return;
        }
        setRun(existing as RunView);
        if (isActiveRun(existing.status)) attach(existing.id);
      });
    return () => sourceRef.current?.close();
  }, [activeId, attach]);

  async function createProject() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setNotice(null);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.project) {
        setNotice(body.error ?? "Could not create the project.");
        return;
      }
      setNewName("");
      await loadProjects();
      setActiveId(body.project.id);
    } catch {
      setNotice("Could not reach the server. Check it's still running and try again.");
    } finally {
      setCreating(false);
    }
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
    // The live stream only exists while a stage is actively running — cancel
    // from a paused or already-failed run (Abandon) has no listener to tell,
    // so pull the outcome directly rather than leaving stale state on screen.
    const body = await fetch(`/api/runs/${run.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (body?.run) setRun(body.run);
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

  // The plan gate is the one moment a person must act before anything is
  // spent — jump to it once, the first time it opens, rather than leaving it
  // one tab away from whichever the user happened to be looking at.
  useEffect(() => {
    if (!run || run.status !== "paused" || run.nextStage !== "wave1") return;
    if (jumpedForRef.current === run.id) return;
    jumpedForRef.current = run.id;
    setTab("plan");
  }, [run]);

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
            disabled={creating}
            placeholder="New project…"
            className="w-40 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent/40"
          />
          <Button size="sm" onClick={() => void createProject()} disabled={!newName.trim() || creating}>
            {creating ? <Spinner /> : null} Create
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)}>
            {canRun ? "Settings" : "Add API key"}
          </Button>
          {me?.user.role === "superadmin" ? (
            <a
              href="/admin"
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-canvas hover:text-ink"
            >
              Admin
            </a>
          ) : null}
          {me ? (
            <div className="flex items-center gap-2 border-l border-line pl-3">
              <span className="hidden text-xs text-ink-faint sm:inline" title={me.user.email}>
                {me.user.name}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void logout()}>
                Log out
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      {settings && !canRun ? (
        <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          No {activeProvider?.label ?? "provider"} API key yet. Add one in settings before
          starting a run.
        </p>
      ) : null}

      {onPlatformKey && settings?.platform ? (
        <p className="mt-4 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
          You&rsquo;re on the shared key: {Math.max(0, settings.platform.dailyRuns - settings.platform.runsUsedToday)} of{" "}
          {settings.platform.dailyRuns} test-case runs left today. Add your own key in Settings to
          remove the limit.
        </p>
      ) : null}

      {/* Once a project is active, this same notice surfaces inside its Card
          instead — this covers the one case that has no Card yet: creating
          the very first project failing silently otherwise. */}
      {!active && notice ? (
        <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{notice}</p>
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
            <Documents projectId={active.id} onChange={setDocCount} locked={running} />

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
                      disabled={starting || docCount === 0 || !canRun}
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

            <TabBar
              tabs={[
                { id: "model", label: "Product model" },
                { id: "plan", label: "Test plan" },
                { id: "cases", label: "Test cases", count: kept.length },
                { id: "review", label: "Review" },
              ]}
              active={tab}
              onChange={setTab}
            />

            {tab === "model" ? <Model projectId={active.id} docCount={docCount} /> : null}

            {tab === "plan" ? (
              run?.plan ? (
                <PlanPanel plan={run.plan} defaultCollapsed={run.cases.length > 0} />
              ) : (
                <EmptyTab text="No plan yet — start a run to see the architect's briefs here." />
              )
            ) : null}

            {tab === "cases" ? (
              <Cases cases={run?.cases ?? []} runId={run?.id ?? null} onVerdict={applyVerdict} />
            ) : null}

            {tab === "review" ? (
              run?.review ? (
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
              ) : (
                <EmptyTab text="No review yet — the reviewer runs once both waves finish." />
              )
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
