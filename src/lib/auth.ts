// Relative, extension-qualified imports so auth.test.ts can drive this module
// under the node test runner. store.ts only imports types, so it is safe here.
import { randomUUID } from "node:crypto";
import { db, type ProjectRow } from "./store.ts";
import {
  burnPasswordCheck,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "./password.ts";
import { encrypt, hashToken, randomToken } from "./secrets.ts";

/**
 * Accounts, sessions, invites, password resets and workspaces — and the one
 * function every project-scoped request goes through to prove the caller may
 * see that project.
 *
 * Tenancy: a workspace is the tenant. Projects belong to a workspace; users
 * reach a project only through a workspace membership. The super admin role
 * grants user management, not data access — a super admin sees other
 * tenants' projects exactly as much as anyone else does: not at all.
 */

export type Role = "superadmin" | "member";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: number;
  disabledAt: number | null;
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
}

export interface Invite {
  id: string;
  email: string;
  role: Role;
  invitedBy: string | null;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  revokedAt: number | null;
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;
/** last_seen_at is a convenience, not worth a write on every request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** A failure the caller may show to the user verbatim. */
export class AuthError extends Error {
  // Declared, not a constructor parameter property: node's strip-only
  // TypeScript mode (the test runner) can't execute parameter properties.
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: unknown): email is string {
  return (
    typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  );
}

/**
 * Runs `fn` inside a write transaction. node:sqlite is synchronous, so as long
 * as `fn` never awaits, nothing else in this process can interleave with it.
 */
function transaction<T>(fn: () => T): T {
  const handle = db();
  handle.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    handle.exec("COMMIT");
    return result;
  } catch (error) {
    handle.exec("ROLLBACK");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function toUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    role: row.role as Role,
    createdAt: row.created_at as number,
    disabledAt: (row.disabled_at as number | null) ?? null,
  };
}

export function getUserById(id: string): User | null {
  const row = db().prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? toUser(row) : null;
}

export function getUserByEmail(email: string): User | null {
  const row = db()
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(normalizeEmail(email)) as Record<string, unknown> | undefined;
  return row ? toUser(row) : null;
}

export function listUsers(): User[] {
  return (
    db().prepare("SELECT * FROM users ORDER BY created_at").all() as Record<string, unknown>[]
  ).map(toUser);
}

export function hasSuperadmin(): boolean {
  return Boolean(
    db()
      .prepare("SELECT 1 FROM users WHERE role = 'superadmin' AND disabled_at IS NULL LIMIT 1")
      .get(),
  );
}

function activeSuperadminCount(): number {
  return (
    db()
      .prepare("SELECT count(*) AS n FROM users WHERE role = 'superadmin' AND disabled_at IS NULL")
      .get() as { n: number }
  ).n;
}

/** Disabling also ends every session the user has, immediately. */
export function setUserDisabled(userId: string, disabled: boolean): User {
  const user = getUserById(userId);
  if (!user) throw new AuthError("No such user.", "not_found");
  if (disabled && user.role === "superadmin" && !user.disabledAt && activeSuperadminCount() <= 1) {
    throw new AuthError("You can't disable the last super admin.", "last_admin");
  }
  transaction(() => {
    db()
      .prepare("UPDATE users SET disabled_at = ? WHERE id = ?")
      .run(disabled ? Date.now() : null, userId);
    if (disabled) db().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  });
  return getUserById(userId)!;
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

function toWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: row.id as string,
    name: row.name as string,
    createdAt: row.created_at as number,
  };
}

function insertWorkspace(name: string, ownerId: string): Workspace {
  const id = randomUUID();
  const now = Date.now();
  db()
    .prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)")
    .run(id, name, now);
  db()
    .prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
    )
    .run(id, ownerId, now);
  return { id, name, createdAt: now };
}

export function workspacesForUser(userId: string): Workspace[] {
  return (
    db()
      .prepare(
        `SELECT w.* FROM workspaces w
         JOIN workspace_members m ON m.workspace_id = w.id
         WHERE m.user_id = ?
         ORDER BY w.created_at`,
      )
      .all(userId) as Record<string, unknown>[]
  ).map(toWorkspace);
}

