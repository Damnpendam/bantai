import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type {
  AgentState,
  Requirement,
  ReviewReport,
  RunMode,
  RunStatus,
  Stage,
  TestCase,
  TestPlan,
} from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), "data");
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

export function createProject(id: string, name: string): ProjectRow {
  const now = Date.now();
  getDb().prepare("INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)").run(
    id,
    name,
    now,
  );
  return { id, name, created_at: now };
}

export function listProjects(): ProjectRow[] {
  return getDb()
    .prepare("SELECT * FROM projects ORDER BY created_at DESC")
    .all() as unknown as ProjectRow[];
}

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
