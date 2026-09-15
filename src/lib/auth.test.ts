import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bantai-auth-"));
process.env.BANTAI_DATA_DIR = tmp;
process.env.APP_SECRET = "test-secret-that-is-comfortably-over-32-chars";
const store = await import("./store.ts");
const auth = await import("./auth.ts");
const { decrypt, isEncrypted } = await import("./secrets.ts");

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PASSWORD = "a perfectly fine passphrase";

function email(tag: string): string {
  return `${tag}-${randomUUID().slice(0, 8)}@example.com`;
}

async function member(tag: string) {
  const { token } = auth.createInvite({ email: email(tag), role: "member", invitedBy: null });
  const user = await auth.acceptInvite(token, { name: tag, password: PASSWORD });
  return { user, workspace: auth.primaryWorkspace(user.id)! };
}

// Runs first: the legacy data and bootstrap only happen before any admin exists.
test("bootstrap: the first super admin adopts pre-tenancy projects and settings", async () => {
  const orphan = randomUUID();
  store.createProject(orphan, "Legacy project"); // no workspace: visible to nobody
  store.setSetting("apiKey:openrouter", "sk-or-legacy-plaintext");
  store.setSetting("provider", "openrouter");
  store.setSetting("model:openrouter", "deepseek/deepseek-v4-flash");

  assert.equal(auth.hasSuperadmin(), false);
  const boot = auth.issueBootstrapInvite("owner@example.com");
  assert.ok(boot, "an invite is issued while no admin exists");
  assert.equal(boot.invite.role, "superadmin");

  const admin = await auth.acceptInvite(boot.token, { name: "Owner", password: PASSWORD });
  assert.equal(admin.role, "superadmin");
  const ws = auth.primaryWorkspace(admin.id)!;

  assert.ok(auth.projectForUser(admin.id, orphan), "the orphan project now belongs to the admin");
  const sealed = store.getWorkspaceSetting(ws.id, "apiKey:openrouter")!;
  assert.ok(isEncrypted(sealed), "the adopted key is encrypted at rest");
  assert.equal(decrypt(sealed), "sk-or-legacy-plaintext");
  assert.equal(store.getSetting("apiKey:openrouter"), null, "no plaintext key is left behind");
  assert.equal(store.getWorkspaceSetting(ws.id, "model:openrouter"), "deepseek/deepseek-v4-flash");

  assert.equal(auth.issueBootstrapInvite("someone-else@example.com"), null, "never again once an admin exists");
});

test("an invite becomes an account with its own workspace, exactly once", async () => {
  const address = email("new");
  const { token } = auth.createInvite({ email: address, role: "member", invitedBy: null });
  assert.ok(auth.openInviteByToken(token));

  const user = await auth.acceptInvite(token, { name: "New Person", password: PASSWORD });
  assert.equal(user.email, address);
  assert.equal(user.role, "member");
  const ws = auth.primaryWorkspace(user.id);
  assert.ok(ws);
  assert.ok(auth.isMember(user.id, ws.id));

  assert.equal(auth.openInviteByToken(token), null, "the link is spent");
  await assert.rejects(
    auth.acceptInvite(token, { name: "Again", password: PASSWORD }),
    (e: Error) => e instanceof auth.AuthError && (e as InstanceType<typeof auth.AuthError>).code === "invalid_invite",
  );
});

test("a rejected password leaves the invite usable", async () => {
  const { token } = auth.createInvite({ email: email("weak"), role: "member", invitedBy: null });
  await assert.rejects(auth.acceptInvite(token, { name: "Weak", password: "short" }));
  assert.ok(auth.openInviteByToken(token), "still open after a validation failure");
});

test("expired, revoked and superseded invites are all refused", async () => {
  const expired = auth.createInvite({ email: email("exp"), role: "member", invitedBy: null });
  store.db().prepare("UPDATE invites SET expires_at = ? WHERE id = ?").run(Date.now() - 1, expired.invite.id);
  assert.equal(auth.openInviteByToken(expired.token), null);

  const revoked = auth.createInvite({ email: email("rev"), role: "member", invitedBy: null });
  auth.revokeInvite(revoked.invite.id);
  assert.equal(auth.openInviteByToken(revoked.token), null);

  const address = email("again");
  const first = auth.createInvite({ email: address, role: "member", invitedBy: null });
  const second = auth.createInvite({ email: address, role: "member", invitedBy: null });
  assert.equal(auth.openInviteByToken(first.token), null, "only the newest link works");
  assert.ok(auth.openInviteByToken(second.token));
});