/** The workspace a user lands in: their oldest membership, i.e. their own. */
export function primaryWorkspace(userId: string): Workspace | null {
  return workspacesForUser(userId)[0] ?? null;
}

/** Owners manage a workspace's settings and keys; plain members only use them. */
export function isOwner(userId: string, workspaceId: string): boolean {
  return Boolean(
    db()
      .prepare(
        "SELECT 1 FROM workspace_members WHERE user_id = ? AND workspace_id = ? AND role = 'owner'",
      )
      .get(userId, workspaceId),
  );
}

export function isMember(userId: string, workspaceId: string): boolean {
  return Boolean(
    db()
      .prepare("SELECT 1 FROM workspace_members WHERE user_id = ? AND workspace_id = ?")
      .get(userId, workspaceId),
  );
}

/**
 * The tenancy choke point. Returns the project only if the user is a member of
 * the workspace that owns it — and null otherwise, whether the project belongs
 * to someone else or doesn't exist at all, so callers answer both with the same
 * 404 and never confirm an id exists.
 */
export function projectForUser(userId: string, projectId: string): ProjectRow | null {
  const row = db()
    .prepare(
      `SELECT p.* FROM projects p
       JOIN workspace_members m ON m.workspace_id = p.workspace_id
       JOIN users u ON u.id = m.user_id
       WHERE p.id = ? AND m.user_id = ? AND u.disabled_at IS NULL`,
    )
    .get(projectId, userId) as ProjectRow | undefined;
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): { token: string; expiresAt: number } {
  const token = randomToken();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  db()
    .prepare(
      `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      hashToken(token),
      userId,
      now,
      expiresAt,
      now,
      meta.userAgent?.slice(0, 300) ?? null,
      meta.ip?.slice(0, 64) ?? null,
    );
  return { token, expiresAt };
}

export function validateSession(token: string | undefined | null): User | null {
  if (!token) return null;
  const id = hashToken(token);
  const row = db()
    .prepare(
      `SELECT s.expires_at AS expires_at, s.last_seen_at AS last_seen_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const now = Date.now();
  if ((row.expires_at as number) <= now) {
    db().prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return null;
  }
  if (row.disabled_at) return null;
  if (now - (row.last_seen_at as number) > TOUCH_INTERVAL_MS) {
    db().prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now, id);
  }
  return toUser(row);
}

export function revokeSession(token: string | undefined | null): void {
  if (!token) return;
  db().prepare("DELETE FROM sessions WHERE id = ?").run(hashToken(token));
}

