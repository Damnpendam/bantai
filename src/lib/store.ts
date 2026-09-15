import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./data-dir.ts";
import type {
  AgentState,
  Edge,
  EdgeKind,
  Entity,
  EntityKind,
  PendingFact,
  PendingKind,
  Requirement,
  ReviewReport,
  RunMode,
  RunStatus,
  SourceSpan,
  Stage,
  StoredRequirement,
  TestCase,
  TestPlan,
} from "@/lib/types";

const DATA_DIR = dataDir();
fs.mkdirSync(DATA_DIR, { recursive: true });

// Next dev reloads modules; keep one handle on globalThis so we don't leak connections.
const g = globalThis as unknown as { __bantaiDb?: DatabaseSync };

function getDb(): DatabaseSync {
  if (g.__bantaiDb) return g.__bantaiDb;
  const db = new DatabaseSync(path.join(DATA_DIR, "bantai.db"));
  // Next's build spawns several workers that touch this module at once; without a
  // busy timeout the first schema write loses the race and throws "database is locked".
  db.exec("PRAGMA busy_timeout = 10000;");
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      requirements TEXT NOT NULL DEFAULT '[]',
      plan TEXT,
      cases TEXT NOT NULL DEFAULT '[]',
      review TEXT,
      agents TEXT NOT NULL DEFAULT '[]',
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
    CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);

    -- The persistent product model. Everything above is per-run and disposable;
    -- everything below accumulates across runs and documents so a later change
    -- can be compared against what the product already is.
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entity_aliases (
      entity_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      source_document_id TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (entity_id, alias)
    );
    -- Bi-temporal: valid_from/valid_to = true in the product; recorded_at/
    -- superseded_at = when we learned it. A changed fact closes the old row's
    -- validity window and links back via supersedes; it is never overwritten.
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      from_entity TEXT NOT NULL,
      to_entity TEXT NOT NULL,
      kind TEXT NOT NULL,
      valid_from INTEGER NOT NULL,
      valid_to INTEGER,
      recorded_at INTEGER NOT NULL,
      superseded_at INTEGER,
      supersedes TEXT,
      asserted_by_document TEXT,
      confidence REAL NOT NULL DEFAULT 1.0
    );
    CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      document_id TEXT,
      run_id TEXT,
      ref TEXT NOT NULL,
      text TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      valid_from INTEGER NOT NULL,
      valid_to INTEGER,
      recorded_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS requirement_entities (
      requirement_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      PRIMARY KEY (requirement_id, entity_id)
    );
    CREATE TABLE IF NOT EXISTS source_spans (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      quote TEXT NOT NULL,
      start_offset INTEGER,
      end_offset INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pending_facts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      document_id TEXT,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS document_ingests (
      document_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      ingested_at INTEGER NOT NULL,
      entity_count INTEGER NOT NULL,
      edge_count INTEGER NOT NULL,
      pending_count INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entities_project ON entities(project_id);
    CREATE INDEX IF NOT EXISTS idx_edges_project ON edges(project_id);
    CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_entity);
    CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_entity);
    CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id);
    CREATE INDEX IF NOT EXISTS idx_pending_project ON pending_facts(project_id);
    CREATE INDEX IF NOT EXISTS idx_spans_target ON source_spans(target_kind, target_id);

    -- Accounts and tenancy. A workspace is the tenant: projects belong to one,
    -- and users reach a project only through a workspace membership.
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('superadmin', 'member')),
      created_at INTEGER NOT NULL,
      disabled_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_members_user ON workspace_members(user_id);
    -- id is sha256(cookie token): a leaked database yields no usable sessions.
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      user_agent TEXT,
      ip TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('superadmin', 'member')),
      token_hash TEXT NOT NULL UNIQUE,
      invited_by TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      accepted_at INTEGER,
      revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );
    -- Per-workspace provider settings; apiKey:* values are encrypted at rest.
    CREATE TABLE IF NOT EXISTS workspace_settings (
      workspace_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (workspace_id, key)
    );
    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT,
      kind TEXT NOT NULL,
      platform INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_workspace ON usage_events(workspace_id, kind, created_at);
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      action TEXT NOT NULL,
      target TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  migrate(db);
  g.__bantaiDb = db;
  return db;
}

