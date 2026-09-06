export type Discipline =
  | "sanity"
  | "smoke"
  | "unit"
  | "functional"
  | "edge"
  | "monkey"
  | "creative"
  | "adversarial";

export type AgentId = "planner" | Discipline | "reviewer";

export type Wave = 1 | 2;

export type Priority = "P0" | "P1" | "P2" | "P3";

export type RunStatus =
  | "idle"
  | "parsing"
  | "planning"
  | "paused"
  | "wave1"
  | "wave2"
  | "reviewing"
  | "done"
  | "failed";

/** Statuses that mean a stage is actually executing right now, server-side. */
const ACTIVE_RUN_STATUSES: RunStatus[] = [
  "parsing",
  "planning",
  "wave1",
  "wave2",
  "reviewing",
];

/**
 * True only while some process is genuinely driving this run — as opposed to
 * paused (waiting on a person), or a terminal state. Shared by the client
 * (to grey out controls) and the server (to reject changes, like editing
 * documents, that would be unsafe mid-stage).
 */
export function isActiveRun(status: RunStatus): boolean {
  return ACTIVE_RUN_STATUSES.includes(status);
}

/** A run executes one stage per invocation so it can pause between them. */
export type Stage = "requirements" | "plan" | "wave1" | "wave2" | "review";

export const STAGE_ORDER: Stage[] = [
  "requirements",
  "plan",
  "wave1",
  "wave2",
  "review",
];

export function nextAfter(stage: Stage): Stage | null {
  const i = STAGE_ORDER.indexOf(stage);
  return i === -1 || i === STAGE_ORDER.length - 1 ? null : STAGE_ORDER[i + 1];
}

/** "step" pauses after every stage; "all" runs to completion. */
export type RunMode = "step" | "all";

export type AgentStatus =
  | "queued"
  | "running"
  | "repairing"
  | "done"
  | "failed"
  | "skipped";

export interface Requirement {
  id: string;
  text: string;
  source: string;
  category: string;
}

export interface SuiteBrief {
  discipline: Discipline;
  focus: string;
  requirementIds: string[];
  targetCount: number;
  outOfScope: string;
}

export interface TestPlan {
  productSummary: string;
  riskAreas: { area: string; rationale: string; severity: Priority }[];
  entryCriteria: string[];
  exitCriteria: string[];
  briefs: SuiteBrief[];
}

export interface TestCase {
  id: string;
  discipline: Discipline;
  title: string;
  priority: Priority;
  preconditions: string;
  steps: string[];
  expected: string;
  requirementIds: string[];
  tags: string[];
  automatable: boolean;
  verdict?: "approved" | "rejected";
}

export interface ReviewReport {
  duplicatesRemoved: string[];
  coveragePct: number;
  uncoveredRequirementIds: string[];
  gapsByDiscipline: { discipline: Discipline; gaps: string[] }[];
  qualityNotes: string[];
}

export interface AgentState {
  id: AgentId;
  status: AgentStatus;
  caseCount: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface RunEvent {
  type:
    | "status"
    | "agent"
    | "requirements"
    | "plan"
    | "cases"
    | "review"
    | "log"
    | "error"
    | "done"
    | "nextStage";
  payload: unknown;
}
