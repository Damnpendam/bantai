import { Llm } from "@/lib/llm";
import { getApiKey, getConfig } from "@/lib/settings";
import { getProvider } from "@/lib/providers";
import { AGENTS, WAVE1, WAVE2, type AgentSpec } from "@/lib/agents/roster";
import { buildPlan, extractRequirements } from "@/lib/agents/planner";
import { writeSuite } from "@/lib/agents/writer";
import { review } from "@/lib/agents/reviewer";
import { emit } from "@/lib/events";
import { listDocuments, getRun, updateRun, type RunRecord } from "@/lib/store";
import {
  isActiveRun,
  nextAfter,
  type AgentId,
  type AgentState,
  type AgentStatus,
  type Discipline,
  type RunMode,
  type RunStatus,
  type Stage,
  type TestCase,
  type TestPlan,
} from "@/lib/types";

const g = globalThis as unknown as {
  __bantaiAborts?: Map<string, AbortController>;
  __bantaiRunning?: Set<string>;
};
const aborts: Map<string, AbortController> = (g.__bantaiAborts ??= new Map());
/** Guards against a double-click on "next stage" running the same stage twice. */
const inFlight: Set<string> = (g.__bantaiRunning ??= new Set());

export function cancelRun(runId: string): boolean {
  const controller = aborts.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function isRunning(runId: string): boolean {
  return inFlight.has(runId);
}

/**
 * An "active" status only means something while this process is the one
 * driving it. If the server restarted or crashed mid-stage, the row is left
 * claiming to still be in progress forever, since nothing else will ever move
 * it forward — the UI would just wait on a run nobody is running. Detect that
 * on read and fail it the same way a real error would, so the existing
 * retry-a-failed-stage path (nextStage is already pointing at the right
 * stage) picks it up instead.
 */
export function reconcile(run: RunRecord): RunRecord {
  if (!isActiveRun(run.status) || isRunning(run.id)) return run;
  const error = "Interrupted — the server restarted while this stage was running. Retry it.";
  // Same cleanup drive()'s catch block does: whichever agents this stage left
  // mid-flight are stuck "running" forever otherwise, same as the run itself.
  new RunContext(run).failInFlight(error);
  updateRun(run.id, { status: "failed", error });
  emit(run.id, { type: "error", payload: error });
  emit(run.id, { type: "status", payload: "failed" });
  return getRun(run.id) ?? { ...run, status: "failed", error };
}

function makeLlm(maxTokens: number, signal?: AbortSignal): Llm {
  const config = getConfig();
  const apiKey = getApiKey(config.provider);
  if (!apiKey) {
    throw new Error(
      `No ${getProvider(config.provider).label} API key configured. Add one in settings.`,
    );
  }
  return new Llm({ ...config, apiKey, maxTokens, signal });
}

const STATUS_FOR: Record<Stage, RunStatus> = {
  requirements: "parsing",
  plan: "planning",
  wave1: "wave1",
  wave2: "wave2",
  review: "reviewing",
};

/**
 * Holds the state of one stage's execution. Rehydrated from the stored run on
 * every invocation, which is what lets a run pause between stages and survive a
 * server restart.
 */
class RunContext {
  private progressAt = new Map<string, number>();
  readonly runId: string;
  private agents: AgentState[];
  private cases: TestCase[];

  constructor(run: RunRecord) {
    this.runId = run.id;
    this.agents = run.agents;
    this.cases = run.cases;
  }

  setStatus(status: RunStatus): void {
    updateRun(this.runId, { status });
    emit(this.runId, { type: "status", payload: status });
  }

  log(message: string): void {
    emit(this.runId, { type: "log", payload: message });
  }

  agent(id: AgentId, patch: Partial<AgentState>): void {
    this.agents = this.agents.map((a) => (a.id === id ? { ...a, ...patch } : a));
    updateRun(this.runId, { agents: this.agents });
    emit(this.runId, {
      type: "agent",
      payload: this.agents.find((a) => a.id === id),
    });
  }

  mark(id: AgentId, status: AgentStatus): void {
    this.agent(id, {
      status,
      ...(status === "running" ? { startedAt: Date.now() } : {}),
      ...(status === "done" || status === "failed" ? { finishedAt: Date.now() } : {}),
    });
  }

  addCases(discipline: Discipline, incoming: TestCase[]): void {
    this.cases = [...this.cases, ...incoming];
    updateRun(this.runId, { cases: this.cases });
    this.agent(discipline, { caseCount: this.countFor(discipline) });
    emit(this.runId, { type: "cases", payload: incoming });
  }

  replaceCases(next: TestCase[]): void {
    this.cases = next;
    updateRun(this.runId, { cases: next });
  }

  get all(): TestCase[] {
    return this.cases;
  }

  countFor(discipline: Discipline): number {
    return this.cases.filter((c) => c.discipline === discipline).length;
  }

  progress(label: string): (delta: string) => void {
    let chars = 0;
    return (delta: string) => {
      chars += delta.length;
      const last = this.progressAt.get(label) ?? 0;
      if (chars - last < 6000) return;
      this.progressAt.set(label, chars);
      this.log(`${label} is writing… ${chars.toLocaleString()} characters so far.`);
    };
  }

  failInFlight(error: string): void {
    for (const agent of this.agents) {
      if (agent.status === "running" || agent.status === "repairing") {
        this.agent(agent.id, { status: "failed", error, finishedAt: Date.now() });
      }
    }
  }
}

/** Runs tasks at most `limit` at a time, preserving per-task error isolation. */
async function pool<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      await run(item);
    }
  });
  await Promise.all(workers);
}

