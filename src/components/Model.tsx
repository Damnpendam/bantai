"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, CardHead, Metric, Spinner } from "@/components/ui";
import { ModelGraph } from "@/components/ModelGraph";
import { clsx } from "@/lib/clsx";

interface EntityLite {
  id: string;
  name: string;
  kind: string;
  summary?: string;
}

interface EdgeLite {
  id: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  kind: string;
}

interface Conflict {
  edgeId: string;
  a: EntityLite;
  b: EntityLite;
  quote: string | null;
}

interface PendingFact {
  id: string;
  kind: string;
  reason: string;
}

interface ModelView {
  entities: EntityLite[];
  edges: EdgeLite[];
  pending: PendingFact[];
  conflicts: Conflict[];
}

interface EdgeRef {
  from: string;
  to: string;
  kind: string;
}

interface Summary {
  documentName: string;
  skipped: boolean;
  entitiesCreated: number;
  entitiesMatched: number;
  entitiesAmbiguous: number;
  edgesAdded: number;
  edgesDuplicate: number;
  edgesPending: number;
  supersededEdges: EdgeRef[];
}

interface ImpactView {
  changed: EntityLite[];
  affected: EntityLite[];
}

interface RunResult {
  summaries: Summary[];
  impact: ImpactView | null;
}

const KIND_ORDER = [
  "actor",
  "capability",
  "screen",
  "data_object",
  "state",
  "event",
  "rule",
  "constraint",
];

function groupByKind(entities: EntityLite[]): [string, EntityLite[]][] {
  const map = new Map<string, EntityLite[]>();
  for (const e of entities) {
    const list = map.get(e.kind);
    if (list) list.push(e);
    else map.set(e.kind, [e]);
  }
  return [...map.entries()].sort(
    (a, b) => KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]),
  );
}

/** A section that can be folded away once it has been read. */
function Section({
  title,
  count,
  tone,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  tone?: "bad" | "warn";
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;
  return (
    <div className="border-t border-line">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-xs text-ink-faint">
          <svg
            viewBox="0 0 20 20"
            className={clsx("size-3 transition-transform", open && "rotate-90")}
            fill="currentColor"
          >
            <path d="M7 5l6 5-6 5V5z" />
          </svg>
          {title}
        </span>
        <Badge tone={tone ?? "neutral"}>{count}</Badge>
      </button>
      {open ? <div className="px-4 pb-3">{children}</div> : null}
    </div>
  );
}

export function Model({
  projectId,
  docCount,
}: {
  projectId: string;
  docCount: number;
}) {
  const [model, setModel] = useState<ModelView | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"graph" | "list">("graph");

  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/ingest`);
    if (response.ok) setModel((await response.json()) as ModelView);
  }, [projectId]);

  useEffect(() => {
    setResult(null);
    setError(null);
    setModel(null);
    void load();
  }, [load]);

  async function build(force: boolean) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "Ingestion failed.");
        return;
      }
      setResult(body as RunResult);
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const built = (model?.entities.length ?? 0) > 0;

  return (
    <Card>
      <CardHead
        title="Product model"
        hint={
          built
            ? `${model!.entities.length} entities · ${model!.edges.length} relationships`
            : "not built yet"
        }
        action={
          <div className="flex items-center gap-2">
            {built ? (
              <div className="flex rounded-lg border border-line-strong p-0.5 text-xs">
                {(["graph", "list"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={clsx(
                      "rounded-md px-2 py-1 capitalize transition",
                      view === v ? "bg-accent text-white dark:text-[#16150f]" : "text-ink-soft",
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            ) : null}
            <Button
              size="sm"
              variant={built ? "outline" : "primary"}
              disabled={busy || docCount === 0}
              onClick={() => void build(built)}
            >
              {busy ? <Spinner /> : null} {built ? "Rebuild" : "Build product model"}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-4 gap-2 p-4">
        <Metric label="Entities" value={model?.entities.length ?? 0} />
        <Metric label="Relationships" value={model?.edges.length ?? 0} />
        <Metric label="Pending" value={model?.pending.length ?? 0} />
        <Metric label="Conflicts" value={model?.conflicts.length ?? 0} />
      </div>

      {error ? (
        <p className="border-t border-line px-4 py-2.5 text-sm text-red-600">{error}</p>
      ) : null}

      {docCount === 0 ? (
        <p className="border-t border-line px-4 py-2.5 text-sm text-ink-faint">
          Upload a document, then build the model from it.
        </p>
      ) : null}

      {result ? (
        <div className="border-t border-line px-4 py-3 text-sm">
          <p className="text-xs text-ink-faint">Last build</p>
          <ul className="mt-1 space-y-0.5 text-ink-soft">
            {result.summaries.map((s) => (
              <li key={s.documentName}>
                <span className="text-ink">{s.documentName}</span>:{" "}
                {s.skipped
                  ? "already ingested — no change"
                  : `+${s.entitiesCreated} entities, +${s.edgesAdded} relationships` +
                    (s.entitiesAmbiguous || s.edgesPending
                      ? `, ${s.entitiesAmbiguous + s.edgesPending} sent to pending`
                      : "") +
                    (s.supersededEdges.length
                      ? `, ${s.supersededEdges.length} retired`
                      : "")}
              </li>
            ))}
          </ul>
          {result.impact && result.impact.affected.length > 0 ? (
            <p className="mt-1.5">
              <span className="text-ink-faint">Touches: </span>
              {result.impact.affected.map((e) => e.name).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {built && view === "graph" ? (
        <div className="border-t border-line">
          <ModelGraph entities={model!.entities} edges={model!.edges} />
        </div>
      ) : null}

      {built && view === "list" ? (
        <>
          <div className="border-t border-line px-4 py-3">
            <p className="text-xs text-ink-faint">Entities</p>
            <div className="mt-1.5 space-y-2">
              {groupByKind(model!.entities).map(([kind, items]) => (
                <div key={kind}>
                  <p className="text-[11px] uppercase tracking-wide text-ink-faint">
                    {kind.replace(/_/g, " ")}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {items.map((e) => (
                      <Badge key={e.id}>{e.name}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {model!.edges.length > 0 ? (
            <div className="border-t border-line px-4 py-3">
              <p className="text-xs text-ink-faint">Relationships</p>
              <ul className="mt-1 space-y-0.5 text-sm text-ink-soft">
                {model!.edges.map((e) => (
                  <li key={e.id}>
                    {e.fromName} <span className="text-ink-faint">—{e.kind}→</span>{" "}
                    {e.toName}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      {model ? (
        <Section title="Conflicts" count={model.conflicts.length} tone="bad" defaultOpen>
          <ul className="space-y-1.5 text-sm">
            {model.conflicts.map((c) => (
              <li key={c.edgeId}>
                <span className="text-red-600">{c.a.name}</span>{" "}
                <span className="text-ink-faint">contradicts</span>{" "}
                <span className="text-red-600">{c.b.name}</span>
                {c.quote ? (
                  <span className="mt-0.5 block text-xs text-ink-faint">“{c.quote}”</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {model ? (
        <Section title="Pending — needs a look" count={model.pending.length} tone="warn" defaultOpen>
          <ul className="space-y-1 text-sm text-ink-soft">
            {model.pending.map((p) => (
              <li key={p.id} className="flex gap-2">
                <Badge tone="warn">{p.kind.replace(/_/g, " ")}</Badge>
                <span>{p.reason}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </Card>
  );
}
