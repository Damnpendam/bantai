"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardHead, Spinner } from "@/components/ui";
import { postJson } from "@/components/AuthShell";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: "superadmin" | "member";
  createdAt: number;
  disabledAt: number | null;
}

interface InviteRow {
  id: string;
  email: string;
  role: "superadmin" | "member";
  createdAt: number;
  expiresAt: number;
  status: "pending" | "accepted" | "revoked" | "expired";
}

interface AuditRow {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  createdAt: number;
}

interface Overview {
  me: string;
  users: UserRow[];
  invites: InviteRow[];
  emailConfigured: boolean;
  platform: { provider: string; model: string; dailyRuns: number; dailyIngests: number } | null;
  audit: AuditRow[];
}

interface IssuedLink {
  email: string;
  link: string;
  emailed: boolean;
  emailError: string | null;
}

/** What the invite and resend endpoints return. */
interface IssuedResponse {
  invite?: { email: string };
  link?: string;
  emailed?: boolean;
  emailError?: string | null;
}

const STATUS_TONE: Record<InviteRow["status"], "good" | "warn" | "neutral" | "bad"> = {
  pending: "warn",
  accepted: "good",
  revoked: "neutral",
  expired: "bad",
};

const ACTION_COPY: Record<string, string> = {
  "invite.sent": "invited",
  "invite.sent_admin": "invited as super admin",
  "invite.resent": "re-sent an invite to",
  "invite.revoked": "revoked the invite for",
  "invite.accepted": "joined as",
  "user.disabled": "disabled",
  "user.enabled": "re-enabled",
  "password.reset": "reset their password",
  "password.reset_requested": "requested a password reset",
};

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [denied, setDenied] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "superadmin">("member");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/overview");
    if (response.status === 401) {
      window.location.replace("/login?next=/admin");
      return;
    }
    if (response.status === 403) {
      setDenied(true);
      return;
    }
    setData((await response.json()) as Overview);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function showIssued(result: IssuedResponse) {
    if (!result.invite || !result.link) return;
    setCopied(false);
    setIssued({
      email: result.invite.email,
      link: result.link,
      emailed: Boolean(result.emailed),
      emailError: result.emailError ?? null,
    });
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setBusy("invite");
    setError(null);
    setIssued(null);
    const { ok, data: body } = await postJson<IssuedResponse>("/api/admin/invites", {
      email,
      role,
    });
    setBusy(null);
    if (!ok) {
      setError(body.error ?? "Couldn't send the invite.");
      return;
    }
    showIssued(body);
    setEmail("");
    setRole("member");
    await load();
  }

  async function inviteAction(id: string, action: "revoke" | "resend") {
    setBusy(`${action}:${id}`);
    setError(null);
    const { ok, data: body } = await postJson<IssuedResponse>(`/api/admin/invites/${id}`, {
      action,
    });
    setBusy(null);
    if (!ok) {
      setError(body.error ?? "That didn't work.");
      return;
    }
    if (action === "resend") showIssued(body);
    await load();
  }

  async function setDisabled(user: UserRow, disabled: boolean) {
    setBusy(`user:${user.id}`);
    setError(null);
    const { ok, data: body } = await postJson(`/api/admin/users/${user.id}`, { disabled });
    setBusy(null);
    if (!ok) {
      setError(body.error ?? "That didn't work.");
      return;
    }
    await load();
  }

  async function copy() {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.link).catch(() => {});
    setCopied(true);
  }

  if (denied) {
    return (
      <div className="mx-auto max-w-md px-5 py-24 text-center">
        <h1 className="text-base font-medium">Admins only</h1>
        <p className="mt-2 text-sm text-ink-soft">
          This page is for super admins. Your account can create projects and generate test
          cases.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm underline">
          Back to your projects
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center text-ink-faint">
        <Spinner />
      </div>
    );
  }

  const pendingInvites = data.invites.filter((i) => i.status === "pending").length;

  return (
    <div className="mx-auto max-w-5xl px-5 py-6">
      <header className="flex flex-wrap items-center gap-3 border-b border-line pb-4">
        <div className="flex items-baseline gap-2">
          <Link href="/" className="text-lg font-medium tracking-tight">
            Bantai
          </Link>
          <span className="text-sm text-ink-faint">admin</span>
        </div>
        <Link href="/" className="ml-auto text-sm text-ink-soft hover:text-ink">
          ← Back to projects
        </Link>
      </header>

      <p className="mt-4 text-sm text-ink-soft">
        You manage who has an account. Each person&rsquo;s projects, documents and test cases are
        private to their own workspace — not visible here, or to you.
      </p>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <div className="space-y-5">
          <Card>
            <CardHead title="Invite someone" hint="They get an email with a link that works once, for 7 days." />
            <form onSubmit={invite} className="flex flex-wrap items-end gap-2 p-4">
              <label className="min-w-56 flex-1">
                <span className="text-xs text-ink-faint">Email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="mt-1 w-full rounded-lg border border-line-strong bg-canvas px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent/40"
                />
              </label>
              <label>
                <span className="text-xs text-ink-faint">Role</span>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as "member" | "superadmin")}
                  className="mt-1 block rounded-lg border border-line-strong bg-canvas px-2.5 py-1.5 text-sm outline-none"
                >
                  <option value="member">Member</option>
                  <option value="superadmin">Super admin</option>
                </select>
              </label>
              <Button variant="primary" type="submit" disabled={busy === "invite"}>
                {busy === "invite" ? <Spinner /> : null} Send invite
              </Button>
            </form>

            {issued ? (
              <div className="border-t border-line px-4 py-3 text-sm">
                {issued.emailed ? (
                  <p className="text-emerald-700 dark:text-emerald-400">
                    Invite emailed to {issued.email}.
                  </p>
                ) : (
                  <p className="text-amber-700 dark:text-amber-400">
                    {issued.emailError ?? "The email wasn't sent."} Copy this link and send it to{" "}
                    {issued.email} yourself:
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  <input
                    readOnly
                    value={issued.link}
                    onFocus={(e) => e.target.select()}
                    className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2.5 py-1 font-mono text-xs"
                  />
                  <Button size="sm" onClick={() => void copy()}>
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                </div>
              </div>
            ) : null}

            {error ? (
              <p className="border-t border-line px-4 py-2.5 text-sm text-red-600">{error}</p>
            ) : null}
          </Card>

          <Card>
            <CardHead title="People" hint={`${data.users.length} account${data.users.length === 1 ? "" : "s"}`} />
            <ul className="divide-y divide-line">
              {data.users.map((user) => (
                <li key={user.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">
                      {user.name}
                      {user.id === data.me ? <span className="text-ink-faint"> (you)</span> : null}
                    </p>
                    <p className="truncate text-xs text-ink-faint">
                      {user.email} · joined {when(user.createdAt)}
                    </p>
                  </div>
                  {user.role === "superadmin" ? <Badge tone="accent">super admin</Badge> : null}
                  {user.disabledAt ? <Badge tone="bad">disabled</Badge> : null}
                  {user.id !== data.me ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === `user:${user.id}`}
                      onClick={() => void setDisabled(user, !user.disabledAt)}
                    >
                      {user.disabledAt ? "Enable" : "Disable"}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHead
              title="Invites"
              hint={pendingInvites ? `${pendingInvites} waiting to be accepted` : "none waiting"}
            />
            {data.invites.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-faint">No invites sent yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.invites.map((inv) => (
                  <li key={inv.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{inv.email}</p>
                      <p className="truncate text-xs text-ink-faint">
                        {inv.role === "superadmin" ? "super admin · " : ""}sent {when(inv.createdAt)}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[inv.status]}>{inv.status}</Badge>
                    {inv.status !== "accepted" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === `resend:${inv.id}`}
                        onClick={() => void inviteAction(inv.id, "resend")}
                      >
                        {inv.status === "pending" ? "Resend" : "Send again"}
                      </Button>
                    ) : null}
                    {inv.status === "pending" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === `revoke:${inv.id}`}
                        onClick={() => void inviteAction(inv.id, "revoke")}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHead title="Server setup" />
            <dl className="space-y-3 px-4 py-3 text-sm">
              <div>
                <dt className="text-xs text-ink-faint">Invite email</dt>
                <dd className="mt-0.5">
                  {data.emailConfigured ? (
                    <Badge tone="good">sending via Resend</Badge>
                  ) : (
                    <span className="text-ink-soft">
                      Not configured — you&rsquo;ll get a link to pass on by hand. Set{" "}
                      <code className="text-xs">RESEND_API_KEY</code> and{" "}
                      <code className="text-xs">EMAIL_FROM</code> to send automatically.
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-faint">Shared model key</dt>
                <dd className="mt-0.5 text-ink-soft">
                  {data.platform ? (
                    <>
                      {data.platform.provider} · <span className="font-mono text-xs">{data.platform.model}</span>
                      <br />
                      Each workspace without its own key gets {data.platform.dailyRuns} runs and{" "}
                      {data.platform.dailyIngests} model builds a day on it.
                    </>
                  ) : (
                    <>
                      None — everyone adds their own API key. Set{" "}
                      <code className="text-xs">PLATFORM_API_KEY</code> to let people try it on
                      yours, with a daily cap.
                    </>
                  )}
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHead title="Recent activity" />
            {data.audit.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-faint">Nothing yet.</p>
            ) : (
              <ul className="max-h-96 space-y-2 overflow-y-auto px-4 py-3 text-xs text-ink-soft">
                {data.audit.map((entry) => (
                  <li key={entry.id}>
                    <span className="text-ink">{entry.actor}</span>{" "}
                    {ACTION_COPY[entry.action] ?? entry.action}
                    {entry.target && entry.target !== entry.actor ? (
                      <span className="text-ink"> {entry.target}</span>
                    ) : null}
                    <span className="block text-ink-faint">{when(entry.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
