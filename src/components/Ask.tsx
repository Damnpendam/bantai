"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, CardHead, Spinner } from "@/components/ui";
import type { AskResult, Source, TraceStep } from "@/lib/rag/agent";

interface Status {
  stats: { documents: number; indexedDocuments: number; passages: number; embedded: number };
  skipped: { name: string; reason: string }[];
  cap: number;
  semantic: { available: boolean; provider?: string; source?: "workspace" | "platform" };
}

interface Message {
  role: "user" | "assistant";
  content: string;
  result?: AskResult;
}

const EXAMPLES = [
  "Give me a summary of what these documents cover",
  "Which rules have limits, thresholds or deadlines?",
  "Where do the documents contradict each other?",
];

function describe(step: TraceStep): string {
  switch (step.kind) {
    case "plan":
      return `Planned ${step.queries.length === 1 ? "one search" : `${step.queries.length} searches`}`;
    case "search": {
      const how = step.mode === "hybrid" ? "keyword + semantic" : "keyword";
      const note = step.degraded ? ` (semantic search failed: ${step.degraded})` : "";
      return `Searched “${step.query}” — ${step.found} section${step.found === 1 ? "" : "s"}, ${how}${note}`;
    }
    case "grade":
      return step.sufficient
        ? "Checked the results: enough to answer"
        : `Checked the results: ${step.missing || "something was missing"} — searched again`;
    case "answer":
      return `Wrote the answer from ${step.passages} section${step.passages === 1 ? "" : "s"}`;
  }
}

