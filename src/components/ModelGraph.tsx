"use client";

import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { Badge } from "@/components/ui";
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

/** One colour per entity kind. Red is reserved for conflicts, never assigned here. */
const KIND_COLOR: Record<string, string> = {
  actor: "#6366f1",
  capability: "#10b981",
  screen: "#06b6d4",
  data_object: "#f59e0b",
  state: "#8b5cf6",
  rule: "#eab308",
  event: "#ec4899",
  constraint: "#64748b",
};

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

function colorFor(kind: string): string {
  return KIND_COLOR[kind] ?? "#8c867e";
}

/** Line style communicates what kind of relationship this is, not just its colour. */
const EDGE_STYLE: Record<string, { dash?: string; width: number }> = {
  governs: { width: 1.5 },
  mutates: { width: 2 },
  precedes: { dash: "6 3", width: 1.5 },
  requires: { dash: "2 3", width: 1.5 },
  belongs_to: { width: 1 },
  contradicts: { dash: "5 3", width: 2 },
};

const NODE_WIDTH = 190;
const NODE_HEIGHT = 46;

function layout(
  nodeIds: string[],
  edges: { from: string; to: string }[],
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 18, ranksep: 110, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of nodeIds) g.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of edges) {
    if (nodeIds.includes(e.from) && nodeIds.includes(e.to)) g.setEdge(e.from, e.to);
  }
  dagre.layout(g);
  const positions = new Map<string, { x: number; y: number }>();
  for (const id of nodeIds) {
    const p = g.node(id);
    positions.set(id, { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 });
  }
  return positions;
}

/** Both source and target on both sides: edges flow either direction between kinds. */
const HANDLE_STYLE = { opacity: 0, width: 6, height: 6 } as const;

function EntityNode({ data }: { data: { name: string; kind: string; dim: boolean } }) {
  return (
    <div
      className={clsx(
        "rounded-lg border px-2.5 py-1.5 text-xs shadow-sm transition-opacity",
        data.dim ? "opacity-25" : "opacity-100",
      )}
      style={{
        width: NODE_WIDTH,
        background: "var(--color-surface)",
        borderColor: colorFor(data.kind),
        borderLeftWidth: 4,
      }}
    >
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <div className="truncate font-medium text-ink">{data.name}</div>
      <div className="truncate text-[10px] uppercase tracking-wide text-ink-faint">
        {data.kind.replace(/_/g, " ")}
      </div>
    </div>
  );
}

const NODE_TYPES = { entity: EntityNode };