export function revokeUserSessions(userId: string): void {
  db().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

/**
 * Email + password → user, or null. Every path spends one full password
 * derivation, so timing doesn't reveal whether the email has an account.
 */
export async function authenticate(email: string, password: string): Promise<User | null> {
  const row = db()
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(normalizeEmail(email)) as Record<string, unknown> | undefined;
  if (!row) {
    await burnPasswordCheck(password);
    return null;
  }
  const ok = await verifyPassword(password, row.password_hash as string);
  if (!ok || row.disabled_at) return null;
  return toUser(row);
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

function toInvite(row: Record<string, unknown>): Invite {
  return {
    id: row.id as string,
    email: row.email as string,
    role: row.role as Role,
    invitedBy: (row.invited_by as string | null) ?? null,
    createdAt: row.created_at as number,
    expiresAt: row.expires_at as number,
    acceptedAt: (row.accepted_at as number | null) ?? null,
    revokedAt: (row.revoked_at as number | null) ?? null,
  };
}

/**
 * Issue an invite. Any earlier open invite for the same address is revoked, so
 * exactly one link works at a time. The raw token is returned once, here, and
 * never stored.
 */
export function createInvite(input: {
  email: string;
  role: Role;
  invitedBy: string | null;
}): { invite: Invite; token: string } {
  if (!isValidEmail(input.email)) {
    throw new AuthError("That doesn't look like an email address.", "bad_email");
  }
  if (input.role !== "member" && input.role !== "superadmin") {
    throw new AuthError("Unknown role.", "bad_role");
  }
  const email = normalizeEmail(input.email);
  if (getUserByEmail(email)) {
    throw new AuthError("That email already has an account.", "exists");
  }
  const token = randomToken();
  const now = Date.now();
  const id = randomUUID();
  transaction(() => {
    db()
      .prepare(
        "UPDATE invites SET revoked_at = ? WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL",
      )
      .run(now, email);
    db()
      .prepare(
        `INSERT INTO invites (id, email, role, token_hash, invited_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, email, input.role, hashToken(token), input.invitedBy, now, now + INVITE_TTL_MS);
  });
  return { invite: getInvite(id)!, token };
}

export function getInvite(id: string): Invite | null {
  const row = db().prepare("SELECT * FROM invites WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? toInvite(row) : null;
}

export function listInvites(limit = 200): Invite[] {
  return (
    db()
      .prepare("SELECT * FROM invites ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[]
  ).map(toInvite);
}

export function revokeInvite(id: string): Invite {
  const invite = getInvite(id);
  if (!invite) throw new AuthError("No such invite.", "not_found");
  if (invite.acceptedAt) throw new AuthError("That invite was already accepted.", "accepted");
  db()
    .prepare("UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .run(Date.now(), id);
  return getInvite(id)!;
}

/** A fresh link for the same person and role; the old link stops working. */
export function reissueInvite(id: string): { invite: Invite; token: string } {
  const invite = getInvite(id);
  if (!invite) throw new AuthError("No such invite.", "not_found");
  if (invite.acceptedAt) throw new AuthError("That invite was already accepted.", "accepted");
  return createInvite({ email: invite.email, role: invite.role, invitedBy: invite.invitedBy });
}

/** An invite that can still be accepted, or null. */
export function openInviteByToken(token: string | undefined | null): Invite | null {
  if (!token) return null;
  const row = db()
    .prepare(
      `SELECT * FROM invites
       WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    )
    .get(hashToken(token), Date.now()) as Record<string, unknown> | undefined;
  return row ? toInvite(row) : null;
}

export function nameProblem(name: unknown): string | null {
  if (typeof name !== "string" || !name.trim()) return "Your name is required.";
  if (name.trim().length > 80) return "Use at most 80 characters for your name.";
  return null;
}

/**
 * Turn an invite into an account: user, personal workspace, owner membership.
 * The invite is claimed with a conditional UPDATE inside the same transaction,
 * so a double-submitted form creates one account, not two.
 */
export async function acceptInvite(
  token: string,
  input: { name: string; password: string },
): Promise<User> {
  const invite = openInviteByToken(token);
  if (!invite) {
    throw new AuthError("This invite link is invalid, expired, or already used.", "invalid_invite");
  }
  const badName = nameProblem(input.name);
  if (badName) throw new AuthError(badName, "bad_name");
  const badPassword = passwordProblem(input.password);
  if (badPassword) throw new AuthError(badPassword, "bad_password");

  // The one slow step runs before the transaction, which must not await.
  const passwordHash = await hashPassword(input.password);
  const name = input.name.trim();

  const user = transaction(() => {
    const claimed = db()
      .prepare(
        `UPDATE invites SET accepted_at = ?
         WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
      )
      .run(Date.now(), invite.id, Date.now());
    if (Number(claimed.changes) !== 1) {
      throw new AuthError("This invite link is invalid, expired, or already used.", "invalid_invite");
    }
    if (getUserByEmail(invite.email)) {
      throw new AuthError("That email already has an account.", "exists");
    }
    const id = randomUUID();
    db()
      .prepare(
        `INSERT INTO users (id, email, name, password_hash, role, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, invite.email, name, passwordHash, invite.role, Date.now());
    const workspace = insertWorkspace(`${name}'s workspace`, id);
    if (invite.role === "superadmin") adoptLegacyData(workspace.id);
    return getUserById(id)!;
  });
  audit(user.id, "invite.accepted", invite.email);
  return user;
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/**
 * A reset link for an active account, or null. Callers must respond the same
 * way either way, so the endpoint can't be used to test which emails exist.
 */
export function createPasswordReset(email: string): { user: User; token: string } | null {
  const user = getUserByEmail(email);
  if (!user || user.disabledAt) return null;
  const token = randomToken();
  const now = Date.now();
  transaction(() => {
    db()
      .prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL")
      .run(now, user.id);
    db()
      .prepare(
        `INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), user.id, hashToken(token), now, now + RESET_TTL_MS);
  });
  return { user, token };
}

export function openResetByToken(token: string | undefined | null): { userId: string } | null {
  if (!token) return null;
  const row = db()
    .prepare(
      "SELECT user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
    )
    .get(hashToken(token), Date.now()) as { user_id: string } | undefined;
  return row ? { userId: row.user_id } : null;
}

/** Sets the new password and signs the user out everywhere. */
export async function resetPassword(token: string, password: string): Promise<User> {
  const open = openResetByToken(token);
  if (!open) throw new AuthError("This reset link is invalid or has expired.", "invalid_reset");
  const bad = passwordProblem(password);
  if (bad) throw new AuthError(bad, "bad_password");
  const passwordHash = await hashPassword(password);
  transaction(() => {
    const used = db()
      .prepare(
        "UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
      )
      .run(Date.now(), hashToken(token), Date.now());
    if (Number(used.changes) !== 1) {
      throw new AuthError("This reset link is invalid or has expired.", "invalid_reset");
    }
    db().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, open.userId);
    db().prepare("DELETE FROM sessions WHERE user_id = ?").run(open.userId);
  });
  audit(open.userId, "password.reset", null);
  return getUserById(open.userId)!;
}

// ---------------------------------------------------------------------------
// Bootstrap and legacy data
// ---------------------------------------------------------------------------

/**
 * Until a super admin exists, issue SUPERADMIN_EMAIL a fresh super-admin
 * invite. Only that inbox (and the server log) ever sees the link, so a
 * stranger reaching a freshly deployed instance cannot claim it. Returns null
 * once an admin exists — after setup this never fires again.
 */
export function issueBootstrapInvite(email: string): { invite: Invite; token: string } | null {
  if (hasSuperadmin()) return null;
  if (getUserByEmail(email)) return null;
  return createInvite({ email, role: "superadmin", invitedBy: null });
}

const LEGACY_SETTING = /^(provider|effort|concurrency|model(:.+)?|apiKey(:.+)?)$/;

/**
 * Before accounts existed there was one global workspace: projects with no
 * owner and one set of provider settings. The first super admin inherits both,
 * once. Plaintext API keys are encrypted on the way over and deleted from the
 * global table, so none survive at rest.
 */
export function adoptLegacyData(workspaceId: string): { projects: number } {
  const handle = db();
  const done = handle
    .prepare("SELECT value FROM settings WHERE key = 'legacy_adopted'")
    .get();
  if (done) return { projects: 0 };

  const moved = handle
    .prepare("UPDATE projects SET workspace_id = ? WHERE workspace_id IS NULL")
    .run(workspaceId);

  const rows = handle.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const upsert = handle.prepare(
    `INSERT INTO workspace_settings (workspace_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(workspace_id, key) DO NOTHING`,
  );
  for (const { key, value } of rows) {
    if (!LEGACY_SETTING.test(key)) continue;
    // Pre-multi-provider installs kept a bare key and model, always Anthropic's.
    const target = key === "apiKey" ? "apiKey:anthropic" : key === "model" ? "model:anthropic" : key;
    upsert.run(workspaceId, target, target.startsWith("apiKey:") ? encrypt(value) : value);
    handle.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }

  handle
    .prepare("INSERT INTO settings (key, value) VALUES ('legacy_adopted', ?)")
    .run(workspaceId);
  return { projects: Number(moved.changes) };
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: string;
  actorId: string | null;
  action: string;
  target: string | null;
  createdAt: number;
}

export function audit(actorId: string | null, action: string, target: string | null): void {
  db()
    .prepare(
      "INSERT INTO audit_log (id, actor_id, action, target, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(randomUUID(), actorId, action, target, Date.now());
}

export function listAudit(limit = 100): AuditEntry[] {
  return (
    db()
      .prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[]
  ).map((row) => ({
    id: row.id as string,
    actorId: (row.actor_id as string | null) ?? null,
    action: row.action as string,
    target: (row.target as string | null) ?? null,
    createdAt: row.created_at as number,
  }));
}