test("an address that already has an account can't be invited", async () => {
  const { user } = await member("taken");
  assert.throws(
    () => auth.createInvite({ email: user.email.toUpperCase(), role: "member", invitedBy: null }),
    (e: Error) => (e as InstanceType<typeof auth.AuthError>).code === "exists",
  );
});

test("login: right password in, wrong password and unknown email out", async () => {
  const { user } = await member("login");
  assert.equal((await auth.authenticate(user.email, PASSWORD))?.id, user.id);
  assert.equal(await auth.authenticate(user.email, "not the password"), null);
  assert.equal(await auth.authenticate("nobody@example.com", PASSWORD), null);
});

test("sessions validate, revoke, expire, and die with a disabled account", async () => {
  const { user } = await member("sess");
  const { token } = auth.createSession(user.id);
  assert.equal(auth.validateSession(token)?.id, user.id);
  assert.equal(auth.validateSession("not-a-real-token"), null);

  auth.revokeSession(token);
  assert.equal(auth.validateSession(token), null, "revoked");

  const second = auth.createSession(user.id);
  store.db().prepare("UPDATE sessions SET expires_at = ? WHERE user_id = ?").run(Date.now() - 1, user.id);
  assert.equal(auth.validateSession(second.token), null, "expired");

  const third = auth.createSession(user.id);
  auth.setUserDisabled(user.id, true);
  assert.equal(auth.validateSession(third.token), null, "disabled");
  assert.equal(await auth.authenticate(user.email, PASSWORD), null, "a disabled account can't log in");
});

test("tenancy: nobody reaches another workspace's project — not even a super admin", async () => {
  const a = await member("alice");
  const b = await member("bob");
  const admin = auth.listUsers().find((u) => u.role === "superadmin")!;

  const project = randomUUID();
  store.createProject(project, "Alice's project", a.workspace.id, a.user.id);

  assert.ok(auth.projectForUser(a.user.id, project), "the owner can");
  assert.equal(auth.projectForUser(b.user.id, project), null, "another member can't");
  assert.equal(auth.projectForUser(admin.id, project), null, "the super admin can't");
  assert.equal(auth.projectForUser(a.user.id, randomUUID()), null, "a missing id looks the same as a foreign one");

  assert.deepEqual(store.listProjects(b.workspace.id).map((p) => p.id), [], "listing is scoped too");
  assert.deepEqual(store.listProjects(a.workspace.id).map((p) => p.id), [project]);

  auth.setUserDisabled(a.user.id, true);
  assert.equal(auth.projectForUser(a.user.id, project), null, "a disabled owner loses access");
});

test("password reset sets a new password, signs out everywhere, and works once", async () => {
  const { user } = await member("reset");
  const session = auth.createSession(user.id);

  assert.equal(auth.createPasswordReset("nobody-here@example.com"), null);
  const reset = auth.createPasswordReset(user.email)!;
  await auth.resetPassword(reset.token, "a brand new passphrase");

  assert.equal(auth.validateSession(session.token), null, "old sessions are gone");
  assert.equal(await auth.authenticate(user.email, PASSWORD), null);
  assert.equal((await auth.authenticate(user.email, "a brand new passphrase"))?.id, user.id);
  await assert.rejects(auth.resetPassword(reset.token, "yet another passphrase"), "single use");
});

test("the last super admin can't be disabled", () => {
  const admins = auth.listUsers().filter((u) => u.role === "superadmin" && !u.disabledAt);
  assert.equal(admins.length, 1);
  assert.throws(
    () => auth.setUserDisabled(admins[0].id, true),
    (e: Error) => (e as InstanceType<typeof auth.AuthError>).code === "last_admin",
  );
});
