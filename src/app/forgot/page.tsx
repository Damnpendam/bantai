"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthShell, Field, FormError, postJson } from "@/components/AuthShell";
import { Button, Spinner } from "@/components/ui";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, data } = await postJson("/api/auth/forgot", { email });
    setBusy(false);
    if (!ok) {
      setError(data.error ?? "Something went wrong. Try again.");
      return;
    }
    setSent(true);
  }

  const back = (
    <Link href="/login" className="underline hover:text-ink">
      Back to sign in
    </Link>
  );

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={
          <>
            If <span className="font-medium text-ink">{email}</span> has an account, a reset link
            is on its way. It expires in an hour.
          </>
        }
        footer={back}
      >
        <p className="text-sm text-ink-faint">
          Nothing arriving? Check spam, or ask your administrator — they can re-send your invite
          if you never finished signing up.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we'll send you a link to set a new one."
      footer={back}
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
        <FormError message={error} />
        <Button variant="primary" type="submit" className="w-full" disabled={busy}>
          {busy ? <Spinner /> : null} Send reset link
        </Button>
      </form>
    </AuthShell>
  );
}