/** Turns [1] markers into small superscripts, leaving everything else as text. */
function WithCitations({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[\d{1,2}\])/g).map((part, i) =>
        /^\[\d{1,2}\]$/.test(part) ? (
          <sup key={i} className="mx-0.5 text-[11px] font-medium text-accent">
            {part.slice(1, -1)}
          </sup>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function SourceChip({ source }: { source: Source }) {
  return (
    <span
      title={source.excerpt}
      className={
        source.cited
          ? "inline-flex max-w-full items-center gap-1 rounded-md bg-accent-soft px-2 py-1 text-[11px] text-accent"
          : "inline-flex max-w-full items-center gap-1 rounded-md bg-canvas px-2 py-1 text-[11px] text-ink-faint ring-1 ring-line"
      }
    >
      <span className="font-medium">{source.n}</span>
      <span className="truncate">
        {source.documentName}
        {source.heading ? ` › ${source.heading}` : ""}
      </span>
    </span>
  );
}

function Reply({ message }: { message: Message }) {
  const result = message.result;
  const cited = result?.sources.filter((s) => s.cited) ?? [];
  const other = result?.sources.filter((s) => !s.cited) ?? [];
  return (
    <div className="max-w-[92%] space-y-2 rounded-xl bg-canvas px-3.5 py-2.5 text-sm text-ink">
      {result?.outcome === "clarify" ? (
        <p className="text-[11px] font-medium text-ink-faint">Needs a bit more detail</p>
      ) : null}
      <p className="whitespace-pre-wrap leading-relaxed">
        <WithCitations text={message.content} />
      </p>
      {cited.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {cited.map((s) => (
            <SourceChip key={s.n} source={s} />
          ))}
        </div>
      ) : null}
      {result && result.trace.length > 0 ? (
        <details className="text-xs text-ink-faint">
          <summary className="cursor-pointer select-none hover:text-ink-soft">How this was found</summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            {result.trace.map((step, i) => (
              <li key={i}>{describe(step)}</li>
            ))}
          </ul>
          {other.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {other.map((s) => (
                <SourceChip key={s.n} source={s} />
              ))}
            </div>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

export function Ask({
  projectId,
  docCount,
  canAsk,
}: {
  projectId: string;
  docCount: number;
  canAsk: boolean;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const buildingRef = useRef(false);
  const autoStarted = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/rag`).catch(() => null);
    if (response?.ok) setStatus((await response.json()) as Status);
  }, [projectId]);

  // New or removed documents change what there is to search.
  useEffect(() => {
    autoStarted.current = false;
    void load();
  }, [load, docCount]);

  const buildIndex = useCallback(async () => {
    if (buildingRef.current) return;
    buildingRef.current = true;
    setBuilding(true);
    setIndexError(null);
    try {
      // One request stops short of the server's time limit; keep going until done.
      for (let round = 0; round < 20; round += 1) {
        const response = await fetch(`/api/projects/${projectId}/rag/index`, { method: "POST" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setIndexError(data.error ?? "The semantic index could not be built.");
          break;
        }
        setStatus((s) => (s ? { ...s, stats: data.stats } : s));
        if (data.progress.error) {
          setIndexError(data.progress.error);
          break;
        }
        if (data.progress.remaining === 0) break;
      }
    } finally {
      buildingRef.current = false;
      setBuilding(false);
    }
  }, [projectId]);

  // Embedding is cheap next to a model call, and search is better for it: start it
  // by itself, once per change in the documents. A failure leaves a retry button.
  useEffect(() => {
    if (!status || autoStarted.current) return;
    const { passages, embedded } = status.stats;
    if (status.semantic.available && passages > embedded) {
      autoStarted.current = true;
      void buildIndex();
    }
  }, [status, buildIndex]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy || !canAsk) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setError(null);
    setBusy(true);
    const response = await fetch(`/api/projects/${projectId}/rag/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null);
    setBusy(false);
    if (!response?.ok || !data) {
      setError(data?.error ?? "Could not reach the server.");
      return;
    }
    setMessages((m) => [...m, { role: "assistant", content: (data as AskResult).answer, result: data }]);
  }

  const passages = status?.stats.passages ?? 0;
  const embedded = status?.stats.embedded ?? 0;
  const semanticReady = Boolean(status?.semantic.available && passages > 0 && embedded >= passages);
  const noDocs = docCount === 0 || (status !== null && passages === 0);

  return (
    <Card>
      <CardHead
        title="Ask your documents"
        hint={
          status && passages > 0
            ? `${passages.toLocaleString()} sections across ${status.stats.indexedDocuments} document${status.stats.indexedDocuments === 1 ? "" : "s"}`
            : "Answers come only from what you uploaded, with the sections they rely on."
        }
        action={
          building ? (
            <Badge tone="accent">
              <Spinner className="mr-1.5" />
              Indexing {embedded.toLocaleString()} / {passages.toLocaleString()}
            </Badge>
          ) : semanticReady ? (
            <Badge tone="good">Semantic + keyword</Badge>
          ) : status?.semantic.available && passages > embedded ? (
            <Button size="sm" onClick={() => void buildIndex()}>
              Build semantic index
            </Button>
          ) : passages > 0 ? (
            <Badge tone="neutral">Keyword search</Badge>
          ) : undefined
        }
      />

      <div className="space-y-3 px-4 py-3">
        {indexError ? (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Semantic indexing stopped: {indexError} Keyword search still works.
          </p>
        ) : null}
        {status && !status.semantic.available && passages > 0 ? (
          <p className="text-xs text-ink-faint">
            Searching by keywords. Add an OpenRouter or Gemini key in Settings to also match by meaning.
          </p>
        ) : null}
        {status?.skipped.length ? (
          <p className="text-xs text-ink-faint">
            Not searchable: {status.skipped.map((s) => s.name).join(", ")} — {status.skipped[0].reason}
          </p>
        ) : null}

        {noDocs ? (
          <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">
            Upload documents with readable text to start asking questions.
          </div>
        ) : (
          <>
            <div className="max-h-[28rem] min-h-24 space-y-3 overflow-y-auto pr-1">
              {messages.length === 0 && !busy ? (
                <div className="space-y-2 py-2">
                  <p className="text-xs text-ink-faint">Try one of these, or ask your own:</p>
                  <div className="flex flex-wrap gap-2">
                    {EXAMPLES.map((example) => (
                      <button
                        key={example}
                        disabled={!canAsk}
                        onClick={() => void send(example)}
                        className="rounded-lg border border-line px-2.5 py-1.5 text-left text-xs text-ink-soft transition hover:bg-canvas disabled:opacity-45"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {messages.map((message, i) =>
                message.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-accent px-3.5 py-2 text-sm text-white dark:text-[#16150f]">
                      {message.content}
                    </p>
                  </div>
                ) : (
                  <Reply key={i} message={message} />
                ),
              )}
              {busy ? (
                <div className="flex items-center gap-2 text-xs text-ink-faint">
                  <Spinner /> Searching the documents…
                </div>
              ) : null}
              <div ref={endRef} />
            </div>

            {error ? (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">{error}</p>
            ) : null}

            <form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void send(input);
              }}
            >
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send(input);
                  }
                }}
                rows={2}
                maxLength={2000}
                disabled={!canAsk}
                placeholder={canAsk ? "Ask about your documents…" : "Add an API key in Settings to ask questions."}
                className="min-h-[2.75rem] flex-1 resize-none rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-60"
              />
              <Button variant="primary" type="submit" disabled={busy || !canAsk || !input.trim()}>
                Ask
              </Button>
            </form>
          </>
        )}
      </div>
    </Card>
  );
}