export function ModelGraph({
  entities,
  edges,
}: {
  entities: EntityLite[];
  edges: EdgeLite[];
}) {
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);

  const kindsPresent = useMemo(() => {
    const set = new Set(entities.map((e) => e.kind));
    return KIND_ORDER.filter((k) => set.has(k));
  }, [entities]);

  const visibleEntities = useMemo(
    () => entities.filter((e) => !hiddenKinds.has(e.kind)),
    [entities, hiddenKinds],
  );
  const visibleIds = useMemo(() => new Set(visibleEntities.map((e) => e.id)), [visibleEntities]);
  const visibleEdges = useMemo(
    () => edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to)),
    [edges, visibleIds],
  );

  const neighbours = useMemo(() => {
    if (!selected) return null;
    const set = new Set<string>([selected]);
    for (const e of visibleEdges) {
      if (e.from === selected) set.add(e.to);
      if (e.to === selected) set.add(e.from);
    }
    return set;
  }, [selected, visibleEdges]);

  const positions = useMemo(
    () => layout(visibleEntities.map((e) => e.id), visibleEdges),
    [visibleEntities, visibleEdges],
  );

  const nodes: FlowNode[] = visibleEntities.map((e) => ({
    id: e.id,
    type: "entity",
    position: positions.get(e.id) ?? { x: 0, y: 0 },
    // Explicit dimensions so the minimap and fitView have something to work
    // with before the browser has measured the custom node on screen.
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    data: { name: e.name, kind: e.kind, dim: neighbours ? !neighbours.has(e.id) : false },
    draggable: true,
  }));

  const flowEdges: FlowEdge[] = visibleEdges.map((e) => {
    const style = EDGE_STYLE[e.kind] ?? { width: 1 };
    const isConflict = e.kind === "contradicts";
    const dim = neighbours ? !(neighbours.has(e.from) && neighbours.has(e.to)) : false;
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      label: e.kind.replace(/_/g, " "),
      labelStyle: { fill: "var(--color-ink-faint)", fontSize: 9 },
      labelBgStyle: { fill: "var(--color-canvas)", fillOpacity: 0.85 },
      style: {
        stroke: isConflict ? "#ef4444" : colorFor(entities.find((n) => n.id === e.from)?.kind ?? ""),
        strokeWidth: style.width,
        strokeDasharray: style.dash,
        opacity: dim ? 0.12 : 0.75,
      },
      markerEnd: { type: "arrowclosed" as const, color: isConflict ? "#ef4444" : "var(--color-ink-faint)" },
      animated: isConflict,
    };
  });

  const selectedEntity = entities.find((e) => e.id === selected) ?? null;
  const selectedRelations = selected
    ? edges.filter((e) => e.from === selected || e.to === selected)
    : [];

  if (entities.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-ink-faint">
        Build the product model to see it here.
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
        {kindsPresent.map((kind) => {
          const active = !hiddenKinds.has(kind);
          return (
            <button
              key={kind}
              onClick={() =>
                setHiddenKinds((prev) => {
                  const next = new Set(prev);
                  if (next.has(kind)) next.delete(kind);
                  else next.add(kind);
                  return next;
                })
              }
              className={clsx(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition",
                active ? "bg-canvas text-ink" : "text-ink-faint opacity-50",
              )}
            >
              <span
                className="size-2 rounded-full"
                style={{ background: colorFor(kind) }}
                aria-hidden
              />
              {kind.replace(/_/g, " ")}
            </button>
          );
        })}
        {selected ? (
          <button
            onClick={() => setSelected(null)}
            className="ml-auto rounded-full px-2.5 py-1 text-xs text-ink-soft hover:bg-canvas"
          >
            Clear selection
          </button>
        ) : null}
      </div>

      <div className="relative h-[560px] w-full" style={{ background: "var(--color-canvas)" }}>
        <ReactFlow
          nodes={nodes}
          edges={flowEdges}
          nodeTypes={NODE_TYPES}
          onNodeClick={(_, node) => setSelected((cur) => (cur === node.id ? null : node.id))}
          onPaneClick={() => setSelected(null)}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
        >
          <Background gap={18} size={1} color="var(--color-line)" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            maskColor="rgba(0,0,0,0.35)"
            nodeColor={(n) => colorFor((n.data as { kind: string }).kind)}
            style={{ background: "var(--color-surface)" }}
          />
        </ReactFlow>

        {selectedEntity ? (
          <div className="absolute right-3 top-3 w-64 rounded-lg border border-line-strong bg-surface p-3 text-xs shadow-lg">
            <div className="flex items-center gap-1.5">
              <span
                className="size-2 rounded-full"
                style={{ background: colorFor(selectedEntity.kind) }}
                aria-hidden
              />
              <span className="font-medium text-ink">{selectedEntity.name}</span>
            </div>
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-ink-faint">
              {selectedEntity.kind.replace(/_/g, " ")}
            </p>
            {selectedEntity.summary ? (
              <p className="mt-1.5 text-ink-soft">{selectedEntity.summary}</p>
            ) : null}
            {selectedRelations.length > 0 ? (
              <ul className="mt-2 space-y-1 border-t border-line pt-2 text-ink-soft">
                {selectedRelations.map((r) => (
                  <li key={r.id}>
                    {r.from === selected ? (
                      <>
                        <span className="text-ink-faint">{r.kind.replace(/_/g, " ")} →</span>{" "}
                        {r.toName}
                      </>
                    ) : (
                      <>
                        {r.fromName}{" "}
                        <span className="text-ink-faint">→ {r.kind.replace(/_/g, " ")}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <p className="border-t border-line px-4 py-2 text-[11px] text-ink-faint">
        {visibleEntities.length} of {entities.length} entities shown · drag to rearrange,
        scroll to zoom, click a node for its relationships
        {hiddenKinds.size > 0 ? (
          <>
            {" "}
            ·{" "}
            <Badge tone="neutral">{hiddenKinds.size} kind{hiddenKinds.size > 1 ? "s" : ""} hidden</Badge>
          </>
        ) : null}
      </p>
    </div>
  );
}
