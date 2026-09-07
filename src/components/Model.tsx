"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, CardHead, Metric, Spinner } from "@/components/ui";

interface EntityLite {
  id: string;
  name: string;
  kind: string;
}

interface EdgeLite {
  id: string;
  fromName: string;
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
          <Button
            size="sm"
            variant={built ? "outline" : "primary"}
            disabled={busy || docCount === 0}
            onClick={() => void build(built)}
          >
            {busy ? <Spinner /> : null} {built ? "Rebuild" : "Build product model"}
          </Button>
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

      {model && model.conflicts.length > 0 ? (
        <div className="border-t border-line px-4 py-3">
          <p className="text-xs text-ink-faint">Conflicts</p>
          <ul className="mt-1 space-y-1.5 text-sm">
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
        </div>
      ) : null}

      {built ? (
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
      ) : null}

      {built && model!.edges.length > 0 ? (
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

      {built && model!.pending.length > 0 ? (
        <div className="border-t border-line px-4 py-3">
          <p className="text-xs text-ink-faint">Pending — needs a look</p>
          <ul className="mt-1 space-y-1 text-sm text-ink-soft">
            {model!.pending.map((p) => (
              <li key={p.id} className="flex gap-2">
                <Badge tone="warn">{p.kind.replace(/_/g, " ")}</Badge>
                <span>{p.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