async function runWave(
  ctx: RunContext,
  wave: AgentSpec[],
  plan: TestPlan,
  requirements: RunRecord["requirements"],
  signal: AbortSignal,
): Promise<void> {
  const writer = makeLlm(64000, signal);
  const { concurrency } = getConfig();
  // Wave 2 reads what wave 1 produced; snapshot before any of them append.
  const snapshot = ctx.all;

  if (concurrency < wave.length) {
    ctx.log(`Running ${wave.length} agents ${concurrency} at a time.`);
  }

  await pool(wave, concurrency, async (spec) => {
      ctx.mark(spec.id, "running");
      try {
        let salvaged = false;
        const cases = await writeSuite({
          llm: writer,
          discipline: spec.id,
          plan,
          requirements,
          existing: snapshot,
          startIndex: ctx.countFor(spec.id),
          onToken: ctx.progress(spec.label),
          onSalvage: () => {
            salvaged = true;
          },
        });
        ctx.addCases(spec.id, cases);
        ctx.mark(spec.id, "done");
        ctx.log(
          salvaged
            ? `${spec.label} wrote ${cases.length} cases, then hit its output limit — the suite is partial.`
            : `${spec.label} wrote ${cases.length} cases.`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.agent(spec.id, { status: "failed", error: message, finishedAt: Date.now() });
        ctx.log(`${spec.label} failed: ${message}`);
      }
    });
}

async function runReviewStage(
  ctx: RunContext,
  plan: TestPlan,
  requirements: RunRecord["requirements"],
  signal: AbortSignal,
): Promise<void> {
  ctx.mark("reviewer", "running");
  const reviewer = makeLlm(32000, signal);
  let report = await review(reviewer, ctx.all, requirements, ctx.progress("Reviewer"));
  ctx.log(
    `Reviewer flagged ${report.duplicatesRemoved.length} duplicates and ${report.gapsByDiscipline.length} suites with gaps.`,
  );

  if (report.duplicatesRemoved.length > 0) {
    const dropped = new Set(report.duplicatesRemoved);
    ctx.replaceCases(ctx.all.filter((c) => !dropped.has(c.id)));
    // replaceCases only persists — a client already attached to this run's
    // stream keeps appending cases and never learns any were dropped, so its
    // count and list run ahead of what actually got kept.
    emit(ctx.runId, { type: "casesRemoved", payload: report.duplicatesRemoved });
    for (const spec of AGENTS) {
      ctx.agent(spec.id, { caseCount: ctx.countFor(spec.id) });
    }
  }

  if (report.gapsByDiscipline.length > 0) {
    const writer = makeLlm(64000, signal);
    await pool(report.gapsByDiscipline, getConfig().concurrency, async (gap) => {
        const spec = AGENTS.find((a) => a.id === gap.discipline);
        if (!spec) return;
        ctx.mark(spec.id, "repairing");
        try {
          const extra = await writeSuite({
            llm: writer,
            discipline: spec.id,
            plan,
            requirements,
            existing: ctx.all,
            gaps: gap.gaps,
            startIndex: ctx.countFor(spec.id) + 500,
            onToken: ctx.progress(spec.label),
          });
          ctx.addCases(spec.id, extra);
          ctx.log(`${spec.label} closed ${extra.length} gaps.`);
        } catch (error) {
          ctx.log(
            `${spec.label} repair pass failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        ctx.mark(spec.id, "done");
      });

    const covered = new Set(ctx.all.flatMap((c) => c.requirementIds));
    const uncovered = requirements.filter((r) => !covered.has(r.id)).map((r) => r.id);
    report = {
      ...report,
      uncoveredRequirementIds: uncovered,
      coveragePct:
        requirements.length === 0
          ? 100
          : Math.round(
              ((requirements.length - uncovered.length) / requirements.length) * 100,
            ),
    };
  }

  updateRun(ctx.runId, { review: report });
  emit(ctx.runId, { type: "review", payload: report });
  ctx.mark("reviewer", "done");
}

/** Runs exactly one stage and persists everything it produced. */
async function runStage(run: RunRecord, stage: Stage, signal: AbortSignal): Promise<void> {
  const ctx = new RunContext(run);
  ctx.setStatus(STATUS_FOR[stage]);

  if (stage === "requirements") {
    const documents = listDocuments(run.projectId);
    if (documents.length === 0) {
      throw new Error("This project has no documents to plan from.");
    }
    ctx.mark("planner", "running");
    ctx.log(`Reading ${documents.length} document(s).`);
    const requirements = await extractRequirements(
      makeLlm(32000, signal),
      documents.map((d) => ({ name: d.name, text: d.text })),
      ctx.progress("Requirement analyst"),
    );
    updateRun(run.id, { requirements });
    emit(run.id, { type: "requirements", payload: requirements });
    ctx.log(`Extracted ${requirements.length} testable requirements.`);
    return;
  }

  const current = getRun(run.id);
  if (!current) throw new Error("The run disappeared.");

  if (stage === "plan") {
    const plan = await buildPlan(
      makeLlm(32000, signal),
      current.requirements,
      ctx.progress("Test architect"),
    );
    updateRun(run.id, { plan });
    emit(run.id, { type: "plan", payload: plan });
    ctx.mark("planner", "done");
    ctx.log(
      `Plan ready: ${plan.riskAreas.length} risk areas, ${plan.briefs.length} suite briefs.`,
    );
    return;
  }

  if (!current.plan) throw new Error("No test plan to work from.");

  if (stage === "wave1") {
    await runWave(ctx, WAVE1, current.plan, current.requirements, signal);
    return;
  }
  if (stage === "wave2") {
    await runWave(ctx, WAVE2, current.plan, current.requirements, signal);
    return;
  }
  await runReviewStage(ctx, current.plan, current.requirements, signal);
}

/**
 * Drives stages until the run finishes or reaches a pause. The plan stage always
 * pauses so the plan can be reviewed before any writer agent spends anything.
 */
async function drive(runId: string, mode: RunMode): Promise<void> {
  if (inFlight.has(runId)) return;
  inFlight.add(runId);

  const controller = new AbortController();
  aborts.set(runId, controller);

  try {
    for (;;) {
      const run = getRun(runId);
      if (!run) return;
      if (!run.nextStage) {
        updateRun(runId, { status: "done" });
        emit(runId, { type: "status", payload: "done" });
        emit(runId, { type: "done", payload: { cases: run.cases.length } });
        return;
      }
      if (controller.signal.aborted) return;

      const stage = run.nextStage;
      await runStage(run, stage, controller.signal);

      // A wave or the reviewer absorbs a cancelled agent as a per-agent
      // failure rather than throwing, so runStage can return normally even
      // after cancelRun() fired mid-stage. Without this check we'd advance
      // nextStage past the very stage that got cut short, silently undoing
      // the cancel endpoint's nextStage: null and offering to "resume" a
      // stage that never actually finished.
      if (controller.signal.aborted) return;

      const following = nextAfter(stage);
      updateRun(runId, { nextStage: following });
      // Persisting it is not enough — a client already attached to this run's
      // stream never re-fetches, so without this its pause banner keeps
      // naming the stage that just finished instead of the one coming up.
      emit(runId, { type: "nextStage", payload: following });

      if (!following) {
        updateRun(runId, { status: "done" });
        emit(runId, { type: "status", payload: "done" });
        emit(runId, { type: "done", payload: { cases: getRun(runId)?.cases.length ?? 0 } });
        return;
      }

      // The plan gate is unconditional; other pauses depend on the chosen mode.
      const mustPause = stage === "plan" || mode === "step";
      if (mustPause) {
        updateRun(runId, { status: "paused" });
        emit(runId, { type: "status", payload: "paused" });
        emit(runId, {
          type: "log",
          payload:
            stage === "plan"
              ? "Plan ready for review. Nothing has been written yet."
              : `Paused. Next up: ${following}.`,
        });
        return;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const run = getRun(runId);
    if (run) new RunContext(run).failInFlight(message);
    // nextStage is deliberately left pointing at the stage that failed, so the
    // work already done is kept and the stage can be retried on its own.
    updateRun(runId, { status: "failed", error: message });
    emit(runId, { type: "error", payload: message });
    emit(runId, { type: "status", payload: "failed" });
  } finally {
    aborts.delete(runId);
    inFlight.delete(runId);
  }
}

export function startRun(run: RunRecord): void {
  // Not awaited: the run outlives the request and reports over SSE.
  void drive(run.id, "all");
}

export function advanceRun(runId: string, mode: RunMode): void {
  updateRun(runId, { mode, error: null });
  void drive(runId, mode);
}
