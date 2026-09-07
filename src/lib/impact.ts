// Relative, extension-qualified imports so impact.test.ts runs under the node
// test runner (which does not resolve the "@/" alias). store.ts only imports
// types, so pulling it in here is safe.
import {
  listEdges,
  listEntities,
  spansFor,
  type DocumentIngest,
} from "./store.ts";
import type { Edge, Entity, EdgeKind } from "./types.ts";

export interface EntityLite {
  id: string;
  name: string;
  kind: string;
}

export interface EdgeLite {
  id: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  kind: EdgeKind;
}

export interface Conflict {
  edgeId: string;
  a: EntityLite;
  b: EntityLite;
  quote: string | null;
}

export interface ImpactReport {
  /** The entities the ingest actually touched. */
  changed: EntityLite[];
  /** Everything within `hops` of a changed entity, following current edges. */
  affected: EntityLite[];
  /** The current edges that connect the changed-and-affected set. */
  edges: EdgeLite[];
  /** Live `contradicts` edges anywhere in the model — a change often creates one. */
  conflicts: Conflict[];
}

function lite(e: Entity): EntityLite {
  return { id: e.id, name: e.name, kind: e.kind };
}

/**
 * Entities reachable from `seedIds` within `hops` edges, following the model as
 * it currently stands. Undirected: an impact can propagate either way along a
 * relationship.
 */
export function neighbourhood(
  projectId: string,
  seedIds: string[],
  hops = 2,
): { entities: Map<string, Entity>; edges: Edge[] } {
  const entitiesById = new Map(listEntities(projectId).map((e) => [e.id, e]));
  const edges = listEdges(projectId);
  const adjacency = new Map<string, Edge[]>();
  const link = (id: string, edge: Edge) => {
    const list = adjacency.get(id);
    if (list) list.push(edge);
    else adjacency.set(id, [edge]);
  };
  for (const edge of edges) {
    link(edge.from, edge);
    link(edge.to, edge);
  }

  const reached = new Set<string>(seedIds.filter((id) => entitiesById.has(id)));
  const touchedEdges = new Map<string, Edge>();
  let frontier = [...reached];

  for (let hop = 0; hop < hops && frontier.length > 0; hop += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of adjacency.get(id) ?? []) {
        touchedEdges.set(edge.id, edge);
        const other = edge.from === id ? edge.to : edge.from;
        if (!reached.has(other) && entitiesById.has(other)) {
          reached.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }

  const entities = new Map<string, Entity>();
  for (const id of reached) {
    const e = entitiesById.get(id);
    if (e) entities.set(id, e);
  }
  return { entities, edges: [...touchedEdges.values()] };
}

/** Current edges with both endpoint names resolved, for display. */
export function listEdgesHydrated(projectId: string): EdgeLite[] {
  const nameOf = new Map(listEntities(projectId).map((e) => [e.id, e.name]));
  return listEdges(projectId).map((e) => ({
    id: e.id,
    from: e.from,
    fromName: nameOf.get(e.from) ?? e.from,
    to: e.to,
    toName: nameOf.get(e.to) ?? e.to,
    kind: e.kind,
  }));
}

/** Every live `contradicts` edge, hydrated with names and a quote. */
export function listConflicts(projectId: string): Conflict[] {
  const byId = new Map(listEntities(projectId).map((e) => [e.id, e]));
  const out: Conflict[] = [];
  for (const edge of listEdges(projectId)) {
    if (edge.kind !== "contradicts") continue;
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) continue;
    const span = spansFor("edge", edge.id)[0];
    out.push({
      edgeId: edge.id,
      a: lite(a),
      b: lite(b),
      quote: span?.quote ?? null,
    });
  }
  return out;
}

/**
 * What an ingest changed, and what that change reaches. `seedIds` are the
 * entities the ingest created or re-touched; everything else is derived from
 * the current model.
 */
export function impactReport(
  projectId: string,
  seedIds: string[],
  { hops = 2 }: { hops?: number } = {},
): ImpactReport {
  const { entities, edges } = neighbourhood(projectId, seedIds, hops);
  const seeds = new Set(seedIds);
  const byId = new Map([...entities.values()].map((e) => [e.id, e]));

  const changed: EntityLite[] = [];
  const affected: EntityLite[] = [];
  for (const e of entities.values()) {
    (seeds.has(e.id) ? changed : affected).push(lite(e));
  }

  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const edgeLites: EdgeLite[] = edges.map((e) => ({
    id: e.id,
    from: e.from,
    fromName: nameOf(e.from),
    to: e.to,
    toName: nameOf(e.to),
    kind: e.kind,
  }));

  return {
    changed: changed.sort((x, y) => x.name.localeCompare(y.name)),
    affected: affected.sort((x, y) => x.name.localeCompare(y.name)),
    edges: edgeLites,
    conflicts: listConflicts(projectId),
  };
}

/** Convenience for a route: has this document ever been ingested? */
export function ingestState(ingest: DocumentIngest | null): "fresh" | "ingested" {
  return ingest ? "ingested" : "fresh";
}
