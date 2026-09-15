"use client";

/** The centred card every signed-out page (login, signup, reset) sits in. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-baseline justify-center gap-2">
          <span className="text-lg font-medium tracking-tight">Bantai</span>
          <span className="text-sm text-ink-faint">test case agents</span>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6">
          <h1 className="text-base font-medium">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-ink-soft">{subtitle}</p> : null}
          <div className="mt-5">{children}</div>
        </div>
        {footer ? <div className="mt-4 text-center text-sm text-ink-faint">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        {...input}
        className="mt-1.5 w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60"
      />
      {hint ? <span className="mt-1 block text-xs text-ink-faint">{hint}</span> : null}
    </label>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
      {message}
    </p>
  );
}

/** Reads `#token=…` once, then strips it so it isn't left in history or on screen. */
export function takeHashToken(path: string): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (token) window.history.replaceState(null, "", path);
  return token;
}

export async function postJson<T = Record<string, unknown>>(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    return { ok: response.ok, status: response.status, data };
  } catch {
    return {
      ok: false,
      status: 0,
      data: { error: "Couldn't reach the server. Check your connection and try again." } as T & {
        error?: string;
      },
    };
  }
}
