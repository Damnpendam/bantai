"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthShell, Field, FormError, postJson, takeHashToken } from "@/components/AuthShell";
import { Button, Spinner } from "@/components/ui";

const MIN_PASSWORD = 10;

export default function ResetPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"checking" | "ready" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const found = takeHashToken("/reset");
    if (!found) {
      setState("invalid");
      return;
    }
    setToken(found);
    void postJson<{ valid: boolean }>("/api/auth/reset", { token: found }).then(({ ok, data }) => {
      setState(ok && data.valid ? "ready" : "invalid");
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
    const { ok, data } = await postJson("/api/auth/reset", { token, password });
    if (!ok) {
      setError(data.error ?? "Couldn't reset your password.");
      setBusy(false);
      return;
    }
    router.replace("/");
  }

  const again = (
    <Link href="/forgot" className="underline hover:text-ink">
      Request a new link
    </Link>
  );

  if (state === "checking") {
    return (
      <AuthShell title="Checking your link…">
        <div className="flex justify-center py-4 text-ink-faint">
          <Spinner />
        </div>
      </AuthShell>
    );
  }

  if (state === "invalid") {
    return (
      <AuthShell
        title="This link can't be used"
        subtitle="Reset links expire after an hour and work once."
        footer={again}
      >
        <p className="text-sm text-ink-faint">Request a fresh one and use it straight away.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="You'll be signed out everywhere else once it's set."
    >
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          hint={`At least ${MIN_PASSWORD} characters.`}
        />
        <Field
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
        />
        <FormError message={error} />
        <Button variant="primary" type="submit" className="w-full" disabled={busy}>
          {busy ? <Spinner /> : null} Set password
        </Button>
      </form>
    </AuthShell>
  );
}
