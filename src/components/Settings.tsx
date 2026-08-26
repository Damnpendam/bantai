"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { clsx } from "@/lib/clsx";

export interface ProviderInfo {
  id: string;
  label: string;
  keyUrl: string;
  keyPlaceholder: string;
  defaultModel: string;
  fallbackModels: { id: string; label: string }[];
  hasKey: boolean;
  keyHint: string | null;
}

export interface SettingsState {
  provider: string;
  model: string;
  effort: string;
  concurrency: number;
  providers: ProviderInfo[];
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export function Settings({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (state: SettingsState) => void;
}) {
  const [state, setState] = useState<SettingsState | null>(null);
  const [selected, setSelected] = useState<string>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [live, setLive] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setApiKey("");
    void fetch("/api/settings")
      .then((r) => r.json())
      .then((fresh: SettingsState) => {
        setState(fresh);
        setSelected(fresh.provider);
      });
  }, [open]);

  const loadModels = useCallback(async (providerId: string) => {
    setLoadingModels(true);
    const data = await fetch(`/api/settings/models?provider=${providerId}`).then((r) =>
      r.json(),
    );
    setModels(data.models ?? []);
    setLive(Boolean(data.live));
    setLoadingModels(false);
  }, []);

  useEffect(() => {
    if (!open || !selected) return;
    void loadModels(selected);
  }, [open, selected, loadModels]);

  if (!open || !state) return null;

  const info = state.providers.find((p) => p.id === selected) ?? state.providers[0];
  const active = selected === state.provider;
  const model = active ? state.model : info.defaultModel;

  function choose(providerId: string) {
    setSelected(providerId);
    setApiKey("");
    setError(null);
    const target = state!.providers.find((p) => p.id === providerId);
    setState({
      ...state!,
      provider: providerId,
      model: target?.defaultModel ?? state!.model,
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: state!.provider,
        apiKey: apiKey || undefined,
        apiKeyProvider: selected,
        model: state!.model,
        effort: state!.effort,
        concurrency: state!.concurrency,
      }),
    });
    const body = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(body.error ?? "Could not save settings.");
      return;
    }
    onSaved(body as SettingsState);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-medium">Settings</h2>

        <label className="mt-4 block text-sm font-medium">Provider</label>
        <div className="mt-1.5 flex gap-1.5">
          {state.providers.map((p) => (
            <button
              key={p.id}
              onClick={() => choose(p.id)}
              className={clsx(
                "flex-1 rounded-lg border px-3 py-2 text-sm transition",
                selected === p.id
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line-strong text-ink-soft hover:bg-canvas",
              )}
            >
              {p.label}
              {p.hasKey ? <span className="ml-1.5 text-xs opacity-70">key set</span> : null}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-sm font-medium">{info.label} API key</label>
        <input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={info.hasKey ? `Saved (${info.keyHint})` : info.keyPlaceholder}
          className="mt-1.5 w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        />
        <p className="mt-1.5 text-xs text-ink-faint">
          Stored server-side in this app&rsquo;s local database and sent only to{" "}
          {info.label}.{" "}
          <a
            href={info.keyUrl}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-ink-soft"
          >
            Get a key
          </a>
        </p>

        <div className="mt-4 flex items-baseline justify-between">
          <label className="block text-sm font-medium">Model</label>
          <span className="text-xs text-ink-faint">
            {loadingModels ? "loading…" : live ? "from your account" : "suggested"}
          </span>
        </div>
        <input
          list="model-options"
          value={model}
          onChange={(e) => setState({ ...state, model: e.target.value })}
          className="mt-1.5 w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-accent/40"
        />
        <datalist id="model-options">
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </datalist>
        <p className="mt-1.5 text-xs text-ink-faint">
          Free text, so a model released after this app was built still works. Only
          models supporting schema-constrained output are listed — every agent depends
          on it.
        </p>

        <label className="mt-4 block text-sm font-medium">Effort</label>
        <select
          value={state.effort}
          onChange={(e) => setState({ ...state, effort: e.target.value })}
          className="mt-1.5 w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        >
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-ink-faint">
          Higher effort means deeper reasoning per agent, more tokens, and a slower run.
          Providers expose fewer levels than this scale, so xhigh and max both map to
          their highest.
        </p>

        <label className="mt-4 block text-sm font-medium">Agents at once</label>
        <select
          value={state.concurrency}
          onChange={(e) =>
            setState({ ...state, concurrency: Number(e.target.value) })
          }
          className="mt-1.5 w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        >
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-ink-faint">
          Each wave has four agents. Running all four at once is fastest, but free
          tiers reject bursts — drop to 1 or 2 if suites fail with rate-limit errors.
        </p>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? <Spinner /> : null} Save
          </Button>
        </div>
      </div>
    </div>
  );
}