/** SQLite has no ADD COLUMN IF NOT EXISTS, so check before altering. */
function migrate(db: DatabaseSync): void {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(runs)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  if (!columns.has("next_stage")) {
    db.exec("ALTER TABLE runs ADD COLUMN next_stage TEXT");
    // Runs created before staging existed are finished or dead; nothing to resume.
    db.exec("UPDATE runs SET next_stage = NULL");
  }
  if (!columns.has("mode")) {
    db.exec("ALTER TABLE runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'step'");
  }

  // Projects predate tenancy. Existing rows get a NULL workspace, which makes
  // them visible to nobody until the first super admin adopts them.
  const projectColumns = new Set(
    (db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  if (!projectColumns.has("workspace_id")) {
    db.exec("ALTER TABLE projects ADD COLUMN workspace_id TEXT");
  }
  if (!projectColumns.has("created_by")) {
    db.exec("ALTER TABLE projects ADD COLUMN created_by TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id)");

  backfillRequirements(db);
}

/**
 * Requirements used to live only as a JSON blob on the run that produced them,
 * so nothing accumulated. Copy every existing run's requirements into the
 * project-scoped `requirements` table once.
 *
 * Each run that extracted requirements is treated as a re-derivation of that
 * project's requirement set: its rows are valid from the run's creation time
 * until the *next* such run, so `listRequirements` with the default `asOf`
 * returns only the latest set, while an earlier `asOf` returns the set as it
 * stood then. The blob column is left in place — the current run reader still
 * uses it — so this changes what is *available*, not what is *used*, yet.
 *
 * Uses the passed handle directly: `getDb()` has not cached the connection when
 * migrate() runs, so calling an exported helper here would re-enter it.
 */
function backfillRequirements(db: DatabaseSync): void {
  const done = db
    .prepare("SELECT value FROM settings WHERE key = 'requirements_backfilled'")
    .get() as { value: string } | undefined;
  if (done) return;

  const runs = db
    .prepare(
      `SELECT id, project_id, created_at, requirements
       FROM runs
       WHERE requirements IS NOT NULL AND requirements != '[]'
       ORDER BY project_id, created_at`,
    )
    .all() as {
    id: string;
    project_id: string;
    created_at: number;
    requirements: string;
  }[];

  const insert = db.prepare(
    `INSERT INTO requirements
       (id, project_id, document_id, run_id, ref, text, category, source, valid_from, valid_to, recorded_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    const nextOnProject = runs[i + 1];
    // Superseded by the next requirement-bearing run on the same project.
    const validTo =
      nextOnProject && nextOnProject.project_id === run.project_id
        ? nextOnProject.created_at
        : null;

    let parsed: Requirement[];
    try {
      parsed = JSON.parse(run.requirements || "[]");
    } catch {
      continue; // a malformed blob is not worth aborting every other migration for
    }
    for (const req of parsed) {
      if (!req || typeof req.text !== "string") continue;
      insert.run(
        randomUUID(),
        run.project_id,
        run.id,
        typeof req.id === "string" ? req.id : "",
        req.text,
        typeof req.category === "string" ? req.category : "",
        typeof req.source === "string" ? req.source : "",
        run.created_at,
        validTo,
        run.created_at,
      );
    }
  }

  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('requirements_backfilled', ?)",
  ).run(String(Date.now()));
}

/** The shared connection, for modules (auth) that own their own tables. */
export function db(): DatabaseSync {
  return getDb();
}

// --- per-workspace settings (raw values; encryption is settings.ts's job) ---

export function getWorkspaceSetting(workspaceId: string, key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM workspace_settings WHERE workspace_id = ? AND key = ?")
    .get(workspaceId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setWorkspaceSetting(workspaceId: string, key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO workspace_settings (workspace_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value`,
    )
    .run(workspaceId, key, value);
}

export function deleteWorkspaceSetting(workspaceId: string, key: string): void {
  getDb()
    .prepare("DELETE FROM workspace_settings WHERE workspace_id = ? AND key = ?")
    .run(workspaceId, key);
}

// --- usage, for quotas on the shared platform key ---

export function recordUsageEvent(
  workspaceId: string,
  userId: string | null,
  kind: string,
  platform: boolean,
): void {
  getDb()
    .prepare(
      "INSERT INTO usage_events (id, workspace_id, user_id, kind, platform, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(randomUUID(), workspaceId, userId, kind, platform ? 1 : 0, Date.now());
}

export function countUsageSince(
  workspaceId: string,
  kind: string,
  since: number,
  platformOnly: boolean,
): number {
  return (
    getDb()
      .prepare(
        `SELECT count(*) AS n FROM usage_events
         WHERE workspace_id = ? AND kind = ? AND created_at >= ?${platformOnly ? " AND platform = 1" : ""}`,
      )
      .get(workspaceId, kind, since) as { n: number }
  ).n;
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb().prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export function deleteSetting(key: string): void {
  getDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
}

export interface ProjectRow {
  id: string;
  name: string;
  created_at: number;
  /** The owning tenant. NULL only for pre-tenancy rows not yet adopted. */
  workspace_id: string | null;
  created_by: string | null;
}

export interface DocumentRow {
  id: string;
  project_id: string;
  name: string;
  bytes: number;
  text: string;
  created_at: number;
}

export interface RunRecord {
  id: string;
  projectId: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  requirements: Requirement[];
  plan: TestPlan | null;
  cases: TestCase[];
  review: ReviewReport | null;
  agents: AgentState[];
  error: string | null;
  nextStage: Stage | null;
  mode: RunMode;
}

/**
 * A project with no workspace is reachable by nobody — the safe default. Every
 * route passes the caller's workspace.
 */
export function createProject(
  id: string,
  name: string,
  workspaceId: string | null = null,
  createdBy: string | null = null,
): ProjectRow {
  const now = Date.now();
  getDb()
    .prepare(
      "INSERT INTO projects (id, name, created_at, workspace_id, created_by) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, name, now, workspaceId, createdBy);
  return { id, name, created_at: now, workspace_id: workspaceId, created_by: createdBy };
}

/** Only ever scoped: there is deliberately no "list every project" query. */
export function listProjects(workspaceId: string): ProjectRow[] {
  return getDb()
    .prepare("SELECT * FROM projects WHERE workspace_id = ? ORDER BY created_at DESC")
    .all(workspaceId) as unknown as ProjectRow[];
}

export function workspaceOfProject(projectId: string): string | null {
  const row = getDb()
    .prepare("SELECT workspace_id FROM projects WHERE id = ?")
    .get(projectId) as { workspace_id: string | null } | undefined;
  return row?.workspace_id ?? null;
}

/**
 * Unscoped lookup, for the orchestrator and ingest, which act on ids a route
 * already authorised. Route handlers must use projectForUser() instead.
 */
export function getProject(id: string): ProjectRow | null {
  return (
    (getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as
      | ProjectRow
      | undefined) ?? null
  );
}

export function addDocument(doc: Omit<DocumentRow, "created_at">): void {
  getDb().prepare(
    "INSERT INTO documents (id, project_id, name, bytes, text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(doc.id, doc.project_id, doc.name, doc.bytes, doc.text, Date.now());
}

export function listDocuments(projectId: string): DocumentRow[] {
  return getDb()
    .prepare("SELECT * FROM documents WHERE project_id = ? ORDER BY created_at")
    .all(projectId) as unknown as DocumentRow[];
}

export function getDocument(id: string): DocumentRow | null {
  return (
    (getDb().prepare("SELECT * FROM documents WHERE id = ?").get(id) as
      | DocumentRow
      | undefined) ?? null
  );
}

export function deleteDocument(id: string): void {
  getDb().prepare("DELETE FROM documents WHERE id = ?").run(id);
}

function toRun(row: Record<string, unknown>): RunRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    status: row.status as RunStatus,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    requirements: JSON.parse((row.requirements as string) || "[]"),
    plan: row.plan ? JSON.parse(row.plan as string) : null,
    cases: JSON.parse((row.cases as string) || "[]"),
    review: row.review ? JSON.parse(row.review as string) : null,
    agents: JSON.parse((row.agents as string) || "[]"),
    error: (row.error as string | null) ?? null,
    nextStage: (row.next_stage as Stage | null) ?? null,
    mode: ((row.mode as RunMode | null) ?? "step") as RunMode,
  };
}

export function createRun(
  id: string,
  projectId: string,
  agents: AgentState[],
  mode: RunMode,
): RunRecord {
  const now = Date.now();
  getDb()
    .prepare(
      "INSERT INTO runs (id, project_id, status, created_at, updated_at, agents, next_stage, mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, projectId, "parsing", now, now, JSON.stringify(agents), "requirements", mode);
  return getRun(id)!;
}

export function getRun(id: string): RunRecord | null {
  const row = getDb().prepare("SELECT * FROM runs WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? toRun(row) : null;
}

export function latestRun(projectId: string): RunRecord | null {
  const row = getDb()
    .prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(projectId) as Record<string, unknown> | undefined;
  return row ? toRun(row) : null;
}

type RunPatch = Partial<
  Pick<
    RunRecord,
    | "status"
    | "requirements"
    | "plan"
    | "cases"
    | "review"
    | "agents"
    | "error"
    | "nextStage"
    | "mode"
  >
>;

const COLUMN: Record<keyof RunPatch, string> = {
  status: "status",
  requirements: "requirements",
  plan: "plan",
  cases: "cases",
  review: "review",
  agents: "agents",
  error: "error",
  nextStage: "next_stage",
  mode: "mode",
};

/** Columns stored as plain text rather than JSON. */
const SCALAR = new Set<keyof RunPatch>(["status", "error", "nextStage", "mode"]);

export function updateRun(id: string, patch: RunPatch): void {
  const sets: string[] = ["updated_at = ?"];
  const values: (string | number | null)[] = [Date.now()];
  for (const [key, value] of Object.entries(patch) as [keyof RunPatch, unknown][]) {
    if (value === undefined) continue;
    sets.push(`${COLUMN[key]} = ?`);
    values.push(
      SCALAR.has(key) ? (value as string | null) : JSON.stringify(value),
    );
  }
  values.push(id);
  getDb().prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

// ---------------------------------------------------------------------------
// The persistent product model
//
// These reads take an `asOf` timestamp that defaults to now. With the default
// they return the model as it currently stands; with a past timestamp they
// return the model as it was then. That single parameter is what the later diff
// step uses to compare "before this document" against "after".
// ---------------------------------------------------------------------------

// --- entities ---

export function upsertEntity(e: {
  id: string;
  projectId: string;
  kind: EntityKind;
  name: string;
  summary?: string;
}): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO entities (id, project_id, kind, name, summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         name = excluded.name,
         summary = excluded.summary,
         updated_at = excluded.updated_at`,
    )
    .run(e.id, e.projectId, e.kind, e.name, e.summary ?? "", now, now);
}

export function addAlias(
  entityId: string,
  alias: string,
  sourceDocumentId?: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO entity_aliases (entity_id, alias, source_document_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(entity_id, alias) DO NOTHING`,
    )
    .run(entityId, alias, sourceDocumentId ?? null, Date.now());
}

function toEntity(row: Record<string, unknown>, aliases: string[]): Entity {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    kind: row.kind as EntityKind,
    name: row.name as string,
    summary: (row.summary as string) ?? "",
    aliases,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export function getEntity(id: string): Entity | null {
  const row = getDb().prepare("SELECT * FROM entities WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const aliases = (
    getDb()
      .prepare("SELECT alias FROM entity_aliases WHERE entity_id = ? ORDER BY alias")
      .all(id) as { alias: string }[]
  ).map((r) => r.alias);
  return toEntity(row, aliases);
}

export function listEntities(projectId: string): Entity[] {
  const rows = getDb()
    .prepare("SELECT * FROM entities WHERE project_id = ? ORDER BY kind, name")
    .all(projectId) as Record<string, unknown>[];
  const aliasRows = getDb()
    .prepare(
      `SELECT a.entity_id AS entity_id, a.alias AS alias
       FROM entity_aliases a JOIN entities e ON e.id = a.entity_id
       WHERE e.project_id = ?`,
    )
    .all(projectId) as { entity_id: string; alias: string }[];
  const byEntity = new Map<string, string[]>();
  for (const r of aliasRows) {
    const list = byEntity.get(r.entity_id) ?? [];
    list.push(r.alias);
    byEntity.set(r.entity_id, list);
  }
  return rows.map((row) =>
    toEntity(row, (byEntity.get(row.id as string) ?? []).sort()),
  );
}

// --- edges (bi-temporal) ---

function toEdge(row: Record<string, unknown>): Edge {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    from: row.from_entity as string,
    to: row.to_entity as string,
    kind: row.kind as EdgeKind,
    validFrom: row.valid_from as number,
    validTo: (row.valid_to as number | null) ?? null,
    recordedAt: row.recorded_at as number,
    supersededAt: (row.superseded_at as number | null) ?? null,
    supersedes: (row.supersedes as string | null) ?? null,
    assertedByDocument: (row.asserted_by_document as string | null) ?? null,
    confidence: (row.confidence as number) ?? 1,
  };
}

export function addEdge(e: {
  projectId: string;
  from: string;
  to: string;
  kind: EdgeKind;
  validFrom?: number;
  assertedByDocument?: string;
  confidence?: number;
  supersedes?: string;
}): string {
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO edges
         (id, project_id, from_entity, to_entity, kind, valid_from, valid_to,
          recorded_at, superseded_at, supersedes, asserted_by_document, confidence)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?)`,
    )
    .run(
      id,
      e.projectId,
      e.from,
      e.to,
      e.kind,
      e.validFrom ?? now,
      now,
      e.supersedes ?? null,
      e.assertedByDocument ?? null,
      e.confidence ?? 1,
    );
  return id;
}

/**
 * Close an edge's validity window instead of deleting it. `at` is when the fact
 * stopped being true in the product; `replacedBy` links to the edge that took
 * its place, if any.
 */
export function supersedeEdge(
  edgeId: string,
  at: number = Date.now(),
  replacedBy?: string,
): void {
  getDb()
    .prepare(
      "UPDATE edges SET valid_to = ?, superseded_at = ? WHERE id = ? AND valid_to IS NULL",
    )
    .run(at, at, edgeId);
  if (replacedBy) {
    getDb()
      .prepare("UPDATE edges SET supersedes = ? WHERE id = ?")
      .run(edgeId, replacedBy);
  }
}

/** Edges true in the product at `asOf` (default: now). */
export function listEdges(
  projectId: string,
  { asOf = Date.now() }: { asOf?: number } = {},
): Edge[] {
  return (
    getDb()
      .prepare(
        `SELECT * FROM edges
         WHERE project_id = ?
           AND valid_from <= ?
           AND (valid_to IS NULL OR valid_to > ?)
         ORDER BY recorded_at`,
      )
      .all(projectId, asOf, asOf) as Record<string, unknown>[]
  ).map(toEdge);
}

/** Every edge ever recorded for a project, including superseded ones. */
export function listAllEdges(projectId: string): Edge[] {
  return (
    getDb()
      .prepare("SELECT * FROM edges WHERE project_id = ? ORDER BY recorded_at")
      .all(projectId) as Record<string, unknown>[]
  ).map(toEdge);
}

export function edgesTouching(
  entityId: string,
  { asOf = Date.now() }: { asOf?: number } = {},
): Edge[] {
  return (
    getDb()
      .prepare(
        `SELECT * FROM edges
         WHERE (from_entity = ? OR to_entity = ?)
           AND valid_from <= ?
           AND (valid_to IS NULL OR valid_to > ?)
         ORDER BY recorded_at`,
      )
      .all(entityId, entityId, asOf, asOf) as Record<string, unknown>[]
  ).map(toEdge);
}

/** A currently-valid edge with these exact endpoints and kind, if one exists. */
export function findLiveEdge(
  projectId: string,
  from: string,
  to: string,
  kind: EdgeKind,
): Edge | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM edges
       WHERE project_id = ? AND from_entity = ? AND to_entity = ? AND kind = ?
         AND valid_to IS NULL
       LIMIT 1`,
    )
    .get(projectId, from, to, kind) as Record<string, unknown> | undefined;
  return row ? toEdge(row) : null;
}

// --- ingestion bookkeeping ---

export interface DocumentIngest {
  documentId: string;
  projectId: string;
  ingestedAt: number;
  entityCount: number;
  edgeCount: number;
  pendingCount: number;
}

export function getDocumentIngest(documentId: string): DocumentIngest | null {
  const row = getDb()
    .prepare("SELECT * FROM document_ingests WHERE document_id = ?")
    .get(documentId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    documentId: row.document_id as string,
    projectId: row.project_id as string,
    ingestedAt: row.ingested_at as number,
    entityCount: row.entity_count as number,
    edgeCount: row.edge_count as number,
    pendingCount: row.pending_count as number,
  };
}

export function markDocumentIngested(i: Omit<DocumentIngest, "ingestedAt">): void {
  getDb()
    .prepare(
      `INSERT INTO document_ingests
         (document_id, project_id, ingested_at, entity_count, edge_count, pending_count)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(document_id) DO UPDATE SET
         ingested_at = excluded.ingested_at,
         entity_count = excluded.entity_count,
         edge_count = excluded.edge_count,
         pending_count = excluded.pending_count`,
    )
    .run(
      i.documentId,
      i.projectId,
      Date.now(),
      i.entityCount,
      i.edgeCount,
      i.pendingCount,
    );
}

export function clearDocumentIngest(documentId: string): void {
  getDb()
    .prepare("DELETE FROM document_ingests WHERE document_id = ?")
    .run(documentId);
}

// --- requirements (promoted out of the run blob) ---

function toStoredRequirement(row: Record<string, unknown>): StoredRequirement {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    documentId: (row.document_id as string | null) ?? null,
    runId: (row.run_id as string | null) ?? null,
    ref: row.ref as string,
    text: row.text as string,
    category: (row.category as string) ?? "",
    source: (row.source as string) ?? "",
    validFrom: row.valid_from as number,
    validTo: (row.valid_to as number | null) ?? null,
    recordedAt: row.recorded_at as number,
  };
}

export function addRequirement(r: {
  projectId: string;
  ref: string;
  text: string;
  category?: string;
  source?: string;
  documentId?: string;
  runId?: string;
  validFrom?: number;
}): string {
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO requirements
         (id, project_id, document_id, run_id, ref, text, category, source, valid_from, valid_to, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      id,
      r.projectId,
      r.documentId ?? null,
      r.runId ?? null,
      r.ref,
      r.text,
      r.category ?? "",
      r.source ?? "",
      r.validFrom ?? now,
      now,
    );
  return id;
}

/** Close a requirement's validity window without deleting it. */
export function supersedeRequirement(
  requirementId: string,
  at: number = Date.now(),
): void {
  getDb()
    .prepare(
      "UPDATE requirements SET valid_to = ? WHERE id = ? AND valid_to IS NULL",
    )
    .run(at, requirementId);
}

export function listRequirements(
  projectId: string,
  { asOf = Date.now() }: { asOf?: number } = {},
): StoredRequirement[] {
  return (
    getDb()
      .prepare(
        `SELECT * FROM requirements
         WHERE project_id = ?
           AND valid_from <= ?
           AND (valid_to IS NULL OR valid_to > ?)
         ORDER BY recorded_at, ref`,
      )
      .all(projectId, asOf, asOf) as Record<string, unknown>[]
  ).map(toStoredRequirement);
}

export function bindRequirementEntity(
  requirementId: string,
  entityId: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO requirement_entities (requirement_id, entity_id)
       VALUES (?, ?) ON CONFLICT(requirement_id, entity_id) DO NOTHING`,
    )
    .run(requirementId, entityId);
}

// --- provenance ---

export function addSourceSpan(s: {
  projectId: string;
  documentId: string;
  targetKind: SourceSpan["targetKind"];
  targetId: string;
  quote: string;
  startOffset?: number;
  endOffset?: number;
}): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO source_spans
         (id, project_id, document_id, target_kind, target_id, quote, start_offset, end_offset, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      s.projectId,
      s.documentId,
      s.targetKind,
      s.targetId,
      s.quote,
      s.startOffset ?? null,
      s.endOffset ?? null,
      Date.now(),
    );
  return id;
}

export function spansFor(
  targetKind: SourceSpan["targetKind"],
  targetId: string,
): SourceSpan[] {
  return (
    getDb()
      .prepare(
        "SELECT * FROM source_spans WHERE target_kind = ? AND target_id = ? ORDER BY created_at",
      )
      .all(targetKind, targetId) as Record<string, unknown>[]
  ).map((row) => ({
    id: row.id as string,
    projectId: row.project_id as string,
    documentId: row.document_id as string,
    targetKind: row.target_kind as SourceSpan["targetKind"],
    targetId: row.target_id as string,
    quote: row.quote as string,
    startOffset: (row.start_offset as number | null) ?? null,
    endOffset: (row.end_offset as number | null) ?? null,
    createdAt: row.created_at as number,
  }));
}

// --- the pending-facts worklist ---

export function addPendingFact(p: {
  projectId: string;
  kind: PendingKind;
  payload: unknown;
  reason?: string;
  documentId?: string;
}): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO pending_facts
         (id, project_id, document_id, kind, payload, reason, status, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, NULL)`,
    )
    .run(
      id,
      p.projectId,
      p.documentId ?? null,
      p.kind,
      JSON.stringify(p.payload ?? null),
      p.reason ?? "",
      Date.now(),
    );
  return id;
}

export function listPendingFacts(
  projectId: string,
  status: PendingFact["status"] | "all" = "open",
): PendingFact[] {
  const rows = (
    status === "all"
      ? getDb()
          .prepare(
            "SELECT * FROM pending_facts WHERE project_id = ? ORDER BY created_at DESC",
          )
          .all(projectId)
      : getDb()
          .prepare(
            "SELECT * FROM pending_facts WHERE project_id = ? AND status = ? ORDER BY created_at DESC",
          )
          .all(projectId, status)
  ) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    projectId: row.project_id as string,
    documentId: (row.document_id as string | null) ?? null,
    kind: row.kind as PendingKind,
    payload: JSON.parse((row.payload as string) || "null"),
    reason: (row.reason as string) ?? "",
    status: row.status as PendingFact["status"],
    createdAt: row.created_at as number,
    resolvedAt: (row.resolved_at as number | null) ?? null,
  }));
}

export function resolvePendingFact(
  id: string,
  status: "resolved" | "dismissed",
): void {
  getDb()
    .prepare(
      "UPDATE pending_facts SET status = ?, resolved_at = ? WHERE id = ?",
    )
    .run(status, Date.now(), id);
}

/**
 * Drop every open pending fact derived from one document. Used when that
 * document is re-ingested, so the worklist reflects the latest parse rather
 * than accumulating a copy per run.
 */
export function clearPendingFactsForDocument(documentId: string): void {
  getDb()
    .prepare(
      "DELETE FROM pending_facts WHERE document_id = ? AND status = 'open'",
    )
    .run(documentId);
}
