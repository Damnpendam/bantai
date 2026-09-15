"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthShell, Field, FormError, postJson } from "@/components/AuthShell";
import { Button, Spinner } from "@/components/ui";

/** Only same-site relative paths — never an open redirect to another host. */
function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
    ? next
    : "/";
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in? Skip the form.
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (r.ok) router.replace(safeNext());
      })
      .catch(() => {});
  }, [router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, data } = await postJson("/api/auth/login", { email, password });
    if (!ok) {
      setError(data.error ?? "Couldn't sign in.");
      setBusy(false);
      return;
    }
    router.replace(safeNext());
  }

  return (
    <AuthShell
      title="Sign in"
      footer={<>Bantai is invite-only. Ask your administrator for an invite.</>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
        <FormError message={error} />
        <Button variant="primary" type="submit" className="w-full" disabled={busy}>
          {busy ? <Spinner /> : null} Sign in
        </Button>
        <p className="text-center text-sm">
          <Link href="/forgot" className="text-ink-soft underline hover:text-ink">
            Forgot your password?
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
