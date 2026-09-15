"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthShell, Field, FormError, postJson, takeHashToken } from "@/components/AuthShell";
import { Button, Spinner } from "@/components/ui";

const MIN_PASSWORD = 10;

type Invite = { email: string; role: "member" | "superadmin" };

export default function SignupPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [state, setState] = useState<"checking" | "ready" | "invalid">("checking");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const found = takeHashToken("/signup");
    if (!found) {
      setState("invalid");
      return;
    }
    setToken(found);
    void postJson<Invite>("/api/auth/invite", { token: found }).then(({ ok, data }) => {
      if (!ok) {
        setError(data.error ?? null);
        setState("invalid");
        return;
      }
      setInvite({ email: data.email, role: data.role });
      setState("ready");
    });
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const { ok, data } = await postJson("/api/auth/signup", { token, name, password });
    if (!ok) {
      setError(data.error ?? "Couldn't create your account.");
      setBusy(false);
      return;
    }
    router.replace("/");
  }

  if (state === "checking") {
    return (
      <AuthShell title="Checking your invite…">
        <div className="flex justify-center py-4 text-ink-faint">
          <Spinner />
        </div>
      </AuthShell>
    );
  }

  if (state === "invalid" || !invite) {
    return (
      <AuthShell
        title="This invite can't be used"
        subtitle={
          error ??
          "The link is missing, expired, or already used. Ask your administrator to send a new one."
        }
        footer={
          <Link href="/login" className="underline hover:text-ink">
            Already have an account? Sign in
          </Link>
        }
      >
        <p className="text-sm text-ink-faint">Invite links work once and expire after 7 days.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={invite.role === "superadmin" ? "Set up your admin account" : "Create your account"}
      subtitle={
        <>
          For <span className="font-medium text-ink">{invite.email}</span>
          {invite.role === "superadmin" ? " — you'll be able to invite others." : null}
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Your name"
          autoComplete="name"
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          hint={`At least ${MIN_PASSWORD} characters. A passphrase is easiest.`}
        />
        <Field
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
        />
        <FormError message={error} />
        <Button variant="primary" type="submit" className="w-full" disabled={busy}>
          {busy ? <Spinner /> : null} Create account
        </Button>
      </form>
    </AuthShell>
  );
}
