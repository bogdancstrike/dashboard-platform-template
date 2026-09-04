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

export const relationshipsApi = {
  of: (resourceType: string, id: string, signal?: AbortSignal) =>
    api.get<RelationshipGraph>(`/api/relationships/${resourceType}/${id}`, { signal }),
};
