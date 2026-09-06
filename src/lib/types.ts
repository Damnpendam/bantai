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

/**
 * The persistent product model. A run's requirements/plan/cases are still stored
 * on the run row; these tables are what accumulates *across* runs and documents,
 * so that a later change can be compared against what the product already is.
 */

/** The typed nodes. Generic `(Entity)-[RELATED_TO]->(Entity)` cannot answer
 *  "what breaks if I change this"; the typing is the point. */
export type EntityKind =
  | "capability"
  | "screen"
  | "actor"
  | "data_object"
  | "state"
  | "rule"
  | "event"
  | "constraint";

/** The typed edges between product entities. */
export type EdgeKind =
  | "governs"
  | "mutates"
  | "precedes"
  | "requires"
  | "belongs_to"
  | "contradicts";

export interface Entity {
  id: string;
  projectId: string;
  kind: EntityKind;
  /** Canonical display name. Other spellings live in `aliases`. */
  name: string;
  summary: string;
  aliases: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * A bi-temporal fact. `validFrom`/`validTo` track when it is true *in the
 * product*; `recordedAt`/`supersededAt` track when *we learned* it. A new
 * document that changes a rule closes the old edge's validity window and points
 * back at it via `supersedes` — it never overwrites. That is what lets the model
 * converge and hands us change history for free.
 */
export interface Edge {
  id: string;
  projectId: string;
  from: string;
  to: string;
  kind: EdgeKind;
  validFrom: number;
  /** null = still true. */
  validTo: number | null;
  recordedAt: number;
  supersededAt: number | null;
  /** Edge id this one replaced, if any. */
  supersedes: string | null;
  /** Document id that asserted this fact. */
  assertedByDocument: string | null;
  confidence: number;
}

/**
 * A requirement promoted out of the `runs.requirements` JSON blob into a
 * project-scoped, versioned row. `ref` keeps the `REQ-001` label extraction
 * produced; `id` is a stable primary key.
 */
export interface StoredRequirement {
  id: string;
  projectId: string;
  documentId: string | null;
  /** The run that first extracted it, when known. */
  runId: string | null;
  ref: string;
  text: string;
  category: string;
  source: string;
  validFrom: number;
  validTo: number | null;
  recordedAt: number;
}

/** Why an intake item could not go straight into the canonical model. */
export type PendingKind =
  | "ambiguous_alias"
  | "low_confidence_edge"
  | "contradicts_canon"
  | "unresolved_entity";

/**
 * The visible worklist. Each new document resolves pending items — that is how
 * "it gets clearer" actually happens — and the residue is a spec-gap list.
 */
export interface PendingFact {
  id: string;
  projectId: string;
  documentId: string | null;
  kind: PendingKind;
  payload: unknown;
  reason: string;
  status: "open" | "resolved" | "dismissed";
  createdAt: number;
  resolvedAt: number | null;
}

/** Provenance: the span of source text a claim was extracted from. */
export interface SourceSpan {
  id: string;
  projectId: string;
  documentId: string;
  targetKind: "entity" | "edge" | "requirement";
  targetId: string;
  quote: string;
  startOffset: number | null;
  endOffset: number | null;
  createdAt: number;
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
    | "nextStage"
    | "casesRemoved";
  payload: unknown;
}
