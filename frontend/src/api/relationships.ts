import { api } from "./client";

/**
 * How records connect (§44, §50).
 *
 * Derived on the server from the schema's foreign keys, so the map cannot fall
 * behind the model — there is no adjacency list here to keep in step.
 */
export interface RelatedNode {
  id: string;
  label: string;
  summary: string;
  /** The dataset or reference table this node belongs to. */
  entity: string;
  /** False for reference data — a person, a region — that has no dataset. */
  explorable: boolean;
  updated_at: string | null;
}

export interface RelationGroup {
  /** `outbound`: what this record points at. `inbound`: what points at it. */
  direction: "outbound" | "inbound";
  relation: string;
  label: string;
  target: string;
  total: number;
  has_more: boolean;
  items: RelatedNode[];
}

export interface RelationshipGraph {
  root: RelatedNode & { resource_type: string };
  groups: RelationGroup[];
  total: number;
}


/** One entity in the connection map, sized by how many records it holds. */
export interface MapNode {
  key: string;
  table: string;
  label: string;
  count: number;
  explorable: boolean;
}

/** One foreign key, weighted by how many rows actually carry it. */
export interface MapEdge {
  relation: string;
  label: string;
  source: string;
  source_label: string;
  target: string;
  target_label: string;
  count: number;
  /** Of the rows that could carry this link, the share that do. */
  coverage: number;
  source_total: number;
}

/** A record the most rows point at, and the relation that makes it a hub. */
export interface HubRecord extends RelatedNode {
  resource_type: string;
  connections: number;
  via: string;
  via_label: string;
}

export interface ConnectionMap {
  nodes: MapNode[];
  edges: MapEdge[];
  hubs: HubRecord[];
  totals: { records: number; entities: number; relations: number; links: number };
}

export const relationshipsApi = {
  /** The map itself, before any record has been chosen. */
  overview: (signal?: AbortSignal) =>
    api.get<ConnectionMap>("/api/relationships/overview", { signal }),

  of: (resourceType: string, id: string, signal?: AbortSignal) =>
    api.get<RelationshipGraph>(`/api/relationships/${resourceType}/${id}`, { signal }),
};
